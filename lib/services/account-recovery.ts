import * as authTokens from "../repositories/auth-tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { AuthTokenPurpose, PublicUser } from "../types";
import { hashPassword } from "../util/password";
import { newSessionToken } from "../util/tokens";
import { addDays } from "../util/time";
import { MIN_PASSWORD, publicUser, type Result } from "./auth";
import { baseUrl, send } from "./mailer";

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
  const link = `${baseUrl()}/reset?token=${encodeURIComponent(token)}`;

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

  await users.updatePassword(hit.user.id, await hashPassword(password));
  await authTokens.consume(hit.row.id);
  // Whoever knew the old password loses their grip on the account.
  await sessions.destroyAllFor(hit.user.id);

  // Reaching the inbox proves the address, so verification comes for free.
  if (!hit.user.email_verified_at) await users.markEmailVerified(hit.user.id);

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
  const link = `${baseUrl()}/verify?token=${encodeURIComponent(token)}`;

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

export async function completeVerification(token: string): Promise<boolean> {
  const hit = await authTokens.resolve("verify", token);
  if (!hit) return false;
  await users.markEmailVerified(hit.user.id);
  await authTokens.consume(hit.row.id);
  return true;
}
