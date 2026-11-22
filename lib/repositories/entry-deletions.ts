import { all, type Statement } from "../db/client";
import { now } from "../util/time";

/**
 * Where a deleted entry stood: its kind, who wrote it, who removed it.
 * Never its text -- see the table's comment in `db/schema.ts`.
 */
export type EntryDeletion = {
  id: number;
  task_id: number;
  kind: string;
  created_at: string;
  deleted_at: string;
  author_name: string | null;
  deleted_by_name: string | null;
};

export const createStmt = (input: {
  task_id: number;
  kind: string;
  author_id: number | null;
  deleted_by: number;
  created_at: string;
}): Statement => ({
  text: `INSERT INTO entry_deletions (task_id, kind, author_id, deleted_by, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
  params: [input.task_id, input.kind, input.author_id, input.deleted_by, input.created_at, now()],
});

export const listByTask = (taskId: number) =>
  all<EntryDeletion>(
    `SELECT d.id, d.task_id, d.kind, d.created_at, d.deleted_at,
            author.name AS author_name, remover.name AS deleted_by_name
       FROM entry_deletions d
       LEFT JOIN users author  ON author.id  = d.author_id
       LEFT JOIN users remover ON remover.id = d.deleted_by
      WHERE d.task_id = ?
      ORDER BY d.deleted_at`,
    [taskId],
  );
