import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The parts of being an OAuth authorisation server that are plain logic:
 * what a redirect may be, whether a verifier matches its challenge, what a
 * client metadata document must say. Apart from the routes and the database
 * so every rule here can be asserted without either.
 */

/** The CLI login (`todox-mcp login`). Known in advance, so it needs no metadata. */
export const FIRST_PARTY_CLIENT_ID = "todox-cli";
export const FIRST_PARTY_REDIRECT = "http://127.0.0.1/callback";

export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000;
/** A metadata document is fetched again after a day, so a changed redirect lands. */
export const CIMD_TTL_MS = 24 * 60 * 60_000;

/** The resource every token is minted for: the hosted MCP endpoint. */
export const mcpResource = (base: string): string => `${base}/api/mcp`;

/**
 * Resource indicators this server accepts as itself.
 *
 * The endpoint, and the origin a client might send instead. Both host forms,
 * because todox.dev and www.todox.dev serve the same app and a snippet copied
 * months ago may name either -- refusing one of them would read as a broken
 * server, not as a mismatch.
 */
export function acceptedResources(base: string): string[] {
  return siteOrigins(base).flatMap((origin) => [mcpResource(origin), origin, `${origin}/`]);
}

/**
 * The origin this request reached, if it is one of this site's two; the
 * configured one otherwise.
 *
 * The resource, the issuer and the metadata URL have to name the host the
 * client is talking to: Claude Code refuses a protected resource whose origin
 * differs from the server URL it was given, so an agent added as
 * `www.todox.dev` failed against metadata that said `todox.dev`. The host
 * header is the client's to write, so it is only ever chosen from the
 * allow-list -- anything else gets the configured origin, never itself.
 */
export function baseForHost(configured: string, host: string | null | undefined): string {
  if (!host) return configured;
  const candidate = `${new URL(configured).protocol}//${host.split(",")[0].trim().toLowerCase()}`;
  return siteOrigins(configured).includes(candidate) ? candidate : configured;
}

/** This site's origin in both host forms, with and without `www.`. */
export function siteOrigins(base: string): string[] {
  const url = new URL(base);
  const twin = url.host.startsWith("www.") ? url.host.slice(4) : `www.${url.host}`;
  return [url.origin, `${url.protocol}//${twin}`];
}

/** RFC 9728: where a client that was refused finds out how to get a token. */
export const protectedResourceMetadata = (base: string) => ({
  resource: mcpResource(base),
  authorization_servers: [base],
  bearer_methods_supported: ["header"],
  resource_name: "todox",
});

/** RFC 8414, with the two MCP-specific flags a client looks for. */
export const authorizationServerMetadata = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/api/oauth/token`,
  registration_endpoint: `${base}/api/oauth/register`,
  revocation_endpoint: `${base}/api/oauth/revoke`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  revocation_endpoint_auth_methods_supported: ["none"],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
});

/** Where `/api/mcp` points a client in its 401. */
export const resourceMetadataUrl = (base: string): string =>
  `${base}/.well-known/oauth-protected-resource/api/mcp`;

/* ------------------------------------------------------------------ PKCE */

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const isCodeChallenge = (value: string): boolean => CHALLENGE.test(value);

/** S256 only: `plain` would hand the verifier to anyone who saw the redirect. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

/* ------------------------------------------------------------- redirects */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "about:", "blob:"]);

const parse = (value: string): URL | null => (URL.canParse(value) ? new URL(value) : null);

const isLoopback = (url: URL): boolean => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/**
 * Whether a URI may be registered as somewhere to send a code.
 *
 * https anywhere; plain http only back to this machine (RFC 8252, a native
 * client's loopback listener); a custom scheme for a desktop app that claims
 * one (`cursor://…`, `vscode://…`). Never a scheme that runs or reads
 * something in the browser, and never a fragment, which the code would be
 * appended after.
 */
