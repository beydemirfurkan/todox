import { randomBytes, randomUUID } from "node:crypto";

import { tx } from "../db/client";
import { publicUrl } from "../public-url";
import * as apiTokens from "../repositories/api-tokens";
import * as clients from "../repositories/oauth-clients";
import type { OAuthClient } from "../repositories/oauth-clients";
import * as codes from "../repositories/oauth-codes";
import * as refreshTokens from "../repositories/oauth-refresh-tokens";
import { fetchClientMetadata } from "../server/fetch-client-metadata";
import { logError, logInfo, logWarn } from "../server/log";
import { newApiToken } from "../util/tokens";
import { now } from "../util/time";
import {
  ACCESS_TTL_MS,
  checkAuthorizeQuery,
  CIMD_TTL_MS,
  CODE_TTL_MS,
  FIRST_PARTY_CLIENT_ID,
  FIRST_PARTY_REDIRECT,
  isMetadataClientId,
  mcpResource,
  parseClientMetadataDocument,
  parseRegistrationRequest,
  redirectMatches,
  redirectWith,
  REFRESH_TTL_MS,
  verifierMatches,
  type AuthorizeQuery,
  type AuthorizeRequest,
} from "./oauth-rules";

/**
 * todox as its own OAuth authorisation server, for MCP clients.
 *
 * A client that connects to `/api/mcp` with no token is told where to find
 * this server; it registers (or is known by its metadata URL), sends the
 * person here to approve it, and trades the code for an access token and a
 * refresh token. The person never sees a credential, and nothing worth
 * stealing lands in a chat transcript.
 *
 * The access token is an `api_tokens` row with an expiry, so the bearer check
 * every agent call already goes through needs nothing new.
 */

const later = (ms: number): string => new Date(Date.now() + ms).toISOString();

const FIRST_PARTY: OAuthClient = {
  client_id: FIRST_PARTY_CLIENT_ID,
  kind: "first_party",
  client_name: "todox-mcp login",
  redirect_uris: [FIRST_PARTY_REDIRECT],
  created_at: "2026-11-23T00:00:00.000Z",
  fetched_at: null,
};

/* ---------------------------------------------------------------- clients */

async function metadataClient(clientId: string): Promise<OAuthClient | null> {
  const cached = await clients.find(clientId);
  const isFresh =
    cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < CIMD_TTL_MS;
  if (cached && isFresh) return cached;

  const parsed = parseClientMetadataDocument(clientId, await fetchClientMetadata(clientId));
  if (!parsed) return null;
  const client: OAuthClient = {
    client_id: clientId,
    kind: "cimd",
    client_name: parsed.client_name,
    redirect_uris: parsed.redirect_uris,
    created_at: cached?.created_at ?? now(),
    fetched_at: now(),
  };
  await clients.upsert(client);
  return client;
}

/**
 * Who `client_id` is: the CLI, a metadata document at that URL, or a client
 * that registered itself here. Null for anything else -- including a
 * registered id presented as if it were a URL, or the reverse.
 */
export async function resolveClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > 2000) return null;
  if (clientId === FIRST_PARTY_CLIENT_ID) return FIRST_PARTY;
  if (isMetadataClientId(clientId)) return metadataClient(clientId);
  const found = await clients.find(clientId);
  return found?.kind === "dcr" ? found : null;
}

/** Dynamic Client Registration (RFC 7591). Deprecated by the spec, still used by Cursor. */
export async function registerClient(body: unknown): Promise<OAuthClient | null> {
  const parsed = parseRegistrationRequest(body);
  if (!parsed) return null;
  const client: OAuthClient = {
    client_id: `mcp_${randomBytes(16).toString("base64url")}`,
    kind: "dcr",
    client_name: parsed.client_name,
    redirect_uris: parsed.redirect_uris,
    created_at: now(),
    fetched_at: null,
  };
  await clients.upsert(client);
  logInfo("oauth.client.registered", { kind: "dcr" });
  return client;
}

/* -------------------------------------------------------------- authorise */

