import { all, run, type Statement } from "../db/client";
import { now } from "../util/time";

/**
 * Where a project sits, on each machine its owner works from.
 *
 * `projects.root_path` holds the first path ever seen and stays the one every
 * read projects. This table holds the rest: a repo cloned to `C:/Users/me/app`
 * on a laptop and `/Users/me/app` on a desktop is one project with two paths,
 * not two projects -- which is what it used to become, quietly, halving the log
 * the product exists to keep whole.
 */

export type ProjectPath = {
  id: number;
  project_id: number;
  user_id: number;
  path: string;
  created_at: string;
};

/** Every extra path this account has registered, for the resolver's one pass. */
export const listAll = (userId: number) =>
  all<ProjectPath>(
    "SELECT * FROM project_paths WHERE user_id = ? ORDER BY id",
    [userId],
  );

export const listFor = (userId: number, projectId: number) =>
  all<ProjectPath>(
    "SELECT * FROM project_paths WHERE user_id = ? AND project_id = ? ORDER BY id",
    [userId, projectId],
  );

/**
 * Claim a path for a project.
 *
 * `ON CONFLICT` rather than an existence check: a path already registered to
 * another project is being re-pointed on purpose -- that is what a merge does
 * -- and the unique index is the only thing that can decide the race between
 * two agents registering the same directory at once.
 */
export function addStmt(userId: number, projectId: number, path: string): Statement {
  return {
    text: `INSERT INTO project_paths (project_id, user_id, path, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, path) DO UPDATE SET project_id = EXCLUDED.project_id`,
    params: [projectId, userId, path, now()],
  };
}

export async function add(userId: number, projectId: number, path: string) {
  const stmt = addStmt(userId, projectId, path);
  await run(stmt.text, stmt.params);
}

/**
 * Hand one project's paths to another.
 *
 * No conflict clause is needed and none would fire: `UNIQUE (user_id, path)`
 * is account-wide, so one person's two projects cannot already share a path.
 */
export const reassignStmt = (userId: number, fromId: number, intoId: number): Statement => ({
  text: `UPDATE project_paths SET project_id = ?
          WHERE user_id = ? AND project_id = ?`,
  params: [intoId, userId, fromId],
});
