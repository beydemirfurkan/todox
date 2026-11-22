import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { OAUTH_COOKIE, SESSION_COOKIE } from "@/lib/cookies";
import { publicUrl } from "@/lib/public-url";
import { logError } from "@/lib/server/log";
import * as auth from "@/lib/services/auth";
import { resolveSignIn } from "@/lib/services/oauth";
import { decodePending, stateMatches } from "@/lib/services/oauth-flow";
import { OAuthExchangeError, profileFromCode } from "@/lib/services/oauth-providers";
import { getLang } from "@/lib/lang";
import * as users from "@/lib/repositories/users";
import { sendProviderLinked } from "@/lib/services/account-recovery";
import { setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Back from the provider. The state in the cookie must match the one in the
 * address -- that is what makes this a reply to a trip this browser started,
 * not a link somebody else crafted -- and the cookie is spent either way.
 *
 * A sign-in opens a new session and ends the one before it. So does a trip
 * through an identity already linked to the signed-in account, which is how an
 * account without a password proves itself again: the fresh session is the
 * recent sign-in `auth.ts` asks for. Linking a new identity does not.
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
    linkGrant: pending.linkGrant,
  });
  if (!outcome.ok) return fail(outcome.code);

  if (outcome.isNewLink) await notifyLinked(outcome.userId, pending.provider);

  // A link keeps the session it was made from. Issuing a fresh one here made
  // the link itself count as the "recent sign-in" that lets an account without
  // a password set one, change its address or delete itself -- so whoever
  // linked could then do all three. Only a sign-in, or a trip through an
  // identity that was already this account's, opens a new session.
  if (outcome.how !== "linked") {
    if (sessionToken) await auth.endSession(sessionToken);
    await setSessionCookie(
      await auth.issueSession(outcome.userId, (await headers()).get("user-agent")),
    );
  }
  const next = outcome.how === "linked" && pending.next === "/" ? "/account?tab=connections" : pending.next;
  return NextResponse.redirect(`${publicUrl()}${next}`);
}

const PROVIDER_NAME = { google: "Google", github: "GitHub" } as const;

/** Best effort: a mail that fails must not undo a link that succeeded. */
async function notifyLinked(userId: number, provider: keyof typeof PROVIDER_NAME) {
  try {
    const user = await users.byId(userId);
    if (user) await sendProviderLinked(user, PROVIDER_NAME[provider], await getLang());
  } catch (error) {
    logError("auth.oauth_link_mail", error);
  }
}
