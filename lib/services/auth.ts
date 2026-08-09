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

export async function userForApiToken(token: string): Promise<PublicUser | undefined> {
  const u = await apiTokens.userForToken(token);
  return u ? publicUser(u) : undefined;
}
