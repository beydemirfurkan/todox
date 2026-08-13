import type { EntryKind } from "../constants";
import { all, groupBy, one, run, type Statement } from "../db/client";
import type { Entry, EntryView } from "../types";
import { now } from "../util/time";

export type NewEntry = {
  task_id: number;
  kind: EntryKind;
  body: string;
  author?: string;
  model?: string | null;
  /** Resolved from the session or the token, never from the caller. */
  user_id?: number | null;
};

/**
 * The author's name comes back with the row.
 *
 * A join on a primary key, not a second query: the alternative is one lookup
 * per distinct writer on a page that already has the rows in hand. Null when
 * the entry predates the column or its author deleted their account, and the
 * `author` column ('human' / 'agent') still answers in that case.
 */
const WITH_AUTHOR = `SELECT e.*, u.name AS author_name
                       FROM entries e
                       LEFT JOIN users u ON u.id = e.user_id`;

export const listByTask = (taskId: number) =>
  all<EntryView>(`${WITH_AUTHOR} WHERE e.task_id = ? ORDER BY e.id`, [taskId]);

/**
 * Batch load for a set of tasks. Over HTTP a per-task query is a per-task round
 * trip, so anything rendering a list uses this instead.
 */
export async function listByTasks(taskIds: number[]): Promise<Map<number, EntryView[]>> {
  if (!taskIds.length) return new Map();
  const rows = await all<EntryView>(
    `${WITH_AUTHOR} WHERE e.task_id IN (${taskIds.map(() => "?").join(",")})
     ORDER BY e.task_id, e.id`,
    taskIds,
  );
  return groupBy(rows, (r) => r.task_id);
}

/**
 * The window's entries, narrowed to the tasks a report is already about.
 *
 * `resolvePeriod` returns a half-open `[from, to)` window: the upper bound
 * belongs to the next period, not this one. A `BETWEEN` that includes `to`
 * would carry every entry written at the exact second the period rolled into
 * the next one, which would then double-count them in two reports.
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
       AND created_at >= ? AND created_at < ?
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
    `INSERT INTO entries (task_id, kind, body, author, model, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.task_id,
      input.kind,
      input.body,
      input.author ?? "agent",
      input.model ?? null,
      input.user_id ?? null,
      now(),
    ],
  );
  return row!;
}

/**
 * The same write, exposed as a statement so it can sit inside one transaction
 * with the `tasks.touch` that must accompany it.
 */
export function createStmt(input: NewEntry): Statement {
  return {
    text: `INSERT INTO entries (task_id, kind, body, author, model, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    params: [
      input.task_id,
      input.kind,
      input.body,
      input.author ?? "agent",
      input.model ?? null,
      input.user_id ?? null,
      now(),
    ],
  };
}

export const remove = (id: number) => run("DELETE FROM entries WHERE id = ?", [id]);
