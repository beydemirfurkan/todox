import { cookies } from "next/headers";

import { OAUTH_COOKIE } from "./cookies";
import type { OAuthProvider } from "./repositories/oauth-accounts";
import { encodePending } from "./services/oauth-flow";
import { authorizationUrl, newCodeVerifier, newState } from "./services/oauth-providers";

/** Ten minutes to finish at the provider; longer than anybody needs. */
const PENDING_SECONDS = 600;

/**
 * The first half of a trip to Google or GitHub: the state, the PKCE verifier
 * and where to land, kept in an httpOnly cookie for the callback to check.
 * Returns the provider's address, or null when this server has no keys for it.
 *
 * A link grant rides in the same cookie rather than in a URL, so it never
 * reaches an access log or a referrer.
 */
export async function beginOAuth(input: {
  provider: OAuthProvider;
  next: string;
  linkGrant?: string;
}): Promise<string | null> {
  const state = newState();
  const codeVerifier = newCodeVerifier();
  const target = authorizationUrl(input.provider, { state, codeVerifier });
  if (!target) return null;
  (await cookies()).set(
    OAUTH_COOKIE,
    encodePending({
      provider: input.provider,
      state,
      codeVerifier,
      next: input.next,
      ...(input.linkGrant ? { linkGrant: input.linkGrant } : {}),
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/auth",
      maxAge: PENDING_SECONDS,
    },
  );
  return target.toString();
}