/**
 * The three ways an authorisation request can come out.
 *
 * `invalid` is shown to the person and never redirected: until the client and
 * its redirect are both known to be real, sending the browser anywhere would
 * make this an open redirector.
 */
export type Authorization =
  | { kind: "invalid"; description: string }
  | { kind: "redirect"; url: string }
  | { kind: "ok"; client: OAuthClient; request: AuthorizeRequest };

export async function checkAuthorization(query: AuthorizeQuery): Promise<Authorization> {
  const clientId = query.client_id ?? "";
  const redirectUri = query.redirect_uri ?? "";
  const client = await resolveClient(clientId);
  if (!client) return { kind: "invalid", description: "unknown client" };
  if (!redirectMatches(client.redirect_uris, redirectUri))
    return { kind: "invalid", description: "redirect_uri is not registered for this client" };

  const base = publicUrl();
  const outcome = checkAuthorizeQuery(query, { clientId, redirectUri, base });
  if (!outcome.ok)
    return {
      kind: "redirect",
      url: redirectWith(redirectUri, {
        error: outcome.error,
        error_description: outcome.description,
        state: query.state ?? null,
        iss: base,
      }),
    };
  return { kind: "ok", client, request: outcome.request };
}

/** Prunes what has expired, without making the person wait for it. */
function pruneInBackground(): void {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  void Promise.all([codes.pruneOlderThan(dayAgo), refreshTokens.pruneOlderThan(dayAgo)]).catch(
    (error: unknown) => logError("oauth.prune", error),
  );
}

/** The person said yes: a code, bound to everything the token request must repeat. */
export async function approve(userId: number, request: AuthorizeRequest): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  const at = now();
  await codes.create({
    code,
    client_id: request.client_id,
    user_id: userId,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    resource: request.resource,
    created_at: at,
    expires_at: later(CODE_TTL_MS),
  });
  pruneInBackground();
  logInfo("oauth.approved", { userId });
  return redirectWith(request.redirect_uri, { code, state: request.state, iss: publicUrl() });
}

export const deny = (request: AuthorizeRequest): string =>
  redirectWith(request.redirect_uri, {
    error: "access_denied",
    error_description: "the request was declined",
    state: request.state,
    iss: publicUrl(),
  });

/* ------------------------------------------------------------------ token */

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
  refresh_token?: string;
}

export type TokenResult =
  | { ok: true; body: TokenResponse }
  | { ok: false; status: 400 | 401; error: string; description: string };

const invalidGrant = (description: string): TokenResult => ({
  ok: false,
  status: 400,
  error: "invalid_grant",
  description,
});

export interface CodeExchange {
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
  resource?: string;
  /** The CLI login names the machine, so the token list can say whose it is. */
  device_name?: string;
}

/**
 * The CLI login gets a personal token rather than a grant: hooks are short
 * processes that cannot keep refreshing one, and `gh auth login` taught
 * everybody what to expect. It is still revocable from the account page.
 */
async function issuePersonalToken(userId: number, deviceName: string | undefined): Promise<TokenResult> {
  const token = newApiToken();
  const device = deviceName?.trim().slice(0, 60);
  await apiTokens.create({
    user_id: userId,
    name: device ? `todox-mcp login · ${device}` : "todox-mcp login",
    token,
    client_id: FIRST_PARTY_CLIENT_ID,
  });
  logInfo("oauth.token.issued", { userId, kind: "first_party" });
  return { ok: true, body: { access_token: token, token_type: "Bearer" } };
}

async function issueGrant(input: {
  userId: number;
  client: OAuthClient;
  resource: string;
}): Promise<TokenResult> {
  const access = newApiToken();
  const refresh = `todoxr_${randomBytes(32).toString("base64url")}`;
  const familyId = randomUUID();
  const at = now();
  await tx([
    apiTokens.createGrantStmt({
      user_id: input.userId,
      name: input.client.client_name,
      token: access,
      client_id: input.client.client_id,
      family_id: familyId,
      created_at: at,
      expires_at: later(ACCESS_TTL_MS),
    }),
    refreshTokens.createStmt({
      token: refresh,
      family_id: familyId,
      client_id: input.client.client_id,
      user_id: input.userId,
      resource: input.resource,
      created_at: at,
      expires_at: later(REFRESH_TTL_MS),
    }),
  ]);
  logInfo("oauth.token.issued", { userId: input.userId, kind: input.client.kind });
  return {
    ok: true,
    body: {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refresh,
    },
  };
}