export function isAcceptableRedirect(value: string): boolean {
  if (value.length > 2000) return false;
  const url = parse(value);
  if (!url || url.hash) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopback(url);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/**
 * Whether `candidate` is one of the client's registered redirects.
 *
 * Exact string match, with the one exception RFC 8252 §7.3 makes: a loopback
 * redirect may arrive on any port, because a CLI binds whatever port is free
 * at the moment it starts.
 */
export function redirectMatches(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  const url = parse(candidate);
  if (!url || !isLoopback(url) || url.hash) return false;
  return registered.some((entry) => {
    const known = parse(entry);
    return (
      known !== null &&
      isLoopback(known) &&
      known.hostname === url.hostname &&
      known.pathname === url.pathname &&
      known.search === url.search
    );
  });
}

/* ------------------------------------------------------- client metadata */

/** A client id that is a metadata document's address (CIMD). */
export function isMetadataClientId(clientId: string): boolean {
  const url = parse(clientId);
  return url !== null && url.protocol === "https:" && url.pathname !== "/" && !url.hash;
}

export interface ClientMetadata {
  client_name: string;
  redirect_uris: string[];
}

const MAX_REDIRECTS = 10;

/** A display name from untrusted input: trimmed, bounded, never empty. */
const nameOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;

/** The redirect list from untrusted input, or null if any entry is unacceptable. */
function redirectList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECTS) return null;
  if (!value.every((v): v is string => typeof v === "string" && isAcceptableRedirect(v))) return null;
  return value;
}

/**
 * Only public clients: a client that wants to authenticate at the token
 * endpoint expects a secret or a key this server does not keep.
 */
const isPublicAuthMethod = (value: unknown): boolean => value === undefined || value === "none";

/**
 * What a fetched metadata document is allowed to say.
 *
 * It must name itself by the exact URL it was fetched from -- otherwise one
 * client could publish a document claiming to be another.
 */
export function parseClientMetadataDocument(
  url: string,
  doc: unknown,
): ClientMetadata | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const fields = doc as Record<string, unknown>;
  if (fields.client_id !== url) return null;
  if (!isPublicAuthMethod(fields.token_endpoint_auth_method)) return null;
  const redirects = redirectList(fields.redirect_uris);
  if (!redirects) return null;
  return { client_name: nameOr(fields.client_name, new URL(url).host), redirect_uris: redirects };
}

/**
 * A dynamic registration request (RFC 7591), reduced to what this server
 * keeps. A client asking for a confidential auth method is registered as a
 * public one anyway, and the response says so -- the RFC lets a server
 * override, and refusing would break clients that ask out of habit.
 */
export function parseRegistrationRequest(body: unknown): ClientMetadata | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = body as Record<string, unknown>;
  const redirects = redirectList(fields.redirect_uris);
  if (!redirects) return null;
  return { client_name: nameOr(fields.client_name, "MCP client"), redirect_uris: redirects };
}

/* --------------------------------------------------------- the request */

export interface AuthorizeQuery {
  client_id?: string | null;
  redirect_uri?: string | null;
  response_type?: string | null;
  code_challenge?: string | null;
  code_challenge_method?: string | null;
  state?: string | null;
  resource?: string | null;
  scope?: string | null;
}

/** A request that passed every check, with the resource it will be bound to. */
export interface AuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  state: string | null;
  resource: string;
}

/**
 * Errors after the redirect has been verified go back to the client; the RFC
 * says so, and the client is the one that can do something about them.
 */
export type AuthorizeOutcome =
  | { ok: true; request: AuthorizeRequest }
  | { ok: false; error: string; description: string };

/**
 * Everything about an authorisation request except who the client is, which
 * needs the database or the network and is checked before this.
 */
export function checkAuthorizeQuery(
  query: AuthorizeQuery,
  input: { clientId: string; redirectUri: string; base: string },
): AuthorizeOutcome {
  if (query.response_type !== "code")
    return { ok: false, error: "unsupported_response_type", description: "only response_type=code" };
  if (query.code_challenge_method !== "S256")
    return { ok: false, error: "invalid_request", description: "PKCE with S256 is required" };
  if (!query.code_challenge || !isCodeChallenge(query.code_challenge))
    return { ok: false, error: "invalid_request", description: "code_challenge is missing or malformed" };
  const resource = query.resource || mcpResource(input.base);
  if (!acceptedResources(input.base).includes(resource))
    return { ok: false, error: "invalid_target", description: "this server issues tokens for its own MCP endpoint only" };
  return {
    ok: true,
    request: {
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: query.code_challenge,
      state: query.state ? query.state.slice(0, 1000) : null,
      resource: mcpResource(input.base),
    },
  };
}

/**
 * Where the browser goes after the person answers: the code (or the error),
 * the state the client sent, and `iss` so a client talking to several
 * servers can tell this answer is from this one (RFC 9207).
 */
export function redirectWith(
  redirectUri: string,
  values: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values))
    if (value !== null) url.searchParams.set(key, value);
  return url.toString();
}
