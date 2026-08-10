import { one, run, runStmt, type Statement } from "../db/client";
import type { Session, User } from "../types";
import { hashToken } from "../util/tokens";
import { now } from "../util/time";

export async function create(input: {
  user_id: number;
  token: string;
  expiresAt: string;
  userAgent?: string | null;
}): Promise<Session> {
  const row = await one<Session>(
    `INSERT INTO sessions (user_id, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [
      input.user_id,
      hashToken(input.token),
      now(),
      input.expiresAt,
      input.userAgent ?? null,
    ],
  );
  return row!;
}

/** Resolves a raw cookie value to its owner, refusing anything expired. */
export const userForToken = (token: string) =>
  one<User>(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [hashToken(token), now()],
  );

export const destroy = (token: string) =>
  run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);

export const destroyAllForStmt = (userId: number): Statement => ({
  text: "DELETE FROM sessions WHERE user_id = ?",
  params: [userId],
});

export const destroyAllFor = (userId: number) => runStmt(destroyAllForStmt(userId));

export const purgeExpired = () =>
  run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
