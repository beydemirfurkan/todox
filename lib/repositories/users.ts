import { all, one, run } from "../db/client";
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

export const markEmailVerified = (id: number) =>
  run("UPDATE users SET email_verified_at = ? WHERE id = ?", [now(), id]);

/** Changing the address un-verifies it; the new one has proved nothing yet. */
export const updateEmail = (id: number, email: string) =>
  run("UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?", [email, id]);

export const updatePassword = (id: number, passwordHash: string) =>
  run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, id]);

export async function updateProfile(id: number, patch: { name?: string; email?: string }) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!fields.length) return;
  await run(
    `UPDATE users SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...fields.map(([, v]) => v), id],
  );
}

export const remove = (id: number) => run("DELETE FROM users WHERE id = ?", [id]);

export const list = () => all<User>("SELECT * FROM users ORDER BY id");
