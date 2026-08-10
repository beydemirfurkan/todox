import * as apiTokens from "../repositories/api-tokens";
import * as sessions from "../repositories/sessions";
import * as users from "../repositories/users";
import type { ApiToken, PublicUser, User } from "../types";
import { hashPassword, verifyPassword } from "../util/password";
import { SESSION_DAYS, newApiToken, newSessionToken, tokenPreview } from "../util/tokens";
import { addDays } from "../util/time";

/** `retryAfterSec` is only set by the rate limiter, and is minutes by the time
 *  it reaches the UI -- the field carries whatever the message needs. */
export type FieldError = { field: string; code: string; retryAfterSec?: number };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const USERNAME_RE = /^[a-z0-9_-]{3,32}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MIN_PASSWORD = 8;

export const publicUser = (u: User): PublicUser => {
  const { password_hash: _omit, ...rest } = u;
  return rest;
};

export function validateRegistration(input: {
  username: string;
  email: string;
  name: string;
  password: string;
}): FieldError[] {
  const errors: FieldError[] = [];
  if (!USERNAME_RE.test(input.username))
    errors.push({ field: "username", code: "usernameFormat" });
  if (!EMAIL_RE.test(input.email)) errors.push({ field: "email", code: "emailFormat" });
  if (input.name.trim().length < 2) errors.push({ field: "name", code: "nameRequired" });
  if (input.password.length < MIN_PASSWORD)
    errors.push({ field: "password", code: "passwordShort" });
  return errors;
}

export async function register(input: {
  username: string;
  email: string;
  name: string;
  password: string;
}): Promise<Result<{ user: PublicUser }>> {
  const errors = validateRegistration(input);
  if (errors.length) return { ok: false, errors };

  if (await users.byUsername(input.username))
    return { ok: false, errors: [{ field: "username", code: "usernameTaken" }] };
  if (await users.byEmail(input.email))
    return { ok: false, errors: [{ field: "email", code: "emailTaken" }] };

  const user = await users.create({
    username: input.username,
    email: input.email,
    name: input.name.trim(),
    password_hash: await hashPassword(input.password),
  });

  return { ok: true, value: { user: publicUser(user) } };
}

export async function login(input: {
  identifier: string;
  password: string;
}): Promise<Result<PublicUser>> {
  const user = await users.byLogin(input.identifier.trim());

  // Always run a verification so a missing account and a wrong password take
  // roughly the same time, and neither is distinguishable in the response.
  const stored =
    user?.password_hash ??
    "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(88);
  const good = await verifyPassword(input.password, stored);

  if (!user || !good)
    return { ok: false, errors: [{ field: "form", code: "badCredentials" }] };
  return { ok: true, value: publicUser(user) };
}

export async function issueSession(userId: number, userAgent?: string | null) {
  const token = newSessionToken();
  await sessions.create({
    user_id: userId,
    token,
    expiresAt: addDays(new Date(), SESSION_DAYS).toISOString(),
    userAgent: userAgent ?? null,
  });
  await sessions.purgeExpired();
  return token;
}

export const endSession = (token: string) => sessions.destroy(token);

export async function userForSession(token: string): Promise<PublicUser | undefined> {
  const u = await sessions.userForToken(token);
  return u ? publicUser(u) : undefined;
}

export async function changePassword(
  userId: number,
  current: string,
  next: string,
): Promise<Result<true>> {
  const user = await users.byId(userId);
  if (!user) return { ok: false, errors: [{ field: "form", code: "badCredentials" }] };
  if (!(await verifyPassword(current, user.password_hash)))
    return { ok: false, errors: [{ field: "current", code: "badCredentials" }] };
  if (next.length < MIN_PASSWORD)
    return { ok: false, errors: [{ field: "password", code: "passwordShort" }] };

  await users.updatePassword(userId, await hashPassword(next));
  // Every other session dies with the old password.
  await sessions.destroyAllFor(userId);
  return { ok: true, value: true };
}

