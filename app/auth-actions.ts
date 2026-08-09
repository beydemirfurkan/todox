"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getLang } from "@/lib/lang";
import {
  completePasswordReset,
  requestPasswordReset,
  sendEmailChanged,
  sendVerification,
  sessionAfterReset,
} from "@/lib/services/account-recovery";
import * as auth from "@/lib/services/auth";
import * as limit from "@/lib/services/rate-limit";
import { clearSessionCookie, requireUser, setSessionCookie } from "@/lib/session";

const str = (fd: FormData, k: string) => (fd.get(k) as string | null)?.trim() ?? "";
/** Passwords keep their whitespace; trimming them silently changes the secret. */
const raw = (fd: FormData, k: string) => (fd.get(k) as string | null) ?? "";

export type AuthState = { errors: auth.FieldError[] } | null;

const tooMany = (retryAfterSec: number): AuthState => ({
  errors: [
    {
      field: "form",
      code: "tooManyAttempts",
      retryAfterSec: Math.ceil(retryAfterSec / 60),
    },
  ],
});

/**
 * Behind a proxy the socket address is the proxy's. Trust the left-most
 * forwarded hop when one is present, and fall back to a constant so a missing
 * header degrades into a shared bucket rather than into no limit at all.
 */
async function clientIp() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

async function startSession(userId: number) {
  const ua = (await headers()).get("user-agent");
  await setSessionCookie(await auth.issueSession(userId, ua));
}

/* -------------------------------------------------------------- register */

export async function registerAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const ip = await clientIp();
  const gate = await limit.consume("registerPerIp", ip);
  if (!gate.allowed) return tooMany(gate.retryAfterSec);

  const result = await auth.register({
    username: str(fd, "username"),
    email: str(fd, "email"),
    name: str(fd, "name"),
    password: raw(fd, "password"),
  });
  if (!result.ok) return { errors: result.errors };

  await sendVerification(result.value.user, await getLang());
  await startSession(result.value.user.id);
  redirect("/");
}

/* ----------------------------------------------------------------- login */

export async function loginAction(_prev: AuthState, fd: FormData): Promise<AuthState> {
  const identifier = str(fd, "identifier");
  const ip = await clientIp();

  // Only failures count, so signing in successfully all day never locks you
  // out. Both buckets are checked before any hashing happens.
  for (const [policy, subject] of [
    ["loginPerIdentity", identifier],
    ["loginPerIp", ip],
  ] as const) {
    const gate = await limit.check(policy, subject);
    if (!gate.allowed) return tooMany(gate.retryAfterSec);
  }

  const result = await auth.login({ identifier, password: raw(fd, "password") });
  if (!result.ok) {
    await limit.penalise("loginPerIdentity", identifier);
    await limit.penalise("loginPerIp", ip);
    return { errors: result.errors };
  }

  await limit.forgive("loginPerIdentity", identifier);
  await startSession(result.value.id);
  redirect("/");
}

export async function logoutAction() {
  const token = await clearSessionCookie();
  if (token) await auth.endSession(token);
  redirect("/login");
}

/* -------------------------------------------------------- password reset */

export async function requestResetAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const email = str(fd, "email");
  const ip = await clientIp();

  for (const [policy, subject] of [
    ["resetPerIp", ip],
    ["resetPerEmail", email],
  ] as const) {
    const gate = await limit.consume(policy, subject);
    if (!gate.allowed) return tooMany(gate.retryAfterSec);
  }

  await requestPasswordReset(email, await getLang());
  // Same answer whether or not the address exists.
  redirect("/forgot?sent=1");
}

export async function resetPasswordAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const gate = await limit.consume("resetPerIp", await clientIp());
  if (!gate.allowed) return tooMany(gate.retryAfterSec);

  const result = await completePasswordReset(str(fd, "token"), raw(fd, "password"));
  if (!result.ok) return { errors: result.errors };

  const ua = (await headers()).get("user-agent");
  await setSessionCookie(await sessionAfterReset(result.value.id, ua));
  redirect("/");
}

/* --------------------------------------------------------- verification */

export async function resendVerificationAction() {
  const user = await requireUser();
  const gate = await limit.consume("verifyResendPerUser", String(user.id));
  if (!gate.allowed) return;
  await sendVerification(user, await getLang());
  revalidatePath("/account");
}

/* ----------------------------------------------------------- the account */

export async function changePasswordAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const user = await requireUser();
  const result = await auth.changePassword(
    user.id,
    raw(fd, "current"),
    raw(fd, "password"),
  );
  if (!result.ok) return { errors: result.errors };

  // changePassword kills every session, including this one.
  await clearSessionCookie();
  redirect("/login");
}

export async function updateNameAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const user = await requireUser();
  const result = await auth.changeName(user.id, str(fd, "name"));
  if (!result.ok) return { errors: result.errors };
  revalidatePath("/account");
  return { errors: [] };
}

/**
 * Deliberately its own action, and it costs the password.
 *
 * Changing the address is the first half of an account takeover: point it at
 * an address you control, then run the forgot-password flow. Sharing a submit
 * button with the display name made that a side effect of "save profile".
 */
export async function changeEmailAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const user = await requireUser();

  // Unmetered, this was "send mail from your domain to any address I name",
  // routing around the limit on resendVerificationAction.
  const gate = await limit.consume("emailChangePerUser", String(user.id));
  if (!gate.allowed) return tooMany(gate.retryAfterSec);

  const result = await auth.changeEmail(user.id, raw(fd, "current"), str(fd, "email"));
  if (!result.ok) return { errors: result.errors };

  const { user: updated, previousEmail } = result.value;
  if (updated.email.toLowerCase() !== previousEmail.toLowerCase()) {
    const lang = await getLang();
    await sendVerification(updated, lang);
    // The old address is the only channel left to someone who has been locked
    // out, so it hears about this even though it is no longer the account's.
    await sendEmailChanged(previousEmail, updated, lang);
  }

  revalidatePath("/account");
  return { errors: [] };
}

/* ------------------------------------------------------------ api tokens */

export async function createTokenAction(fd: FormData) {
  const user = await requireUser();
  const name = str(fd, "name") || "mcp";
  const { token } = await auth.createApiToken(user.id, name);
  // Shown exactly once, via the URL, then never recoverable.
  redirect(`/account?created=${encodeURIComponent(token)}`);
}

export async function revokeTokenAction(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("token_id"));
  // NaN would reach an integer column and come back as a 500.
  if (!Number.isInteger(id)) return;
  await auth.revokeApiToken(id, user.id);
  revalidatePath("/account");
}

/**
 * Tokens never expire and carry the whole account, so "I think one of these
 * leaked" needs an answer that does not depend on knowing which.
 */
export async function revokeAllTokensAction() {
  const user = await requireUser();
  await auth.revokeAllApiTokens(user.id);
  revalidatePath("/account");
}
