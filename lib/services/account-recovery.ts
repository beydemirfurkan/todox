import { tx } from "../db/client";
import * as apiTokens from "../repositories/api-tokens";
import * as authTokens from "../repositories/auth-tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { AuthTokenPurpose, PublicUser } from "../types";
import { hashPassword } from "../util/password";
import { newSessionToken } from "../util/tokens";
import { addDays } from "../util/time";
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
    subject: lang === "tr" ? "todox şifre sıfırlama" : "Reset your todox password",
    text:
      lang === "tr"
        ? [
            `Merhaba ${user.name},`,
            "",
            "Şifreni sıfırlamak için bu bağlantıyı aç:",
            link,
            "",
            `Bağlantı ${RESET_TTL_MIN} dakika geçerli ve yalnızca bir kez kullanılabilir.`,
            "Bu isteği sen yapmadıysan hiçbir şey yapmana gerek yok.",
          ].join("\n")
        : [
            `Hi ${user.name},`,
            "",
            "Open this link to set a new password:",
            link,
            "",
            `It is valid for ${RESET_TTL_MIN} minutes and works once.`,
            "If you did not ask for this, you can ignore it.",
          ].join("\n"),
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
  await tx([
    users.updatePasswordStmt(hit.user.id, await hashPassword(password)),
    authTokens.consumeStmt(hit.row.id),
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
    subject: lang === "tr" ? "todox e-posta doğrulama" : "Confirm your todox email",
    text:
      lang === "tr"
        ? [
            `Merhaba ${user.name},`,
            "",
            "E-posta adresini doğrulamak için:",
            link,
            "",
            `Bağlantı ${VERIFY_TTL_DAYS} gün geçerli.`,
          ].join("\n")
        : [
            `Hi ${user.name},`,
            "",
            "Confirm your email address:",
            link,
            "",
            `The link is valid for ${VERIFY_TTL_DAYS} days.`,
          ].join("\n"),
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
    subject:
      lang === "tr" ? "todox e-posta adresin değişti" : "Your todox email was changed",
    text:
      lang === "tr"
        ? [
            `Merhaba ${user.name},`,
            "",
            `@${user.username} hesabının e-posta adresi ${previousEmail} yerine`,
            `${user.email} olarak değiştirildi.`,
            "",
            "Bunu sen yaptıysan yapman gereken bir şey yok.",
            "Yapmadıysan hesabına başkası erişiyor demektir: hemen şifreni",
            `sıfırla (${publicUrl()}/forgot) ve ajan tokenlarını iptal et.`,
          ].join("\n")
        : [
            `Hi ${user.name},`,
            "",
            `The email address on @${user.username} was changed from ${previousEmail}`,
            `to ${user.email}.`,
            "",
            "If that was you, there is nothing to do.",
            "If it was not, somebody else has access: reset your password now",
            `(${publicUrl()}/forgot) and revoke your agent tokens.`,
          ].join("\n"),
  });
}

export async function completeVerification(token: string): Promise<boolean> {
  const hit = await authTokens.resolve("verify", token);
  if (!hit) return false;
  // Together: marking the address verified while leaving the link usable, or
  // burning the link without recording the result, are both worse than failing.
  await tx([users.markEmailVerifiedStmt(hit.user.id), authTokens.consumeStmt(hit.row.id)]);
  return true;
}
