import { one, run, type Statement } from "../db/client";
import { hashToken } from "../util/tokens";

export interface OAuthRefreshToken {
  token_hash: string;
  family_id: string;
  client_id: string;
  user_id: number;
  resource: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface NewRefreshToken {
  token: string;
  family_id: string;
  client_id: string;
  user_id: number;
  resource: string;
  created_at: string;
  expires_at: string;
}

export const createStmt = (input: NewRefreshToken): Statement => ({
  text: `INSERT INTO oauth_refresh_tokens
           (token_hash, family_id, client_id, user_id, resource, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
  params: [
    hashToken(input.token),
    input.family_id,
    input.client_id,
    input.user_id,
    input.resource,
    input.created_at,
    input.expires_at,
  ],
});

/**
 * Spends a live refresh token and returns it -- one statement, so of two
 * requests racing with the same token exactly one gets a row.
 */
export const consume = (token: string, at: string): Promise<OAuthRefreshToken | undefined> =>
  one<OAuthRefreshToken>(
    `UPDATE oauth_refresh_tokens SET used_at = ?
      WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
      RETURNING *`,
    [at, hashToken(token), at],
  );

/** The row behind a token whatever its state, to tell a replay from a typo. */
export const find = (token: string): Promise<OAuthRefreshToken | undefined> =>
  one<OAuthRefreshToken>("SELECT * FROM oauth_refresh_tokens WHERE token_hash = ?", [
    hashToken(token),
  ]);

export const revokeFamilyStmt = (familyId: string, at: string): Statement => ({
  text: `UPDATE oauth_refresh_tokens SET revoked_at = ?
          WHERE family_id = ? AND revoked_at IS NULL`,
  params: [at, familyId],
});

export const revokeAllForUserStmt = (userId: number, at: string): Statement => ({
  text: `UPDATE oauth_refresh_tokens SET revoked_at = ?
          WHERE user_id = ? AND revoked_at IS NULL`,
  params: [at, userId],
});

/** Spent, revoked or expired rows past their usefulness as replay evidence. */
export const pruneOlderThan = (cutoff: string): Promise<number> =>
  run(
    `DELETE FROM oauth_refresh_tokens
      WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)`,
    [cutoff, cutoff],
  );
