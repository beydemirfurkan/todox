import { all, one, run } from "../db/client";
import type { ProjectFolder } from "../types";
import { now } from "../util/time";

/** Longer than this is a sentence, not a folder name. */
export const FOLDER_NAME_MAX = 60;

export const listByUser = (userId: number) =>
  all<ProjectFolder>(
    "SELECT * FROM project_folders WHERE user_id = ? ORDER BY position, lower(name), id",
    [userId],
  );

export const byId = (id: number) => one<ProjectFolder>("SELECT * FROM project_folders WHERE id = ?", [id]);

/**
 * The folder with this name, made if it does not exist yet.
 *
 * Names are unique per person regardless of case, so "work" typed into the
 * move form lands in an existing "Work" rather than failing. One statement:
 * the insert yields nothing on a conflict, and the second arm then finds the
 * row that was already there.
 */
export async function findOrCreate(userId: number, name: string): Promise<ProjectFolder> {
  const row = await one<ProjectFolder>(
    `WITH made AS (
       INSERT INTO project_folders (user_id, name, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, lower(name)) DO NOTHING
       RETURNING *
     )
     SELECT * FROM made
     UNION ALL
     SELECT * FROM project_folders WHERE user_id = ? AND lower(name) = lower(?)
     LIMIT 1`,
    [userId, name, now(), userId, name],
  );
  return row!;
}

export const rename = (id: number, name: string) =>
  run("UPDATE project_folders SET name = ? WHERE id = ?", [name, id]);

/** Its projects stay where they were listed, outside any folder; see the schema. */
export const remove = (id: number) => run("DELETE FROM project_folders WHERE id = ?", [id]);
