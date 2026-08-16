import { all, one, run, runStmt, setClause, type Statement } from "../db/client";
import type { User } from "../types";
import { now } from "../util/time";

export type NewUser = {
  username: string;
  email: string;
  name: string;
  password_hash: string;
};

export const byId = (id: number) =>
  one<User>("SELECT * FROM users WHERE id = ?", [id]);

export const byUsername = (username: string) =>
  one<User>("SELECT * FROM users WHERE lower(username) = lower(?)", [username]);

export const byEmail = (email: string) =>
  one<User>("SELECT * FROM users WHERE lower(email) = lower(?)", [email]);

/** Login accepts either identifier; people rarely remember which they used. */
export const byLogin = (identifier: string) =>
  identifier.includes("@") ? byEmail(identifier) : byUsername(identifier);

export async function count(): Promise<number> {
  const row = await one<{ n: string }>("SELECT COUNT(*) AS n FROM users");
  return Number(row?.n ?? 0);
}

export async function create(input: NewUser): Promise<User> {
  const row = await one<User>(
    `INSERT INTO users (username, email, name, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?) RETURNING *`,
    [input.username, input.email, input.name, input.password_hash, now()],
  );
  return row!;
}

export const markEmailVerifiedStmt = (id: number): Statement => ({
  text: "UPDATE users SET email_verified_at = ? WHERE id = ?",
  params: [now(), id],
});

export const markEmailVerified = (id: number) => runStmt(markEmailVerifiedStmt(id));

/** Changing the address un-verifies it; the new one has proved nothing yet. */
export const updateEmail = (id: number, email: string) =>
  run("UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?", [email, id]);

export const updatePasswordStmt = (id: number, passwordHash: string): Statement => ({
  text: "UPDATE users SET password_hash = ? WHERE id = ?",
  params: [passwordHash, id],
});

/**
 * Set the password only when this transaction is the one that burned the link.
 *
 * The recovery path cannot use the plain statement above. Its transaction is a
 * fixed list with no JavaScript between the statements, so it cannot look at
 * whether the consume before it matched a row and stop; every statement has to
 * carry the condition itself. Two requests racing the same reset link both
 * reached this write, and the loser overwrote the winner's password -- which
 * matters least when they are the same person clicking twice and most when
 * they are not.
 *
 * The claim is identified by the timestamp the consume wrote, which is how
 * `project-memberships.createForAcceptedInvitationStmt` recognises its own
 * invitation. Ordering is part of the contract: the consume runs first, or
 * this sees nothing to match.
 */
export const updatePasswordForConsumedTokenStmt = (input: {
  userId: number;
  passwordHash: string;
  tokenId: number;
  consumedAt: string;
}): Statement => ({
  text: `UPDATE users SET password_hash = ?
          WHERE id = ?
            AND EXISTS (SELECT 1 FROM auth_tokens
                         WHERE id = ? AND user_id = users.id AND used_at = ?)
         RETURNING *`,
  params: [input.passwordHash, input.userId, input.tokenId, input.consumedAt],
});

export const updatePassword = (id: number, passwordHash: string) =>
  runStmt(updatePasswordStmt(id, passwordHash));

/** Never `password_hash` or `email_verified_at`: those have their own writers. */
const PROFILE_COLUMNS = ["name", "email"] as const;

export async function updateProfile(id: number, patch: { name?: string; email?: string }) {
  const set = setClause(patch, PROFILE_COLUMNS);
  if (!set.sql) return;
  await run(`UPDATE users SET ${set.sql} WHERE id = ?`, [...set.values, id]);
}

export const remove = (id: number) => run("DELETE FROM users WHERE id = ?", [id]);

export const list = () => all<User>("SELECT * FROM users ORDER BY id");
