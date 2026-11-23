import { all, one, run } from "../db/client";
import type { ProjectFolder } from "../types";
import { now } from "../util/time";

/** Longer than this is a sentence, not a folder name. */
export const FOLDER_NAME_MAX = 60;

/** In the order this person put them; a new folder goes to the end. */
export const listByUser = (userId: number) =>
  all<ProjectFolder>("SELECT * FROM project_folders WHERE user_id = ? ORDER BY position, id", [userId]);

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
       INSERT INTO project_folders (user_id, name, created_at, position)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM project_folders WHERE user_id = ?))
       ON CONFLICT (user_id, lower(name)) DO NOTHING
       RETURNING *
     )
     SELECT * FROM made
     UNION ALL
     SELECT * FROM project_folders WHERE user_id = ? AND lower(name) = lower(?)
     LIMIT 1`,
    [userId, name, now(), userId, userId, name],
  );
  return row!;
}

export const rename = (id: number, name: string) =>
  run("UPDATE project_folders SET name = ? WHERE id = ?", [name, id]);

/**
 * Writes the whole order at once: each id gets its index. One statement, so a
 * reorder cannot land half-applied with two folders sharing a place. Whose
 * folders these are is asked before this, in the service.
 */
export const reorder = (orderedIds: readonly number[]) =>
  run(
    `UPDATE project_folders f SET position = o.pos::int - 1
       FROM unnest(?::int[]) WITH ORDINALITY AS o(id, pos)
      WHERE f.id = o.id`,
    [orderedIds],
  );

/** Its projects stay where they were listed, outside any folder; see the schema. */
export const remove = (id: number) => run("DELETE FROM project_folders WHERE id = ?", [id]);
