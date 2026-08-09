import { one, run } from "../db/client";
import type { AuthTokenPurpose, AuthTokenRow, User } from "../types";
import { hashToken } from "../util/tokens";
import { now } from "../util/time";

export async function create(input: {
  user_id: number;
  purpose: AuthTokenPurpose;
  token: string;
  expiresAt: string;
}): Promise<AuthTokenRow> {
  const row = await one<AuthTokenRow>(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [input.user_id, input.purpose, hashToken(input.token), now(), input.expiresAt],
  );
  return row!;
}

/** Unused, unexpired, and of the right purpose -- anything else is not a hit. */
export async function resolve(
  purpose: AuthTokenPurpose,
  token: string,
): Promise<{ row: AuthTokenRow; user: User } | undefined> {
  const found = await one<AuthTokenRow & { u_id: number }>(
    `SELECT t.*, u.id AS u_id FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.purpose = ? AND t.used_at IS NULL AND t.expires_at > ?`,
    [hashToken(token), purpose, now()],
  );
  if (!found) return undefined;

  const user = await one<User>("SELECT * FROM users WHERE id = ?", [found.u_id]);
  return user ? { row: found, user } : undefined;
}

export const consume = (id: number) =>
  run("UPDATE auth_tokens SET used_at = ? WHERE id = ?", [now(), id]);

/** Issuing a new one retires the old: two live reset links is one too many. */
export const invalidateAll = (userId: number, purpose: AuthTokenPurpose) =>
  run(
    "UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
    [now(), userId, purpose],
  );

export const purgeExpired = () =>
  run("DELETE FROM auth_tokens WHERE expires_at <= ?", [now()]);