export async function exchangeCode(input: CodeExchange): Promise<TokenResult> {
  // Spent first, checked after: a code that fails here is gone either way.
  const stored = await codes.consume(input.code, now());
  if (!stored) return invalidGrant("the code is unknown, expired or already used");
  if (stored.client_id !== input.client_id) return invalidGrant("the code was issued to another client");
  if (stored.redirect_uri !== input.redirect_uri) return invalidGrant("redirect_uri does not match");
  if (input.resource && input.resource !== stored.resource && input.resource !== mcpResource(publicUrl()))
    return invalidGrant("resource does not match");
  if (!verifierMatches(input.code_verifier, stored.code_challenge))
    return invalidGrant("code_verifier does not match the challenge");

  if (stored.client_id === FIRST_PARTY_CLIENT_ID)
    return issuePersonalToken(stored.user_id, input.device_name);
  const client = await resolveClient(stored.client_id);
  if (!client) return invalidGrant("the client is no longer known");
  return issueGrant({ userId: stored.user_id, client, resource: stored.resource });
}

/** Revokes a whole grant: its access token and every refresh token in its family. */
const revokeFamily = (familyId: string) =>
  tx([apiTokens.removeGrantStmt(familyId), refreshTokens.revokeFamilyStmt(familyId, now())]);

export async function refreshGrant(input: { refresh_token: string; client_id: string }): Promise<TokenResult> {
  const spent = await refreshTokens.consume(input.refresh_token, now());
  if (!spent) {
    // Presented again after it was used: two parties hold it, and there is no
    // telling which one is the client. End the grant for both.
    const previous = await refreshTokens.find(input.refresh_token);
    if (previous?.used_at && !previous.revoked_at) {
      await revokeFamily(previous.family_id);
      logWarn("oauth.refresh.replayed", { userId: previous.user_id });
    }
    return invalidGrant("the refresh token is unknown, expired, revoked or already used");
  }
  if (spent.client_id !== input.client_id) {
    await revokeFamily(spent.family_id);
    return invalidGrant("the refresh token was issued to another client");
  }
  // The access token row is the grant. Every path that ends access -- the
  // account page, a recovery, an account takeover -- deletes it, so a refresh
  // whose grant is gone must not mint a token for a connection that was cut.
  if (!(await apiTokens.findGrant(spent.family_id))) {
    await revokeFamily(spent.family_id);
    return invalidGrant("the grant was revoked");
  }

  const access = newApiToken();
  const refresh = `todoxr_${randomBytes(32).toString("base64url")}`;
  const at = now();
  await tx([
    apiTokens.rotateGrantStmt(spent.family_id, access, later(ACCESS_TTL_MS)),
    refreshTokens.createStmt({
      token: refresh,
      family_id: spent.family_id,
      client_id: spent.client_id,
      user_id: spent.user_id,
      resource: spent.resource,
      created_at: at,
      expires_at: later(REFRESH_TTL_MS),
    }),
  ]);
  return {
    ok: true,
    body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh },
  };
}

/**
 * RFC 7009. Either kind of token ends the grant it belongs to; anything
 * unknown is answered the same way, so the endpoint says nothing about which
 * tokens exist.
 */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  const refresh = await refreshTokens.find(token);
  if (refresh) return void (await revokeFamily(refresh.family_id));
  const access = await apiTokens.findByToken(token);
  if (access?.family_id) await revokeFamily(access.family_id);
}

/** From the account page: one row, whichever kind it is. */
export async function revokeFromAccount(id: number, userId: number): Promise<void> {
  const row = await apiTokens.findForUser(id, userId);
  if (!row) return;
  if (row.family_id) await revokeFamily(row.family_id);
  else await apiTokens.remove(id, userId);
}
