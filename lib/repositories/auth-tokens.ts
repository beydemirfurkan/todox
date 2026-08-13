import { one, run, type Statement } from "../db/client";
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

/**
 * Atomic single-use mark. The `used_at IS NULL` guard is the whole point: two
 * transactions racing on the same token must end with exactly one UPDATE
 * returning a row, so callers use `consumedStmt` (which RETURNs the id) inside
 * a tx and treat an empty result set as "the link was already burned -- not
 * us to consume".
 */
export const consumeStmt = (id: number): Statement => ({
  text: "UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL",
  params: [now(), id],
});

/**
 * Same effect, but returns the affected row so a service can detect the loser
 * of the race without an extra read. Use this inside a `tx()` when the
 * "already used" case must abort the surrounding work.
 */
export const consumedStmt = (id: number): Statement => ({
  text: "UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL RETURNING id",
  params: [now(), id],
});

export const consume = (id: number) => run(consumeStmt(id).text, consumeStmt(id).params);

/** Issuing a new one retires the old: two live reset links is one too many. */
export const invalidateAll = (userId: number, purpose: AuthTokenPurpose) =>
  run(
    "UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
    [now(), userId, purpose],
  );

export const purgeExpired = () =>
  run("DELETE FROM auth_tokens WHERE expires_at <= ?", [now()]);
