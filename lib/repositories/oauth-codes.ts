import { one, run } from "../db/client";
import { hashToken } from "../util/tokens";

/** An authorisation code as stored: everything the token request must match. */
export interface OAuthCode {
  code_hash: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface NewOAuthCode {
  code: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  created_at: string;
  expires_at: string;
}

export const create = (input: NewOAuthCode): Promise<number> =>
  run(
    `INSERT INTO oauth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge, resource, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hashToken(input.code),
      input.client_id,
      input.user_id,
      input.redirect_uri,
      input.code_challenge,
      input.resource,
      input.created_at,
      input.expires_at,
    ],
  );

/**
 * Burns a code and returns it, in one statement.
 *
 * Only the first caller gets a row back: two token requests racing with the
 * same code cannot both win, which a read followed by a write would allow.
 * The code is spent even when the request then fails its PKCE check -- a code
 * is single use whatever happens to it.
 */
export const consume = (code: string, at: string): Promise<OAuthCode | undefined> =>
  one<OAuthCode>(
    `UPDATE oauth_codes SET used_at = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
      RETURNING *`,
    [at, hashToken(code), at],
  );

/** Codes live a minute. Anything older than a day is only taking up space. */
export const pruneOlderThan = (cutoff: string): Promise<number> =>
  run("DELETE FROM oauth_codes WHERE expires_at < ?", [cutoff]);
