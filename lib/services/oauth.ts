import { randomBytes } from "node:crypto";

import { tx, type Statement } from "../db/client";
import * as apiTokens from "../repositories/api-tokens";
import * as authTokens from "../repositories/auth-tokens";
import * as oauthAccounts from "../repositories/oauth-accounts";
import type { OAuthProvider } from "../repositories/oauth-accounts";
import * as refreshTokens from "../repositories/oauth-refresh-tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import { logInfo } from "../server/log";
import { newSessionToken } from "../util/tokens";
import { now } from "../util/time";
import type { OAuthProfile } from "./oauth-providers";
import { canRegister } from "./registration";

/**
 * What a sign-in through Google or GitHub turns into.
 *
 * Four cases, in this order:
 *  1. the identity is already linked: that account -- a sign-in, or for the
 *     account that is signed in here, a fresh proof that it is theirs; a
 *     refusal if somebody else is signed in and the identity is not theirs;
 *  2. somebody is signed in: link the identity to them, but only with a
 *     `oauth_link` grant minted by re-entering the password. A session cookie
 *     alone used to be enough, so a stolen one could attach the thief's own
 *     identity -- a way back in that no password change or reset ended;
 *  3. the address belongs to an account: link and sign in, but only when the
 *     provider has verified the address -- otherwise anybody could open a
 *     provider account under your address and walk into yours. If the account
 *     never proved that address itself, whoever registered it may not be the
 *     person it belongs to, so it is handed over clean: no password, no
 *     sessions, no agent tokens;
 *  4. nobody: a new account, with no password.
 */
export type SignInOutcome =
  | {
      ok: true;
      userId: number;
      how: "signed_in" | "reauthenticated" | "linked" | "created";
      /** An identity was attached to an existing account just now. */
      isNewLink?: boolean;
    }
  | { ok: false; code: OAuthErrorCode };

export type OAuthErrorCode =
  | "oauthLinkedElsewhere"
  | "oauthProviderTaken"
  | "oauthEmailUnverified"
  | "oauthNoEmail"
  | "oauthLinkExpired"
  | "registrationClosed"
  | "oauthFailed";

/** Ten minutes from typing the password to finishing at the provider. */
const LINK_GRANT_MS = 10 * 60_000;

/**
 * The permission to link, handed out once the password (or, for an account
 * without one, a recent sign-in) has been checked by the caller.
 */
export async function issueLinkGrant(userId: number): Promise<string> {
  await authTokens.invalidateAll(userId, "oauth_link");
  const token = newSessionToken();
  await authTokens.create({
    user_id: userId,
    purpose: "oauth_link",
    token,
    expiresAt: new Date(Date.now() + LINK_GRANT_MS).toISOString(),
  });
  return token;
}

export async function resolveSignIn(input: {
  provider: OAuthProvider;
  profile: OAuthProfile;
  currentUserId: number | null;
  linkGrant?: string;
  inviteToken?: string;
}): Promise<SignInOutcome> {
  const { provider, profile, currentUserId } = input;
  const linked = await oauthAccounts.byIdentity(provider, profile.providerUserId);
  if (linked) {
    if (currentUserId === null) return { ok: true, userId: linked.user_id, how: "signed_in" };
    if (linked.user_id !== currentUserId) return { ok: false, code: "oauthLinkedElsewhere" };
    return { ok: true, userId: linked.user_id, how: "reauthenticated" };
  }

  if (currentUserId !== null) {
    const grant = input.linkGrant ? await authTokens.resolve("oauth_link", input.linkGrant) : undefined;
    if (!grant || grant.user.id !== currentUserId) return { ok: false, code: "oauthLinkExpired" };
    return link({ userId: currentUserId, provider, profile, how: "linked", grantId: grant.row.id });
  }

  if (!profile.email) return { ok: false, code: "oauthNoEmail" };
  if (!profile.isEmailVerified) return { ok: false, code: "oauthEmailUnverified" };
  const owner = await users.byEmail(profile.email);
  if (owner) {
    return link({
      userId: owner.id,
      provider,
      profile,
      how: "signed_in",
      takeOver: owner.email_verified_at === null,
    });
  }
  if (!(await canRegister(profile.email, input.inviteToken))) return { ok: false, code: "registrationClosed" };
  return create(provider, { ...profile, email: profile.email });
}

async function link(input: {
  userId: number;
  provider: OAuthProvider;
  profile: OAuthProfile;
  how: "signed_in" | "linked";
  grantId?: number;
  takeOver?: boolean;
}): Promise<SignInOutcome> {
  const { userId, provider, profile, how } = input;
  // All of it or none: an identity linked while the squatter's password or
  // tokens survive is the hijack this exists to stop, and a grant left
  // unspent after a link could be spent again.
  const statements: Statement[] = [
    ...(input.grantId !== undefined ? [authTokens.consumeStmt(input.grantId, now())] : []),
    oauthAccounts.createStmt({
      userId,
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
    }),
    ...(input.takeOver
      ? [
          users.clearPasswordStmt(userId),
          sessions.destroyAllForStmt(userId),
          apiTokens.destroyAllForStmt(userId),
          refreshTokens.revokeAllForUserStmt(userId, now()),
          users.markEmailVerifiedStmt(userId),
        ]
      : []),
  ];
  try {
    await tx(statements);
  } catch (error) {
    // The account already has a different identity from this provider.
    if (isUniqueViolation(error)) return { ok: false, code: "oauthProviderTaken" };
    throw error;
  }
  logInfo("account.oauth_linked", { userId, provider, takeOver: input.takeOver === true });
  return { ok: true, userId, how, isNewLink: true };
}

const CREATE_ATTEMPTS = 5;

async function create(provider: OAuthProvider, profile: OAuthProfile & { email: string }): Promise<SignInOutcome> {
  const { email } = profile;
  const base = usernameBase(profile.usernameHint);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const username = usernameCandidate(base, attempt);
    if (await users.byUsername(username)) continue;
    const user = await oauthAccounts.createUserWithIdentity({
      username,
      email,
      name: profile.name.trim() || username,
      isEmailVerified: true,
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

/** A URL-safe account name. The remaining space is for a collision suffix. */
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
