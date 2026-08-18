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
 * The newest `limit` entries of one task, and how many there are in total.
 *
 * `get_task` took the whole log and kept `slice(-PAGE)` of it, so the cut was
 * honest about what it showed and did nothing about what it read: the page that
 * says the log is "the only part that grows without bound" pulled all of it
 * across the network to throw most of it away.
 *
 * The rows come back oldest-first, which is the order a log is read in -- the
 * newest end is selected in the inner query and put back the right way round in
 * the outer one, because `LIMIT` needs the newest and the reader needs the
 * order.
 */
export async function pageByTask(
  taskId: number,
  limit: number,
): Promise<{ rows: EntryView[]; total: number }> {
  const [rows, total] = await Promise.all([
    all<EntryView>(
      `SELECT * FROM (${WITH_AUTHOR} WHERE e.task_id = ? ORDER BY e.id DESC LIMIT ?) newest
       ORDER BY id`,
      [taskId, limit],
    ),
    countByTask(taskId),
  ]);
  return { rows, total };
}

export async function countByTask(taskId: number): Promise<number> {
  const row = await one<{ n: string }>("SELECT COUNT(*) AS n FROM entries WHERE task_id = ?", [
    taskId,
  ]);
  return Number(row?.n ?? 0);
}

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
 * The newest `perKind` entries of each kind, for a set of tasks.
 *
 * `listByTasks` has no ceiling, and the briefing calls it for fifty tasks on
 * the first query of every session: a project with a long log answered with
 * every entry ever written on any open task. The task list was cut in SQL and
 * the log underneath it was not, so the fix only held on one axis.
 *
 * Capped per KIND rather than per task, because a flat "newest twenty" loses
 * the entries worth carrying. A task with thirty notes and two old dead ends
 * would drop both, and a dead end is the one entry that stops the next session
 * repeating something -- the reason the log exists. Partitioning by kind means
 * a pile of notes cannot push them out.
 *
 * `kinds` is a filter, not decoration: the briefing reads handoffs, decisions,
 * dead ends and questions, and counts notes without ever showing them. Loading
 * them to call `.length` was the cheapest thing here to stop doing.
 *
 * Bytes are bounded by this only as far as the row count goes -- `MAX.text` in
 * `rpc-schemas.ts` lets one body be 100 KB, so a small count is doing the real
 * work. Callers that must bound the payload itself need their own budget.
 */
export async function listByTasksPerKind(
  taskIds: number[],
  kinds: readonly EntryKind[],
  perKind: number,
): Promise<Map<number, EntryView[]>> {
  if (!taskIds.length || !kinds.length) return new Map();
  const rows = await all<EntryView>(
    `SELECT * FROM (
       SELECT e.*, u.name AS author_name,
              ROW_NUMBER() OVER (PARTITION BY e.task_id, e.kind ORDER BY e.id DESC) AS rank
         FROM entries e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.task_id IN (${taskIds.map(() => "?").join(",")})
          AND e.kind IN (${kinds.map(() => "?").join(",")})
     ) ranked
     WHERE rank <= ?
     ORDER BY task_id, id`,
    [...taskIds, ...kinds, perKind],
  );
  return groupBy(rows, (r) => r.task_id);
}

/**
 * The newest `perTask` entries of each task, every kind, in reading order.
 *
 * For a list that shows the log itself rather than a summary of it. The public
 * share page used `listByTasks`, so one unauthenticated URL read every entry of
 * every open task in a project and rendered all of them -- no session, no
 * ceiling, and no rate limit in front of it.
 */
export async function listByTasksNewest(
  taskIds: number[],
  perTask: number,
): Promise<Map<number, EntryView[]>> {
  if (!taskIds.length) return new Map();
  const rows = await all<EntryView>(
    `SELECT * FROM (
       SELECT e.*, u.name AS author_name,
              ROW_NUMBER() OVER (PARTITION BY e.task_id ORDER BY e.id DESC) AS rank
         FROM entries e
         LEFT JOIN users u ON u.id = e.user_id
        WHERE e.task_id IN (${taskIds.map(() => "?").join(",")})
     ) ranked
     WHERE rank <= ?
     ORDER BY task_id, id`,
    [...taskIds, perTask],
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
 *
 * The comparison is half-open for the same reason `tasks.activeBetween` is:
 * `resolvePeriod`'s `to` is the first instant outside the window and equals the
 * next window's `from`, so `BETWEEN` filed an entry written exactly on the
 * boundary under both days.
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

export type EntryCounts = {
  total: number;
  decisions: number;
  dead_ends: number;
  questions: number;
};

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
    decisions: string;
    dead_ends: string;
    questions: string;
  }>(
    `SELECT task_id,
       COUNT(*)                                    AS total,
       COUNT(*) FILTER (WHERE kind = 'decision')   AS decisions,
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
        decisions: Number(r.decisions),
        dead_ends: Number(r.dead_ends),
        questions: Number(r.questions),
      },
    ]),
  );
}

export const byId = (id: number) =>
  one<Entry>("SELECT * FROM entries WHERE id = ?", [id]);

/**
 * Beside `create` because the entry has to be written with the task's
 * `updated_at`, and only `task-service` may sequence the two. The SQL stays
 * with the table that owns it; see the transaction rule in CONTRIBUTING.md.
 */
export const createStmt = (input: NewEntry): Statement => ({
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
});

export async function create(input: NewEntry): Promise<Entry> {
  const stmt = createStmt(input);
  const row = await one<Entry>(stmt.text, stmt.params);
  return row!;
}

export const remove = (id: number) => run("DELETE FROM entries WHERE id = ?", [id]);
