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
  parent_project_id?: number | null;
};

export type ProjectPatch = Partial<
  Pick<Project, "name" | "root_path" | "repo_url" | "summary" | "archived" | "parent_project_id">
>;

/**
 * The only columns `update` will write. `user_id` is absent on purpose: it is
 * a real column, so without this list `{"project":"x","user_id":2}` would be a
 * legal patch that hands the project -- and its tasks, by cascade -- to
 * another account. `share_token` and `share_log` go through `setShare`.
 *
 * `parent_project_id` is here because promoting a project to a sub-project (or
 * moving it back) is a meaningful edit, but only with the safeguards in
 * `services/ownership.ts` -- a child can never be re-parented under a project
 * it does not own.
 */
const COLUMNS = [
  "name",
  "root_path",
  "repo_url",
  "summary",
  "archived",
  "parent_project_id",
] as const;

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

/**
 * Single-slug lookup with two reads. A path-shaped input (e.g. `todox/api`)
 * walks through `byPath` instead, so callers can hand either shape straight
 * through from a form or an MCP argument. Membership access_slugs still resolve
 * to the right project -- only the path form is new.
 */
export const bySlug = (userId: number, slug: string) => {
  if (slug.includes("/")) {
    const segments = slug.split("/").filter(Boolean);
    return byPath(userId, segments);
  }
  return one<Project>(
    `${ACCESS_SELECT} AND (p.user_id = ? AND p.slug = ? OR pm.access_slug = ?)`,
    [userId, userId, userId, userId, userId, userId, slug, slug],
  );
};

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

