import { tx } from "../db/client";
import * as apiTokens from "../repositories/api-tokens";
import * as authTokens from "../repositories/auth-tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { AuthTokenPurpose, PublicUser } from "../types";
import { hashPassword } from "../util/password";
import { newSessionToken } from "../util/tokens";
import * as templates from "./mail-templates";
import { addDays, now } from "../util/time";
import { MIN_PASSWORD, publicUser, type Result } from "./auth";
import { publicUrl } from "../public-url";
import { send } from "./mailer";

const RESET_TTL_MIN = 60;
const VERIFY_TTL_DAYS = 3;

const expiryIn = (ms: number) => new Date(Date.now() + ms).toISOString();

async function issue(userId: number, purpose: AuthTokenPurpose, expiresAt: string) {
  // A fresh link retires any earlier one, so a leaked older email is inert.
  await authTokens.invalidateAll(userId, purpose);
  const token = newSessionToken();
  await authTokens.create({ user_id: userId, purpose, token, expiresAt });
  await authTokens.purgeExpired();
  return token;
}

/* ------------------------------------------------------- password reset */

/**
 * Always resolves the same way. Whether the address is registered is not
 * something an unauthenticated caller gets to learn, so there is no branch in
 * the return value -- only in whether an email goes out.
 */
export async function requestPasswordReset(email: string, lang: "tr" | "en") {
  const user = await users.byEmail(email.trim());
  if (!user) return;

  const token = await issue(user.id, "reset", expiryIn(RESET_TTL_MIN * 60_000));
  const link = `${publicUrl()}/reset?token=${encodeURIComponent(token)}`;

  await send({
    to: user.email,
    ...templates.passwordReset({ name: user.name, link, minutes: RESET_TTL_MIN, lang }),
  });
}

export type ResetOutcome = Result<PublicUser>;

export async function completePasswordReset(
  token: string,
  password: string,
): Promise<ResetOutcome> {
  if (password.length < MIN_PASSWORD)
    return { ok: false, errors: [{ field: "password", code: "passwordShort" }] };

  const hit = await authTokens.resolve("reset", token);
  if (!hit) return { ok: false, errors: [{ field: "form", code: "linkInvalid" }] };

  // All of it or none of it. These were five independent round trips, and every
  // partial outcome is a security bug rather than an inconvenience: the new
  // password without the token consumed leaves a reset link that still works,
  // and the new password without the sessions dropped tells the owner they have
  // recovered the account while the intruder is still signed in.
  //
  // The consume goes first and everything that must not happen twice is written
  // against the claim it makes. `resolve` above already checked the link was
  // unused, but that check and this transaction are separate round trips, so two
  // requests carrying the same link could both pass it. The rest of the list is
  // safe to repeat -- deleting the same sessions again removes nothing, and an
  // address does not become more verified -- and only the password is not.
  const consumedAt = now();
  const passwordHash = await hashPassword(password);
  await tx([
    authTokens.consumeStmt(hit.row.id, consumedAt),
    users.updatePasswordForConsumedTokenStmt({
      userId: hit.user.id,
      passwordHash,
      tokenId: hit.row.id,
      consumedAt,
    }),
    // Whoever knew the old password loses their grip on the account.
    sessions.destroyAllForStmt(hit.user.id),
    // Agent tokens too. This is the recovery path -- you are here because you
    // lost control of the account, and a token that never expires and carries
    // full permissions is exactly what an intruder would keep. Killing sessions
    // while leaving those alive would have been security theatre.
    apiTokens.destroyAllForStmt(hit.user.id),
    // Reaching the inbox proves the address, so verification comes for free.
    ...(hit.user.email_verified_at ? [] : [users.markEmailVerifiedStmt(hit.user.id)]),
  ]);

  return { ok: true, value: publicUser(hit.user) };
}

/** Sign the user straight in after a reset -- they just proved themselves. */
export async function sessionAfterReset(userId: number, userAgent?: string | null) {
  const token = newSessionToken();
  await sessions.create({
    user_id: userId,
    token,
    expiresAt: addDays(new Date(), 30).toISOString(),
    userAgent: userAgent ?? null,
  });
  return token;
}

/* --------------------------------------------------------- verification */

export async function sendVerification(user: PublicUser, lang: "tr" | "en") {
  if (user.email_verified_at) return;

  const token = await issue(user.id, "verify", expiryIn(VERIFY_TTL_DAYS * 86_400_000));
  const link = `${publicUrl()}/verify?token=${encodeURIComponent(token)}`;

  await send({
    to: user.email,
    ...templates.verifyEmail({ name: user.name, link, days: VERIFY_TTL_DAYS, lang }),
  });
}

/**
 * Warns the address that just stopped being the account's.
 *
 * The new address gets a verification link and can prove itself; the old one
 * gets nothing unless we send it. That is the only channel left to somebody
 * whose account was taken over, so it is the one that matters.
 */
export async function sendEmailChanged(
  previousEmail: string,
  user: PublicUser,
  lang: "tr" | "en",
) {
  await send({
    to: previousEmail,
    ...templates.emailChanged({
      name: user.name,
      username: user.username,
      previousEmail,
      newEmail: user.email,
      forgotUrl: `${publicUrl()}/forgot`,
      lang,
    }),
  });
}

export async function completeVerification(token: string): Promise<boolean> {
  const hit = await authTokens.resolve("verify", token);
  if (!hit) return false;
  // Together: marking the address verified while leaving the link usable, or
  // burning the link without recording the result, are both worse than failing.
  // The consume leads here too, for the same reason it does in the reset -- but
  // nothing downstream needs guarding, because verifying an address twice
  // arrives at the state it was already going to.
  await tx([
    authTokens.consumeStmt(hit.row.id, now()),
    users.markEmailVerifiedStmt(hit.user.id),
  ]);
  return true;
}
