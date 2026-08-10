import { all, one, run, runStmt, type Statement } from "../db/client";
import type { ApiToken, User } from "../types";
import { hashToken } from "../util/tokens";
import { now } from "../util/time";

export const listByUser = (userId: number) =>
  all<ApiToken>("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC", [
    userId,
  ]);

export async function create(input: {
  user_id: number;
  name: string;
  token: string;
}): Promise<ApiToken> {
  const row = await one<ApiToken>(
    `INSERT INTO api_tokens (user_id, name, token_hash, created_at)
     VALUES (?, ?, ?, ?) RETURNING *`,
    [input.user_id, input.name, hashToken(input.token), now()],
  );
  return row!;
}

/** Resolves a bearer token to its owner and records that it was used. */
export async function userForToken(token: string): Promise<User | undefined> {
  const row = await one<User & { token_id: number }>(
    `SELECT u.*, t.id AS token_id FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return undefined;

  await run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [now(), row.token_id]);

  const { token_id: _omit, ...user } = row;
  return user;
}

export const remove = (id: number, userId: number) =>
  run("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", [id, userId]);

/** Every agent token for one account. Used when the account itself is in doubt. */
export const destroyAllForStmt = (userId: number): Statement => ({
  text: "DELETE FROM api_tokens WHERE user_id = ?",
  params: [userId],
});

export const destroyAllFor = (userId: number) => runStmt(destroyAllForStmt(userId));
