import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/cookies";
import { publicUrl } from "@/lib/public-url";
import { logError } from "@/lib/server/log";
import * as auth from "@/lib/services/auth";
import { resolveSignIn } from "@/lib/services/oauth";
import { decodePending, stateMatches } from "@/lib/services/oauth-flow";
import { OAuthExchangeError, profileFromCode } from "@/lib/services/oauth-providers";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Back from the provider. The state in the cookie must match the one in the
 * address -- that is what makes this a reply to a trip this browser started,
 * not a link somebody else crafted -- and the cookie is spent either way.
 *
 * Success always opens a new session and ends the one before it. That is what
 * lets an account without a password prove itself again from the account
 * page: the fresh session is the recent sign-in `auth.ts` asks for.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  const store = await cookies();
  const pending = decodePending(store.get(OAUTH_COOKIE)?.value);
  store.delete({ name: OAUTH_COOKIE, path: "/api/auth" });

  const query = new URL(request.url).searchParams;
  const sessionToken = store.get(SESSION_COOKIE)?.value;
  const current = sessionToken ? await auth.userForSession(sessionToken) : undefined;
  const fail = (code: string) =>
    NextResponse.redirect(
      current ? `${publicUrl()}/account?tab=connections&error=${code}` : `${publicUrl()}/login?error=${code}`,
    );

  if (!pending || pending.provider !== provider || !stateMatches(pending.state, query.get("state")))
    return fail("oauthFailed");
  const code = query.get("code");
  // No code means the person said no at the provider, which is not an error
  // worth more than going back to where they were.
  if (!code) return fail("oauthCancelled");

  let profile;
  try {
    profile = await profileFromCode(pending.provider, { code, codeVerifier: pending.codeVerifier });
  } catch (error) {
    if (!(error instanceof OAuthExchangeError)) throw error;
    logError("auth.oauth_exchange", error);
    return fail("oauthFailed");
  }

  const outcome = await resolveSignIn({
    provider: pending.provider,
    profile,
    currentUserId: current?.id ?? null,
  });
  if (!outcome.ok) return fail(outcome.code);

  if (sessionToken) await auth.endSession(sessionToken);
  await setSessionCookie(await auth.issueSession(outcome.userId, (await headers()).get("user-agent")));
  const next = outcome.how === "linked" && pending.next === "/" ? "/account?tab=connections" : pending.next;
  return NextResponse.redirect(`${publicUrl()}${next}`);
}
