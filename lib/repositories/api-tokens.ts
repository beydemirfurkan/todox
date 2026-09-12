import { all, one, run, runStmt, type Statement } from "../db/client";
import type { ApiToken, User } from "../types";
import { hashToken } from "../util/tokens";
import { now } from "../util/time";

export const listByUser = (userId: number) =>
  all<ApiToken>("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC", [
    userId,
  ]);

/**
 * Whether an agent on this account has ever actually connected.
 *
 * Not "has a token": minting one is a click, and the setup failing afterwards
 * is the exact case the prompt on the home page exists for. `last_used_at` is
 * the same line `pnpm funnel` draws between "got as far as the Account page"
 * and "the setup actually worked", so the page and the measurement agree on
 * what connected means.
 */
export const hasConnectedAgent = async (userId: number): Promise<boolean> =>
  Boolean(
    await one<{ n: number }>(
      `SELECT 1 AS n FROM api_tokens
        WHERE user_id = ? AND last_used_at IS NOT NULL
        LIMIT 1`,
      [userId],
    ),
  );

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

/** The last MCP client that announced itself on a token. */
export type ClientUse = { name: string; version: string; seenAt: string };

/**
 * What one authenticated call learns about its token, beyond who owns it.
 *
 * `client` is the last MCP client captured on this token, or null when none
 * was. It rides along on the row every call already reads, rather than being
 * looked up again by the one tool that wants it: `get_context` used to spend a
 * second query on `api_tokens` for three columns the first query had just
 * passed over.
 */
export type TokenIdentity = {
  user: User;
  tokenId: number;
  use: TokenUse;
  /** When the token was minted, so setup advice can stop once it is old. */
  createdAt: string;
  client: ClientUse | null;
};

type TokenRow = User & {
  token_id: number;
  token_created_at: string;
  last_used_at: string | null;
  last_client_name: string | null;
  last_client_version: string | null;
  last_client_seen_at: string | null;
};

export async function userForToken(token: string): Promise<TokenIdentity | undefined> {
  const row = await one<TokenRow>(
    `SELECT u.*, t.id AS token_id, t.created_at AS token_created_at, t.last_used_at,
            t.last_client_name, t.last_client_version, t.last_client_seen_at
       FROM api_tokens t
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

  const {
    token_id,
    token_created_at,
    last_used_at: _omit,
    last_client_name,
    last_client_version,
    last_client_seen_at,
    ...user
  } = row;
  const client =
    last_client_name && last_client_version && last_client_seen_at
      ? { name: last_client_name, version: last_client_version, seenAt: last_client_seen_at }
      : null;
  return { user, tokenId: token_id, use, createdAt: token_created_at, client };
}

export const remove = (id: number, userId: number) =>
  run("DELETE FROM api_tokens WHERE id = ? AND user_id = ?", [id, userId]);

/** Every agent token for one account. Used when the account itself is in doubt. */
export const destroyAllForStmt = (userId: number): Statement => ({
  text: "DELETE FROM api_tokens WHERE user_id = ?",
  params: [userId],
});

export const destroyAllFor = (userId: number) => runStmt(destroyAllForStmt(userId));

export const recordClientUse = (tokenHash: string, use: ClientUse): Promise<number> =>
  run(
    `UPDATE api_tokens
        SET last_client_name = ?, last_client_version = ?, last_client_seen_at = ?
      WHERE token_hash = ?`,
    [use.name, use.version, use.seenAt, tokenHash],
  );

