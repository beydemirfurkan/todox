import { createHash, randomBytes } from "node:crypto";

import { publicUrl } from "../public-url";
import type { OAuthProvider } from "../repositories/oauth-accounts";

/**
 * Signing in with Google or GitHub, by hand.
 *
 * Two providers and one flow each (authorization code with PKCE), so this is
 * a few requests rather than a library. The library the plan named, arctic,
 * had been pulled from npm with a "no longer supported" notice when it came to
 * installing it; a sign-in path is the last place to take a dependency like
 * that on trust.
 *
 * Nothing here keeps a provider token. It is used once, to read who signed
 * in, and dropped.
 */

export interface OAuthProfile {
  providerUserId: string;
  /** Null when the provider has no address it will vouch for. */
  email: string | null;
  isEmailVerified: boolean;
  name: string;
  /** A starting point for a username: the GitHub login, or the address's local part. */
  usernameHint: string;
}

interface Credentials {
  clientId: string;
  clientSecret: string;
}

/** A provider is on when both halves of its credentials are set, never half. */
function credentials(provider: OAuthProvider): Credentials | null {
  const prefix = provider.toUpperCase();
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function enabledProviders(): OAuthProvider[] {
  return (["google", "github"] as const).filter((provider) => credentials(provider) !== null);
}

export const redirectUri = (provider: OAuthProvider) =>
  `${publicUrl()}/api/auth/${provider}/callback`;

const randomToken = () => randomBytes(32).toString("base64url");
export const newState = randomToken;
export const newCodeVerifier = randomToken;

export const codeChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const AUTHORIZE: Record<OAuthProvider, { url: string; scope: string }> = {
  google: { url: "https://accounts.google.com/o/oauth2/v2/auth", scope: "openid email profile" },
  github: { url: "https://github.com/login/oauth/authorize", scope: "read:user user:email" },
};

/** Where to send the browser; null when the provider is not configured. */
export function authorizationUrl(
  provider: OAuthProvider,
  input: { state: string; codeVerifier: string },
): string | null {
  const creds = credentials(provider);
  if (!creds) return null;
  const url = new URL(AUTHORIZE[provider].url);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: creds.clientId,
    redirect_uri: redirectUri(provider),
    scope: AUTHORIZE[provider].scope,
    state: input.state,
    code_challenge: codeChallenge(input.codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export class OAuthExchangeError extends Error {}

type Fetch = typeof fetch;

/** Trade the code for whoever signed in. Throws `OAuthExchangeError` on any refusal. */
export async function profileFromCode(
  provider: OAuthProvider,
  input: { code: string; codeVerifier: string },
  fetcher: Fetch = fetch,
): Promise<OAuthProfile> {
  const creds = credentials(provider);
  if (!creds) throw new OAuthExchangeError(`${provider} is not configured`);
  return provider === "google"
    ? googleProfile(creds, input, fetcher)
    : githubProfile(creds, input, fetcher);
}

async function postForm(fetcher: Fetch, url: string, form: Record<string, string>) {
  const response = await fetcher(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(body) || "error" in body) {
    throw new OAuthExchangeError(`token exchange refused (${response.status})`);
  }
  return body;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" ? value : "");

const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/**
 * The ID token is read without checking its signature, which OpenID Connect
 * allows for exactly this case: it came straight from Google's token endpoint
 * over TLS, in answer to a request carrying our secret, not through the
 * browser. The audience and issuer are still checked, so a token minted for
 * some other client cannot be replayed here.
 */
async function googleProfile(
  creds: Credentials,
  input: { code: string; codeVerifier: string },
  fetcher: Fetch,
): Promise<OAuthProfile> {
  const tokens = await postForm(fetcher, "https://oauth2.googleapis.com/token", {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: redirectUri("google"),
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const claims = decodeJwtPayload(text(tokens.id_token));
  if (claims.aud !== creds.clientId || !GOOGLE_ISSUERS.has(text(claims.iss)) || !text(claims.sub)) {
    throw new OAuthExchangeError("id token is not for this client");
  }
  const email = text(claims.email) || null;
  return {
    providerUserId: text(claims.sub),
    email,
    isEmailVerified: email !== null && claims.email_verified === true,
    name: text(claims.name),
    usernameHint: email ? email.split("@")[0] : "",
  };
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  if (!payload) throw new OAuthExchangeError("no id token");
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (isRecord(claims)) return claims;
  } catch (cause) {
    throw new OAuthExchangeError("id token is not JSON", { cause });
  }
  throw new OAuthExchangeError("id token is not an object");
}

/**
 * GitHub's `/user` carries only the public address, often none, and never
 * says whether it is verified, so the address comes from `/user/emails`: the
 * primary one, and only when GitHub has verified it.
 */
async function githubProfile(
  creds: Credentials,
  input: { code: string; codeVerifier: string },
  fetcher: Fetch,
): Promise<OAuthProfile> {
  const tokens = await postForm(fetcher, "https://github.com/login/oauth/access_token", {
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: redirectUri("github"),
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${text(tokens.access_token)}`,
    "User-Agent": "todox",
  };
  const [userResponse, emailsResponse] = await Promise.all([
    fetcher("https://api.github.com/user", { headers }),
    fetcher("https://api.github.com/user/emails", { headers }),
  ]);
  if (!userResponse.ok) throw new OAuthExchangeError(`github /user ${userResponse.status}`);
  const user: unknown = await userResponse.json();
  if (!isRecord(user) || (typeof user.id !== "number" && typeof user.id !== "string")) {
    throw new OAuthExchangeError("github /user has no id");
  }
  const emails: unknown = emailsResponse.ok ? await emailsResponse.json() : [];
  const primary = Array.isArray(emails)
    ? emails.find((row) => isRecord(row) && row.primary === true && row.verified === true)
    : undefined;
  const email = isRecord(primary) ? text(primary.email) || null : null;
  return {
    providerUserId: String(user.id),
    email,
    isEmailVerified: email !== null,
    name: text(user.name),
    usernameHint: text(user.login),
  };
}