export const withRootPath = (userId: number) =>
  all<Project>(`${ACCESS_SELECT} AND COALESCE(pm.root_path, p.root_path) IS NOT NULL`, [
    userId,
    userId,
    userId,
    userId,
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
    `INSERT INTO projects (user_id, slug, name, root_path, repo_url, summary, parent_project_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      userId,
      input.slug ?? slugifyOr(input.name),
      input.name,
      input.root_path ?? null,
      input.repo_url ?? null,
      input.summary ?? null,
      input.parent_project_id ?? null,
      now(),
    ],
  );
  return row!;
}

export async function update(userId: number, id: number, patch: ProjectPatch) {
  const stmt = updateStmt(userId, id, patch);
  if (!stmt) return;
  await run(stmt.text, stmt.params);
}

/**
 * The `UPDATE` on its own, for a caller that has to run it inside a
 * transaction (e.g. alongside a reparent). Same `setClause` guard as `update`
 * so a patch with no real changes still skips the write.
 */
export function updateStmt(
  userId: number,
  id: number,
  patch: ProjectPatch,
): import("../db/client").Statement | undefined {
  const set = setClause(patch, COLUMNS);
  if (!set.sql) return undefined;
  return {
    text: `UPDATE projects SET ${set.sql} WHERE id = ? AND user_id = ?`,
    params: [...set.values, id, userId],
  };
}

export const remove = (userId: number, id: number) =>
  run("DELETE FROM projects WHERE id = ? AND user_id = ?", [id, userId]);

/**
 * Counts what `ON DELETE CASCADE` will sweep away before a delete is confirmed.
 *
 * The schema cascades from `projects` into sub-projects, tasks, entries,
 * contexts, refs and event rows, so a delete at the top can quietly take
 * tasks the user never saw listed. The recursion stops at the project being
 * deleted; counting its own tasks here would have made the confirmation
 * message read "n" for a leaf delete and "1 + n" for a parent, which is
 * what the prompt is asking the user to weigh -- without it, the number was
 * only ever the leaf's tasks and a parent delete went ahead silently.
 */
export const cascadeImpact = (userId: number, id: number) =>
  one<{ descendant_projects: string; descendant_tasks: string }>(
    `WITH RECURSIVE subtree AS (
       SELECT id, parent_project_id FROM projects
        WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT p.id, p.parent_project_id FROM projects p
         JOIN subtree s ON p.parent_project_id = s.id
        WHERE p.user_id = ?
     ), self AS (
       SELECT id FROM projects WHERE id = ? AND user_id = ?
     )
     SELECT
       (SELECT COUNT(*) FROM subtree) - 1                              AS descendant_projects,
       (SELECT COUNT(*) FROM tasks WHERE project_id IN
          (SELECT id FROM subtree)) - (SELECT COUNT(*) FROM tasks WHERE project_id IN (SELECT id FROM self)) AS descendant_tasks`,
    [id, userId, userId, id, userId],
  );

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

/**
 * Direct children of a parent project, owned by the same account.
 *
 * Used by the /p/[slug] flow panel and the briefing. Memberships are not
 * included: a sub-project is a sibling workspace the same person switched
 * into, not a collaborator's project.
 */
export const listChildren = (userId: number, parentId: number) =>
  all<Project>(
    `SELECT * FROM projects
      WHERE parent_project_id = ? AND user_id = ?
      ORDER BY archived, name`,
    [parentId, userId],
  );

/**
 * Walks up the parent chain. The first row whose `parent_project_id` is null
 * is the root of the tree this project belongs to.
 */
export const parentOf = (userId: number, childId: number) =>
  one<Project>(
    `WITH RECURSIVE chain AS (
       SELECT * FROM projects WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT p.* FROM projects p
         JOIN chain c ON p.id = c.parent_project_id
         WHERE p.user_id = ?
     )
     SELECT * FROM chain WHERE parent_project_id IS NULL
     LIMIT 1`,
    [childId, userId, userId],
  );

/**
 * Resolves a URL path to a leaf.
 *
 * `path` is the array of segments from `/p/[...path]`. The first segment may
 * match a project at any level: with slugs globally unique per account, a
 * request like `/p/api` could be a top-level project named `api` or a
 * sub-project `todox/api`; both can never coexist for the same account, so the
 * slug alone identifies the row. Subsequent segments walk down through
 * `parent_project_id`.
 *
 * The first segment is special: a member accesses somebody else's project by
 * their membership's `access_slug`, which can collide with the owner's slug
 * for a different project entirely (two collaborators each give a project the
 * slug they prefer, and one of those happens to be the slug of a project the
 * viewer owns). The CASE in `ACCESS_SELECT` already swaps which column to
 * expose as `slug`, but the `WHERE` here has to match on either, so a member
 * does not silently land on the wrong project. Subsequent segments always
 * match on the canonical owner slug, because `parent_project_id` points to a
 * row in the owner's own column regardless of which access path got us here.
 */
export async function byPath(userId: number, path: string[]): Promise<Project | undefined> {
  if (path.length === 0) return undefined;

  const first = await one<Project>(
    `${ACCESS_SELECT} AND (p.slug = ? OR pm.access_slug = ?)`,
    [userId, userId, userId, userId, userId, path[0], path[0]],
  );
  if (!first) return undefined;

  let current = first;
  for (let i = 1; i < path.length; i++) {
    const next = await one<Project>(
      `${ACCESS_SELECT} AND p.parent_project_id = ? AND p.slug = ?`,
      [userId, userId, userId, userId, userId, current.id, path[i]],
    );
    if (!next) return undefined;
    current = next;
  }
  return current;
}

/**
 * The slug chain from the root of the tree to the given project.
 *
 * Used to build `/p/...` URLs without storing the path on every row: the
 * chain is derived on demand and joined where it is needed.
 */
export const chainPath = (userId: number, projectId: number) =>
  one<{ path: string[] }>(
    `WITH RECURSIVE chain AS (
       SELECT id, slug, parent_project_id, ARRAY[slug]::text[] AS path
         FROM projects
        WHERE user_id = ? AND parent_project_id IS NULL
       UNION ALL
       SELECT p.id, p.slug, p.parent_project_id, c.path || p.slug
         FROM projects p JOIN chain c ON p.parent_project_id = c.id
        WHERE p.user_id = ?
     )
     SELECT path FROM chain WHERE id = ?`,
    [userId, userId, projectId],
  );

/**
 * Batch lookup: slug chain for every id in the list, in one query.
 *
 * Pages that render a list of project cards or a flow panel want every
 * card's URL — looping `chainPath` per id is one query per row, which is the
 * shape this codebase is most allergic to.
 */
export async function pathsByIds(userId: number, ids: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => "?").join(",");
  const rows = await all<{ id: number; path: string[] }>(
    `WITH RECURSIVE chain AS (
       SELECT id, slug, parent_project_id, ARRAY[slug]::text[] AS path
         FROM projects
        WHERE user_id = ? AND parent_project_id IS NULL
       UNION ALL
       SELECT p.id, p.slug, p.parent_project_id, c.path || p.slug
         FROM projects p JOIN chain c ON p.parent_project_id = c.id
        WHERE p.user_id = ?
     )
     SELECT id, path FROM chain WHERE id IN (${placeholders})`,
    [userId, userId, ...ids],
  );
  for (const r of rows) map.set(r.id, r.path);
  return map;
}

/**
 * One row of `/p/<chain>` joined with its membership info. The home page and
 * the account page need this together — the project for the link, the chain
 * for the URL, and the membership status for the "shared by" chip — and a single
 * recursive CTE is the only query that carries them all in one round trip.
 */
export type ProjectWithPath = Project & { url_path: string[] };

export const listWithPaths = async (userId: number): Promise<ProjectWithPath[]> => {
  const rows = await all<Project & { url_path: string[] }>(
    `WITH RECURSIVE chain AS (
       SELECT id, slug, parent_project_id, ARRAY[slug]::text[] AS path
         FROM projects
        WHERE parent_project_id IS NULL
       UNION ALL
       SELECT p.id, p.slug, p.parent_project_id, c.path || p.slug
         FROM projects p JOIN chain c ON p.parent_project_id = c.id
     )
     SELECT p.*,
       c.path AS url_path,
       CASE WHEN p.user_id = ? THEN p.slug ELSE pm.access_slug END AS slug,
       CASE WHEN p.user_id = ? THEN p.root_path ELSE pm.root_path END AS root_path,
       CASE WHEN p.user_id = ? THEN 'owner' ELSE 'member' END AS access_role
       FROM projects p
       JOIN chain c ON c.id = p.id
       LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
       WHERE p.user_id = ? OR pm.user_id IS NOT NULL
       ORDER BY p.archived, p.name`,
    [userId, userId, userId, userId, userId],
  );
  return rows as ProjectWithPath[];
};

/**
 * The cycle-checked re-parent statement. Walks up from the proposed parent,
 * refuses the write if `childId` is anywhere in that chain, and runs in one
 * statement so concurrent re-parents cannot both succeed against the same
 * pair. Doing the check separately opens a window where A→B and B→A both
 * pass `assertNotAncestor` and end up forming a cycle.
 */
const SET_PARENT_TEXT = `WITH RECURSIVE chain AS (
   SELECT id, parent_project_id FROM projects WHERE id = ?
 ), offending AS (
   SELECT 1 FROM chain c
    WHERE c.id = ?
    UNION ALL
    SELECT 1 FROM chain c
      JOIN projects p ON p.id = c.parent_project_id
   WHERE p.id = ?
 ),
 ok AS (
   SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM offending)
     AND (? IS NULL OR ? <> ?)
 )
 UPDATE projects SET parent_project_id = ?
  WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM ok)`;

function setParentParams(
  userId: number,
  childId: number,
  parentId: number | null,
): unknown[] {
  return [
    parentId,
    childId,
    childId,
    childId,
    parentId,
    childId,
    parentId,
    parentId,
    childId,
    userId,
  ];
}

/** Re-parents a project. `parentId` of `null` promotes it back to the top level. */
export const setParent = (
  userId: number,
  childId: number,
  parentId: number | null,
) => run(SET_PARENT_TEXT, setParentParams(userId, childId, parentId));

/**
 * The same write as a statement so a service can pair it with another table's
 * write inside a single transaction (the `updateProject` RPC accepts reparent
 * and other fields together and must apply them atomically).
 */
export const setParentStmt = (input: {
  userId: number;
  childId: number;
  parentId: number | null;
}): import("../db/client").Statement => ({
  text: SET_PARENT_TEXT,
  params: setParentParams(input.userId, input.childId, input.parentId),
});
