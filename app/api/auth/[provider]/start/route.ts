import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { OAUTH_COOKIE } from "@/lib/cookies";
import { publicUrl } from "@/lib/public-url";
import { clientIp } from "@/lib/server/client-ip";
import { encodePending, isProvider, safeNext } from "@/lib/services/oauth-flow";
import { authorizationUrl, newCodeVerifier, newState } from "@/lib/services/oauth-providers";
import * as limit from "@/lib/services/rate-limit";

export const dynamic = "force-dynamic";

/** Ten minutes to finish at the provider; longer than anybody needs. */
const PENDING_SECONDS = 600;

/**
 * Off to Google or GitHub. A plain GET a link can point at, because the
 * buttons are links: the CSP allows forms to post only to this origin, and
 * the provider is not this origin.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  const back = (code: string) => NextResponse.redirect(`${publicUrl()}/login?error=${code}`);
  if (!isProvider(provider)) return back("oauthFailed");

  const gate = await limit.consume("oauthPerIp", clientIp(await headers()));
  if (!gate.allowed) return back("tooManyAttempts");

  const state = newState();
  const codeVerifier = newCodeVerifier();
  const target = authorizationUrl(provider, { state, codeVerifier });
  if (!target) return back("oauthFailed");

  const next = safeNext(new URL(request.url).searchParams.get("next"));
  (await cookies()).set(OAUTH_COOKIE, encodePending({ provider, state, codeVerifier, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: PENDING_SECONDS,
  });
  return NextResponse.redirect(target);
}
