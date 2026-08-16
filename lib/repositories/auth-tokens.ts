import { one, run, runStmt, type Statement } from "../db/client";
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
 * Claims the token, and answers whether it was this caller who claimed it.
 *
 * `used_at IS NULL` is the whole point. `resolve` checks it too, but that is a
 * separate round trip: two requests carrying the same link can both pass it
 * before either writes, and the update used to match on the id alone, so both
 * committed. "Single use" was a property of the read, which is the one place it
 * cannot be enforced.
 *
 * `consumedAt` is passed in rather than taken here, because the statements that
 * depend on this one identify the claim by its timestamp -- the same shape
 * `project-invitations.acceptStmt` and the membership insert beside it use.
 * `RETURNING *` so a caller with somewhere to put the answer can have it.
 */
export const consumeStmt = (id: number, consumedAt: string): Statement => ({
  text: `UPDATE auth_tokens SET used_at = ?
          WHERE id = ? AND used_at IS NULL
         RETURNING *`,
  params: [consumedAt, id],
});

export const consume = (id: number) => runStmt(consumeStmt(id, now()));

/** Issuing a new one retires the old: two live reset links is one too many. */
export const invalidateAll = (userId: number, purpose: AuthTokenPurpose) =>
  run(
    "UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL",
    [now(), userId, purpose],
  );

export const purgeExpired = () =>
  run("DELETE FROM auth_tokens WHERE expires_at <= ?", [now()]);
