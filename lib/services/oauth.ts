import { randomBytes } from "node:crypto";

import { runStmt } from "../db/client";
import * as oauthAccounts from "../repositories/oauth-accounts";
import type { OAuthProvider } from "../repositories/oauth-accounts";
import * as users from "../repositories/users";
import { logInfo } from "../server/log";
import type { OAuthProfile } from "./oauth-providers";

/**
 * What a sign-in through Google or GitHub turns into.
 *
 * Four cases, in this order:
 *  1. the identity is already linked: that account, or a refusal if somebody
 *     else is signed in here and the identity is theirs;
 *  2. somebody is signed in: link the identity to them (the account page's
 *     "connect" button);
 *  3. the address belongs to an account: link and sign in, but only when the
 *     provider has verified the address -- otherwise anybody could open a
 *     provider account under your address and walk into yours;
 *  4. nobody: a new account, with no password.
 */
export type SignInOutcome =
  | { ok: true; userId: number; how: "signed_in" | "linked" | "created" }
  | { ok: false; code: OAuthErrorCode };

export type OAuthErrorCode =
  | "oauthLinkedElsewhere"
  | "oauthProviderTaken"
  | "oauthEmailUnverified"
  | "oauthNoEmail"
  | "oauthFailed";

export async function resolveSignIn(input: {
  provider: OAuthProvider;
  profile: OAuthProfile;
  currentUserId: number | null;
}): Promise<SignInOutcome> {
  const { provider, profile, currentUserId } = input;
  const linked = await oauthAccounts.byIdentity(provider, profile.providerUserId);
  if (linked) {
    if (currentUserId !== null && linked.user_id !== currentUserId)
      return { ok: false, code: "oauthLinkedElsewhere" };
    return { ok: true, userId: linked.user_id, how: currentUserId === null ? "signed_in" : "linked" };
  }

  if (currentUserId !== null) return link(currentUserId, provider, profile, "linked");

  if (!profile.email) return { ok: false, code: "oauthNoEmail" };
  const owner = await users.byEmail(profile.email);
  if (owner) {
    if (!profile.isEmailVerified) return { ok: false, code: "oauthEmailUnverified" };
    return link(owner.id, provider, profile, "signed_in");
  }
  return create(provider, profile);
}

async function link(
  userId: number,
  provider: OAuthProvider,
  profile: OAuthProfile,
  how: "signed_in" | "linked",
): Promise<SignInOutcome> {
  try {
    await runStmt(
      oauthAccounts.createStmt({
        userId,
        provider,
        providerUserId: profile.providerUserId,
        email: profile.email,
      }),
    );
  } catch (error) {
    // The account already has a different identity from this provider.
    if (isUniqueViolation(error)) return { ok: false, code: "oauthProviderTaken" };
    throw error;
  }
  logInfo("account.oauth_linked", { userId, provider });
  return { ok: true, userId, how };
}

const CREATE_ATTEMPTS = 5;

async function create(provider: OAuthProvider, profile: OAuthProfile): Promise<SignInOutcome> {
  const email = profile.email;
  if (!email) return { ok: false, code: "oauthNoEmail" };
  const base = usernameBase(profile.usernameHint);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const username = usernameCandidate(base, attempt);
    if (await users.byUsername(username)) continue;
    const user = await oauthAccounts.createUserWithIdentity({
      username,
      email,
      name: profile.name.trim() || username,
      isEmailVerified: profile.isEmailVerified,
      provider,
      providerUserId: profile.providerUserId,
    });
    if (user) {
      logInfo("account.registered", { userId: user.id, via: provider });
      return { ok: true, userId: user.id, how: "created" };
    }
    // Taken between the check and the insert: the address, or the username.
    if (await users.byEmail(email)) return { ok: false, code: "oauthFailed" };
  }
  return { ok: false, code: "oauthFailed" };
}

/** The shape `validateRegistration` accepts: 3-32 of `[a-z0-9_-]`. */
export function usernameBase(hint: string): string {
  const cleaned = hint
    .replace(/ı/g, "i")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : `user-${cleaned}`.replace(/-$/, "").padEnd(3, "0");
}

/** The base, then the base with a number, then with something random. */
export function usernameCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base;
  if (attempt < 3) return `${base}-${attempt + 1}`;
  return `${base}-${randomBytes(3).toString("hex")}`;
}

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";

/** The account page's "disconnect": refused when it is the last way in. */
export async function unlink(userId: number, provider: OAuthProvider): Promise<boolean> {
  const removed = await oauthAccounts.removeUnlessLast(userId, provider);
  return removed > 0;
}
