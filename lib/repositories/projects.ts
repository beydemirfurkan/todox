import { all, one, run, setClause } from "../db/client";
import type { Project } from "../types";
import { SLUG_FALLBACK, shareToken, slugifyOr } from "../util/paths";
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
 * The only columns `update` will write. `user_id` is absent on purpose: it is
 * a real column, so without this list `{"project":"x","user_id":2}` would be a
 * legal patch that hands the project -- and its tasks, by cascade -- to
 * another account. `share_token` and `share_log` go through `setShare`.
 */
const COLUMNS = ["name", "root_path", "summary", "archived"] as const;

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

/**
 * An explicit `slug` is taken as given.
 *
 * It used to be re-slugified here, which quietly undid `nextFreeSlug`: that
 * returns `<48 chars>-2` after a collision, and running it back through a
 * function ending in `.slice(0, 48)` chopped the suffix straight off, so the
 * insert collided again and the agent got a raw Postgres unique-violation.
 */
export async function create(userId: number, input: NewProject): Promise<Project> {
  const row = await one<Project>(
    `INSERT INTO projects (user_id, slug, name, root_path, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      userId,
      input.slug ?? slugifyOr(input.name),
      input.name,
      input.root_path ?? null,
      input.summary ?? null,
      now(),
    ],
  );
  return row!;
}

export async function update(userId: number, id: number, patch: ProjectPatch) {
  const set = setClause(patch, COLUMNS);
  if (!set.sql) return;
  await run(`UPDATE projects SET ${set.sql} WHERE id = ? AND user_id = ?`, [
    ...set.values,
    id,
    userId,
  ]);
}

export const remove = (userId: number, id: number) =>
  run("DELETE FROM projects WHERE id = ? AND user_id = ?", [id, userId]);

/**
 * Slugs only have to be unique within one account.
 *
 * The root is trimmed so that appending `-12` cannot push the result past the
 * column's working length, and the caller can insert what comes back without
 * it being rewritten underneath them.
 */
export async function nextFreeSlug(userId: number, base: string) {
  const root = slugifyOr(base).slice(0, 44).replace(/-+$/, "") || SLUG_FALLBACK;

  // One query instead of one per collision: the whole neighbourhood at once.
  const taken = new Set(
    (
      await all<{ slug: string }>(
        "SELECT slug FROM projects WHERE user_id = ? AND slug LIKE ?",
        [userId, `${root}%`],
      )
    ).map((r) => r.slug),
  );

  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
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
