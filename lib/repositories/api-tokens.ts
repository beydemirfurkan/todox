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
/**
 * The account behind an agent token, and how this call sits in that token's
 * history.
 *
 * `use` is the activation signal, and it costs nothing: the row is already
 * being read and `last_used_at` already being written, so the value it is about
 * to overwrite is the one piece of evidence for whether anybody actually
 * *uses* todox after connecting it. "first" is the tool working once; "return"
 * is a token that came back on a later day, which is the only one of the two
 * that means the habit stuck.
 */
export type TokenUse = "first" | "return" | "same-day";

export async function userForToken(
  token: string,
): Promise<{ user: User; tokenId: number; use: TokenUse } | undefined> {
  const row = await one<User & { token_id: number; last_used_at: string | null }>(
    `SELECT u.*, t.id AS token_id, t.last_used_at FROM api_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return undefined;

  const at = now();
  // Compared as dates rather than as a duration: "came back the next day" is
  // the question, and an hour either side of midnight should not change the
  // answer the way a 24-hour window would.
  const previous = row.last_used_at;
  const use: TokenUse =
    previous === null ? "first" : previous.slice(0, 10) === at.slice(0, 10) ? "same-day" : "return";

  await run("UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [at, row.token_id]);

  const { token_id, last_used_at: _omit, ...user } = row;
  return { user, tokenId: token_id, use };
}

export const remove = (id: number, userId: number) =>
  run("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", [id, userId]);

/** Every agent token for one account. Used when the account itself is in doubt. */
export const destroyAllForStmt = (userId: number): Statement => ({
  text: "DELETE FROM api_tokens WHERE user_id = ?",
  params: [userId],
});

export const destroyAllFor = (userId: number) => runStmt(destroyAllForStmt(userId));

export type ClientUse = { name: string; version: string; seenAt: string };

export const recordClientUse = (tokenHash: string, use: ClientUse): Promise<number> =>
  run(
    `UPDATE api_tokens
        SET last_client_name = ?, last_client_version = ?, last_client_seen_at = ?
      WHERE token_hash = ?`,
    [use.name, use.version, use.seenAt, tokenHash],
  );

export const lastClientUse = (tokenHash: string): Promise<ClientUse | null> =>
  one<ClientUse>(
    `SELECT last_client_name    AS name,
            last_client_version AS version,
            last_client_seen_at AS "seenAt"
       FROM api_tokens
      WHERE token_hash = ?
        AND last_client_seen_at IS NOT NULL`,
    [tokenHash],
  ).then((row) => row ?? null);
