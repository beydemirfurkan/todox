import { all, one, run, type Statement } from "../db/client";
import type { User } from "../types";
import { now } from "../util/time";

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OAuthAccount {
  id: number;
  user_id: number;
  provider: OAuthProvider;
  provider_user_id: string;
  email: string | null;
  created_at: string;
}

/** Who an outside identity signs in as, if anybody. */
export const byIdentity = (provider: OAuthProvider, providerUserId: string) =>
  one<OAuthAccount>(
    "SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?",
    [provider, providerUserId],
  );

export const listForUser = (userId: number) =>
  all<OAuthAccount>("SELECT * FROM oauth_accounts WHERE user_id = ? ORDER BY provider", [userId]);

export const createStmt = (input: {
  userId: number;
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
}): Statement => ({
  text: `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, created_at)
         VALUES (?, ?, ?, ?, ?)`,
  params: [input.userId, input.provider, input.providerUserId, input.email, now()],
});

/**
 * Unlink, unless it is the account's last way in: no password and no other
 * provider. The check is in the statement so two unlinks racing each other
 * cannot both pass it.
 */
export const removeUnlessLast = (userId: number, provider: OAuthProvider) =>
  run(
    `DELETE FROM oauth_accounts o
      WHERE o.user_id = ? AND o.provider = ?
        AND (
          EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.password_hash IS NOT NULL)
          OR EXISTS (SELECT 1 FROM oauth_accounts x WHERE x.user_id = o.user_id AND x.provider <> o.provider)
        )`,
    [userId, provider],
  );

/**
 * A new account and the identity that made it, in one statement.
 *
 * A CTE for the same reason as `tasks.create` and
 * `project-invitations.acceptWithNewUser`: the identity row needs the id of the
 * account inserted just before it, and `tx()` has no JavaScript between its
 * statements to carry that id across. Two statements would also leave, on a
 * failure between them, an account nobody can sign in to.
 *
 * Answers nothing when the username or address is taken by then (the unique
 * indexes refuse the insert), and the caller tries another username.
 */
export const createUserWithIdentity = (input: {
  username: string;
  email: string;
  name: string;
  isEmailVerified: boolean;
  provider: OAuthProvider;
  providerUserId: string;
}) => {
  const at = now();
  return one<User>(
    `WITH created_user AS (
       INSERT INTO users (username, email, name, password_hash, created_at, email_verified_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT DO NOTHING
       RETURNING *
     ), identity AS (
       INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, created_at)
       SELECT id, ?, ?, email, ? FROM created_user
     )
     SELECT * FROM created_user`,
    [
      input.username,
      input.email,
      input.name,
      at,
      input.isEmailVerified ? at : null,
      input.provider,
      input.providerUserId,
      at,
    ],
  );
};
