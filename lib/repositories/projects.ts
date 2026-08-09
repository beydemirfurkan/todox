import { all, one, run } from "../db/client";
import type { Project } from "../types";
import { shareToken, slugify } from "../util/paths";
import { now } from "../util/time";

export type NewProject = {
  name: string;
  slug?: string;
  root_path?: string | null;
  summary?: string | null;
};

export type ProjectPatch = Partial<
  Pick<Project, "name" | "root_path" | "summary" | "archived">
>;

/**
 * Every read here is scoped by owner. The only deliberate exception is
 * `byShareToken`, which is what a public share link resolves through.
 */

export const list = (userId: number, includeArchived = false) =>
  all<Project>(
    `SELECT * FROM projects WHERE user_id = ?
     ${includeArchived ? "" : "AND archived = 0"} ORDER BY name`,
    [userId],
  );

export const bySlug = (userId: number, slug: string) =>
  one<Project>("SELECT * FROM projects WHERE user_id = ? AND slug = ?", [userId, slug]);

export const byName = (userId: number, name: string) =>
  one<Project>("SELECT * FROM projects WHERE user_id = ? AND lower(name) = lower(?)", [
    userId,
    name,
  ]);

export const byId = (userId: number, id: number) =>
  one<Project>("SELECT * FROM projects WHERE id = ? AND user_id = ?", [id, userId]);

export const withRootPath = (userId: number) =>
  all<Project>("SELECT * FROM projects WHERE user_id = ? AND root_path IS NOT NULL", [
    userId,
  ]);

/** Public by design: this is the share-link lookup. */
export const byShareToken = (token: string) =>
  one<Project>("SELECT * FROM projects WHERE share_token = ?", [token]);

export async function create(userId: number, input: NewProject): Promise<Project> {
  const row = await one<Project>(
    `INSERT INTO projects (user_id, slug, name, root_path, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      userId,
      slugify(input.slug ?? input.name),
      input.name,
      input.root_path ?? null,
      input.summary ?? null,
      now(),
    ],
  );
  return row!;
}

export async function update(userId: number, id: number, patch: ProjectPatch) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!fields.length) return;
  await run(
    `UPDATE projects SET ${fields.map(([k]) => `${k} = ?`).join(", ")}
     WHERE id = ? AND user_id = ?`,
    [...fields.map(([, v]) => v), id, userId],
  );
}

export const remove = (userId: number, id: number) =>
  run("DELETE FROM projects WHERE id = ? AND user_id = ?", [id, userId]);

/** Slugs only have to be unique within one account. */
export async function nextFreeSlug(userId: number, base: string) {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; await bySlug(userId, slug); i++) slug = `${root}-${i}`;
  return slug;
}

export const setShare = (
  userId: number,
  id: number,
  token: string | null,
  includeLog: boolean,
) =>
  run("UPDATE projects SET share_token = ?, share_log = ? WHERE id = ? AND user_id = ?", [
    token,
    includeLog ? 1 : 0,
    id,
    userId,
  ]);

export const freshShareToken = () => shareToken();
