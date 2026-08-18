"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getLang } from "@/lib/lang";
import {
  completePasswordReset,
  completeVerification,
  requestPasswordReset,
  sendEmailChanged,
  sendVerification,
  sessionAfterReset,
} from "@/lib/services/account-recovery";
import * as auth from "@/lib/services/auth";
import * as limit from "@/lib/services/rate-limit";
import { clientIp as addressOf } from "@/lib/server/client-ip";
import { clearSessionCookie, requireUser, setSessionCookie } from "@/lib/session";

const str = (fd: FormData, k: string) => (fd.get(k) as string | null)?.trim() ?? "";
/** Passwords keep their whitespace; trimming them silently changes the secret. */
const raw = (fd: FormData, k: string) => (fd.get(k) as string | null) ?? "";

const inviteNext = (fd: FormData) => {
  const value = str(fd, "next");
  return /^\/invite\?token=[A-Za-z0-9_-]{32,}$/.test(value) ? value : "/";
};

export type AuthState = { errors: auth.FieldError[] } | null;

/**
 * Kept apart from `AuthState`: creating a token has no failure a *field* could
 * carry, and folding it in would hand the token form the "no errors means it
 * worked" success banner the auth forms rely on.
 *
 * It does have one failure now. Minting is metered, and a refusal that returned
 * `null` would be indistinguishable from never having submitted -- the button
 * would settle and nothing would appear, which is the silent no-op this
 * codebase keeps finding. So the refusal is a state of its own.
 */
export type TokenState =
  | { token: string }
  | { tooManyMinutes: number }
  | null;

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
 * Who to meter this request against.
 *
 * This used to read `x-forwarded-for`'s left-most hop itself, which is the end
 * of the list the caller writes: one forged header per request put every
 * attempt in a fresh bucket, and `loginPerIp` / `registerPerIp` / `resetPerIp`
 * are enforced nowhere else. `lib/server/client-ip.ts` was written to close
 * exactly that -- its own comment names these limits -- and was wired into the
 * two agent routes but never into here.
 *
 * So there is no local reading of the header any more. Counting from the right
 * belongs in one place, because the number of hops to trust is a fact about
 * the deployment and cannot be re-derived correctly twice.
 */
async function clientIp() {
  return addressOf(await headers());
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
  redirect(inviteNext(fd));
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
  redirect(inviteNext(fd));
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

/**
 * Verification happens here rather than while the page renders.
 *
 * It used to be a side effect of the GET: opening the link consumed the token.
 * Corporate mail scanners fetch every link in a message before the human sees
 * it, so the token was spent by a robot and the person who clicked was told
 * their link was invalid.
 */
export async function verifyEmailAction(fd: FormData) {
  const token = str(fd, "token");
  const ok = token ? await completeVerification(token) : false;
  redirect(ok ? "/verify?state=ok" : "/verify?state=failed");
}

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

/**
 * Rate-limited on the same bucket as an email change: both are gated on the
 * password, and a gate you can guess at without limit is not one.
 */
export async function deleteAccountAction(
  _prev: AuthState,
  fd: FormData,
): Promise<AuthState> {
  const user = await requireUser();

  // Only failures count. Consuming up front meant five mistyped confirmations
  // locked you out of deleting the account *and* changing the address for an
  // hour, having succeeded at neither.
  const gate = await limit.check("emailChangePerUser", String(user.id));
  if (!gate.allowed) return tooMany(gate.retryAfterSec);

  const result = await auth.deleteAccount(
    user.id,
    raw(fd, "password"),
    str(fd, "confirm"),
  );
  if (!result.ok) {
    await limit.penalise("emailChangePerUser", String(user.id));
    return { errors: result.errors };
  }

  // The session row went with the account; the cookie pointing at it has to go
  // too, or the next request spends a query proving it is dead.
  await clearSessionCookie();
  redirect("/login");
}

/* ------------------------------------------------------------ api tokens */

/**
 * Shown exactly once, in the reply to the submission that created it.
 *
 * It used to travel as `?created=`, which cost the caller their scroll position
 * -- a redirect is a navigation -- and left a live token in browser history, in
 * `Referer`, and in every access log between here and the user.
 *
 * The token is all that comes back. The setup snippets are built in the browser
 * from it, because there is no version of them the server should be composing
 * for a client it cannot see: the last attempt at that hard-coded the server's
 * own working directory into a command meant for somebody else's laptop.
 */
export async function createTokenAction(
  _prev: TokenState,
  fd: FormData,
): Promise<TokenState> {
  const user = await requireUser();
  // Nothing counted these. They never expire and each one carries the whole
  // account, so an unmetered mint is an unmetered supply of long-lived
  // credentials -- the one thing on this page worth a ceiling.
  const gate = await limit.consume("tokenPerUser", String(user.id));
  if (!gate.allowed) return { tooManyMinutes: Math.ceil(gate.retryAfterSec / 60) };
  const name = str(fd, "name") || "mcp";
  const { token } = await auth.createApiToken(user.id, name);
  // Without this the new row is missing from the list until something else
  // re-renders the page.
  revalidatePath("/account");
  return { token };
}

export async function revokeTokenAction(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("token_id"));
  // NaN would reach an integer column and come back as a 500. The `> 0` is not
  // decoration: `Number("")` is 0, which is an integer, so a missing field got
  // through this guard and spent a delete on an id no row can have.
  if (!Number.isInteger(id) || id <= 0) return;
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