/**
 * Changing the address is a credential change, so it costs the password.
 *
 * It used to need only a session cookie, which made the current-password gate
 * on `changePassword` worthless: point the account at an address you control,
 * run the forgot-password flow, and `completePasswordReset` sets a new password
 * without the old one and kills the real owner's sessions. A stolen cookie
 * became permanent ownership. The gate has to be here too, or it is nowhere.
 *
 * Returns the previous address so the caller can warn it.
 */
export async function changeEmail(
  userId: number,
  currentPassword: string,
  next: string,
): Promise<Result<{ user: PublicUser; previousEmail: string }>> {
  const user = await users.byId(userId);
  if (!user) return { ok: false, errors: [{ field: "form", code: "badCredentials" }] };

  if (!(await verifyPassword(currentPassword, user.password_hash)))
    return { ok: false, errors: [{ field: "current", code: "badCredentials" }] };

  const email = next.trim();
  if (!EMAIL_RE.test(email))
    return { ok: false, errors: [{ field: "email", code: "emailFormat" }] };

  if (email.toLowerCase() === user.email.toLowerCase())
    return { ok: true, value: { user: publicUser(user), previousEmail: user.email } };

  const clash = await users.byEmail(email);
  if (clash && clash.id !== userId)
    return { ok: false, errors: [{ field: "email", code: "emailTaken" }] };

  await users.updateEmail(userId, email);
  return {
    ok: true,
    value: {
      user: { ...publicUser(user), email, email_verified_at: null },
      previousEmail: user.email,
    },
  };
}

/**
 * Ends the account and everything hanging off it.
 *
 * The password is the gate, for the same reason `changeEmail` needs one: a
 * stolen session cookie must not be enough to destroy somebody's log. The
 * username is asked for on the way in too, but that is a confirmation and not
 * a credential -- it exists so this cannot happen by reflex.
 *
 * One statement is enough: every table that references a user does so with
 * ON DELETE CASCADE, so projects, tasks, entries, events, refs, contexts,
 * sessions and agent tokens all go with it. Deliberately unrecoverable.
 */
export async function deleteAccount(
  userId: number,
  password: string,
  confirmation: string,
): Promise<Result<true>> {
  const user = await users.byId(userId);
  if (!user) return { ok: false, errors: [{ field: "form", code: "badCredentials" }] };

  if (!(await verifyPassword(password, user.password_hash)))
    return { ok: false, errors: [{ field: "password", code: "badCredentials" }] };

  // Case-insensitive, like every other username comparison here: `byUsername`
  // matches on `lower(username)` and login accepts either case. A phone that
  // capitalises the first letter of a text field should not be able to tell
  // somebody their own username is wrong.
  if (confirmation.trim().toLowerCase() !== user.username.toLowerCase())
    return { ok: false, errors: [{ field: "confirm", code: "confirmMismatch" }] };

  await users.remove(userId);
  return { ok: true, value: true };
}

export async function changeName(userId: number, name: string): Promise<Result<true>> {
  const trimmed = name.trim();
  if (trimmed.length < 2)
    return { ok: false, errors: [{ field: "name", code: "nameRequired" }] };
  await users.updateProfile(userId, { name: trimmed });
  return { ok: true, value: true };
}

/* ------------------------------------------------------------ api tokens */

export async function createApiToken(userId: number, name: string) {
  const token = newApiToken();
  const row = await apiTokens.create({ user_id: userId, name, token });
  // The only moment the plaintext exists. It is never recoverable afterwards.
  return { row, token, preview: tokenPreview(token) };
}

export const listApiTokens = (userId: number): Promise<ApiToken[]> =>
  apiTokens.listByUser(userId);

export const revokeApiToken = (id: number, userId: number) =>
  apiTokens.remove(id, userId);

/**
 * Agent tokens carry the full permissions of the account and never expire, so
 * there has to be one action that ends all of them at once. The recovery flow
 * calls it; the account page offers it as a button.
 */
export const revokeAllApiTokens = (userId: number) => apiTokens.destroyAllFor(userId);

export async function userForApiToken(token: string): Promise<PublicUser | undefined> {
  const u = await apiTokens.userForToken(token);
  return u ? publicUser(u) : undefined;
}
