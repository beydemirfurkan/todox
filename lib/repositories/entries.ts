import type { EntryKind } from "../constants";
import { all, groupBy, one, run } from "../db/client";
import type { Entry } from "../types";
import { now } from "../util/time";

export type NewEntry = {
  task_id: number;
  kind: EntryKind;
  body: string;
  author?: string;
  model?: string | null;
};

export const listByTask = (taskId: number) =>
  all<Entry>("SELECT * FROM entries WHERE task_id = ? ORDER BY id", [taskId]);

/**
 * Batch load for a set of tasks. Over HTTP a per-task query is a per-task round
 * trip, so anything rendering a list uses this instead.
 */
export async function listByTasks(taskIds: number[]): Promise<Map<number, Entry[]>> {
  if (!taskIds.length) return new Map();
  const rows = await all<Entry>(
    `SELECT * FROM entries WHERE task_id IN (${taskIds.map(() => "?").join(",")})
     ORDER BY task_id, id`,
    taskIds,
  );
  return groupBy(rows, (r) => r.task_id);
}

/**
 * The window's entries, narrowed to the tasks a report is already about.
 *
 * This replaced a `WHERE created_at BETWEEN ? AND ?` with no owner in it. The
 * report scoped the rows afterwards, in JavaScript, which was correct but meant
 * one account's monthly report pulled every account's log across the network
 * first -- and `period: "all"` made that window the whole table.
 */
export async function listByTasksBetween(
  taskIds: number[],
  from: string,
  to: string,
): Promise<Entry[]> {
  if (!taskIds.length) return [];
  return all<Entry>(
    `SELECT * FROM entries
     WHERE task_id IN (${taskIds.map(() => "?").join(",")})
       AND created_at BETWEEN ? AND ?
     ORDER BY id`,
    [...taskIds, from, to],
  );
}

export type EntryCounts = { total: number; dead_ends: number; questions: number };

/**
 * Just the numbers a list needs, counted in the database.
 *
 * The project page used to load every entry of every task to render three
 * badges per row -- the whole log of the whole project, in memory, to print
 * some integers.
 */
export async function countsByTasks(taskIds: number[]): Promise<Map<number, EntryCounts>> {
  if (!taskIds.length) return new Map();
  const rows = await all<{
    task_id: number;
    total: string;
    dead_ends: string;
    questions: string;
  }>(
    `SELECT task_id,
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE kind = 'dead_end')   AS dead_ends,
       COUNT(*) FILTER (WHERE kind = 'question')   AS questions
     FROM entries WHERE task_id IN (${taskIds.map(() => "?").join(",")})
     GROUP BY task_id`,
    taskIds,
  );

  return new Map(
    rows.map((r) => [
      r.task_id,
      {
        total: Number(r.total),
        dead_ends: Number(r.dead_ends),
        questions: Number(r.questions),
      },
    ]),
  );
}

export const byId = (id: number) =>
  one<Entry>("SELECT * FROM entries WHERE id = ?", [id]);

export async function create(input: NewEntry): Promise<Entry> {
  const row = await one<Entry>(
    `INSERT INTO entries (task_id, kind, body, author, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.task_id,
      input.kind,
      input.body,
      input.author ?? "agent",
      input.model ?? null,
      now(),
    ],
  );
  return row!;
}

export const remove = (id: number) => run("DELETE FROM entries WHERE id = ?", [id]);
