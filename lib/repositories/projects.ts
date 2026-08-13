import { all, one, run, setClause } from "../db/client";
import type { Project } from "../types";
import { SLUG_FALLBACK, shareToken, slugifyOr } from "../util/paths";
import { now } from "../util/time";

export type NewProject = {
  name: string;
  slug?: string;
  root_path?: string | null;
  repo_url?: string | null;
  summary?: string | null;
};

export type ProjectPatch = Partial<
  Pick<Project, "name" | "root_path" | "repo_url" | "summary" | "archived">
>;

/**
 * The only columns `update` will write. `user_id` is absent on purpose: it is
 * a real column, so without this list `{"project":"x","user_id":2}` would be a
 * legal patch that hands the project -- and its tasks, by cascade -- to
 * another account. `share_token` and `share_log` go through `setShare`.
 */
const COLUMNS = ["name", "root_path", "repo_url", "summary", "archived"] as const;

/**
 * `owner_name` joins on a primary key and rides along with every private read.
 *
 * It is what lets a page say whose project this is without a second query --
 * the dashboard card and the project header both need it, and this select is
 * already the single door every private read goes through.
 */
const ACCESS_SELECT = `SELECT p.*,
  CASE WHEN p.user_id = ? THEN p.slug ELSE pm.access_slug END AS slug,
  CASE WHEN p.user_id = ? THEN p.root_path ELSE pm.root_path END AS root_path,
  CASE WHEN p.user_id = ? THEN 'owner' ELSE 'member' END AS access_role,
  owner.name AS owner_name
 FROM projects p

 LEFT JOIN users owner ON owner.id = p.user_id
 LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
 WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)`;

export const list = (userId: number, includeArchived = false) =>
  all<Project>(
    `${ACCESS_SELECT} ${includeArchived ? "" : "AND p.archived = 0"} ORDER BY p.name`,
    [userId, userId, userId, userId, userId],
  );

export const bySlug = (userId: number, slug: string) =>
  one<Project>(`${ACCESS_SELECT} AND (p.user_id = ? AND p.slug = ? OR pm.access_slug = ?)`, [
    userId,
    userId,
    userId,
    userId,
    userId,
    userId,
    slug,
    slug,
  ]);

export const byName = (userId: number, name: string) =>
  one<Project>(`${ACCESS_SELECT} AND lower(p.name) = lower(?)`, [
    userId,
    userId,
    userId,
    userId,
    userId,
    name,
  ]);

export const byId = (userId: number, id: number) =>
  one<Project>(`${ACCESS_SELECT} AND p.id = ?`, [
    userId,
    userId,
    userId,
    userId,
    userId,
    id,
  ]);

export const ownedById = (userId: number, id: number) =>
  one<Project>("SELECT *, 'owner' AS access_role FROM projects WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);

/**
 * Projects this user has a filesystem path for.
 *
 * The condition has to be the same expression `ACCESS_SELECT` projects, not a
 * `COALESCE` over both columns. A member's `root_path` is their own checkout on
 * their own machine, so the owner's path is not a stand-in for it -- and the
 * two disagreed exactly when `pm.root_path` was null while `p.root_path` was
 * set: the coalesce let the row through, the projection returned null, and the
 * caller sorted on `.length` of it. One shared project without a member path
 * took out `get_context` for that account entirely, which is every call the
 * product exists to serve.
 */
export const withRootPath = (userId: number) =>
  all<Project>(
    `${ACCESS_SELECT} AND (CASE WHEN p.user_id = ? THEN p.root_path ELSE pm.root_path END) IS NOT NULL`,
    [userId, userId, userId, userId, userId, userId],
  );

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
    `INSERT INTO projects (user_id, slug, name, root_path, repo_url, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      userId,
      input.slug ?? slugifyOr(input.name),
      input.name,
      input.root_path ?? null,
      input.repo_url ?? null,
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
        `SELECT slug FROM projects WHERE user_id = ? AND slug LIKE ?
         UNION SELECT access_slug AS slug FROM project_memberships
          WHERE user_id = ? AND access_slug LIKE ?`,
        [userId, `${root}%`, userId, `${root}%`],
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
