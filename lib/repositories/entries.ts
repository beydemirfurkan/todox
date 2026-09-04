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
  /**
   * The question this entry settles, if it settles one.
   *
   * Checked at the RPC boundary rather than here: it has to be a `question`, on
   * this task, belonging to this caller, and a repository cannot ask any of
   * those without reading a second table.
   */
  answers_entry_id?: number | null;
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
 *
 * This one returns whole rows and is for `get_file_context`, which shows a
 * file's dead ends and decisions in full. The briefing wants the same cut with
 * a byte budget and a head on every row, and that is `pageByTasksPerKind`.
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
          -- A question that something answers is no longer open, and this is
          -- the one place that has to know it. Filtering after the read would
          -- let three answered questions push the open one past the per-kind
          -- ceiling, which is the cut this window is applying -- and no
          -- backtick may appear in this comment, because the whole query is a
          -- template literal and a backtick ends it.
          AND NOT EXISTS (SELECT 1 FROM entries a WHERE a.answers_entry_id = e.id)
     ) ranked
     WHERE rank <= ?
     ORDER BY task_id, id`,
    [...taskIds, ...kinds, perKind],
  );
  return groupBy(rows, (r) => r.task_id);
}

/**
 * An entry as the briefing carries it.
 *
 * `body` is null when the byte budget was already spent -- not when the entry
 * is empty, which cannot happen: `log_entry` requires at least one character.
 * So null means "ask for it", the same thing it means on `BriefingNote`, and
 * `get_task` is where it is asked for.
 */
export type BriefingEntry = {
  id: number;
  /**
   * Redundant inside `decisions`, and the reason it is here anyway is
   * `last_handoff`: one field of this type on its own, where a reader with the
   * object in hand and no surrounding list has nothing else to say what it is.
   */
  kind: EntryKind;
  created_at: string;
  /**
   * The first line of the body, and never a truncation of a paragraph.
   *
   * This log's own writing convention puts a headline on the first line -- the
   * tool instructions ask for it in so many words ("write the first paragraph
   * to stand alone") -- so the first line is a label somebody already wrote,
   * not a cut somebody guessed at. That is what makes it safe to always send:
   * an agent skimming a task indexes off `head` without having to branch on
   * whether a body arrived.
   *
   * A head that had to be shortened carries an ellipsis, so a whole headline
   * and a cut one are distinguishable. Half a sentence with no mark is the
   * thing `BriefingNote` refuses to do to a body, for the same reason.
   */
  head: string;
  body: string | null;
};

/**
 * How much of a body a head may be. The same 240 `search` cuts its snippet to,
 * because an agent has already been taught to expect that shape there.
 */
export const HEAD_CHARS = 240;

/**
 * The first line, with any carriage return left by a Windows editor removed.
 *
 * `chr(10)` and `chr(13)` rather than `E'\n'` for two separate reasons, both
 * of which have bitten this repository. The query is a JavaScript template
 * literal, so a backslash escape is consumed before Postgres ever sees it; and
 * the obvious first-SENTENCE split wants `[.!?]`, whose `?` inside a string
 * literal would shift every parameter after it -- `lib/db/client.ts` rewrites
 * positionally and does not parse strings.
 */
const FIRST_LINE = `rtrim(split_part(e.body, chr(10), 1), chr(13))`;

/**
 * The same cut as `listByTasksPerKind`, as the briefing needs it: a head on
 * every row, a count that can differ per kind, and no join for an author
 * nothing here renders.
 *
 * `perKind` is one number per kind because the briefing wants three decisions
 * and exactly one handoff, and asking for three of each is paid for on the
 * network whether or not anything reads it. Measured on production
 * 2026-09-04: 13 handoff rows fetched where 6 were shown, 45,753 bytes where
 * 21,444 were rendered.
 */
/**
 * The query above as text, so its shape can be asserted without a database.
 *
 * `pnpm test` runs without one, so this is the only thing CI checks on every
 * push -- and shape is where the expensive mistakes live here: a placeholder
 * inside a literal, a lost cast, a dropped filter. The same argument
 * `observations.ts` makes for exporting its `QUERIES`.
 */
export const pageByTasksPerKindSql = (taskCount: number, kindCount: number): string => {
  const list = (n: number, each: string) => Array.from({ length: n }, () => each).join(",");
  return `WITH picked AS (
       SELECT e.id, e.task_id, e.kind, e.created_at, e.body,
              CASE WHEN length(${FIRST_LINE}) > ?
                   THEN left(${FIRST_LINE}, ?) || '…'
                   ELSE ${FIRST_LINE} END AS head,
              ROW_NUMBER() OVER (PARTITION BY e.task_id, e.kind ORDER BY e.id DESC) AS in_kind
         FROM entries e
        WHERE e.task_id IN (${list(taskCount, "?")})
          AND e.kind IN (${list(kindCount, "?")})
          -- A question that something answers is no longer open, and this is
          -- the one place that has to know it. Filtering after the read would
          -- let three answered questions push the open one past the per-kind
          -- ceiling, which is the cut this window is applying -- and no
          -- backtick may appear in this comment, because the whole query is a
          -- template literal and a backtick ends it.
          AND NOT EXISTS (SELECT 1 FROM entries a WHERE a.answers_entry_id = e.id)
     ),
     -- A CASE over the kinds already being filtered by, so one number per kind
     -- and one number for all of them are the same query. No ELSE is needed
     -- and none is written: a row whose kind is not in the filter cannot reach
     -- here, and an ELSE would have to guess between hiding rows and showing
     -- every one of them.
     --
     -- The cast is load-bearing. ROW_NUMBER() is bigint and the THEN
     -- parameters carry no type, so Postgres infers them from the only other
     -- thing in the CASE -- kind, which is text -- and the comparison dies
     -- with "operator does not exist: bigint <= text". It fails at the
     -- database, so the unit tests cannot see it: they all mock this module.
     kept AS (
       SELECT * FROM picked
        WHERE in_kind <= (CASE kind ${Array.from({ length: kindCount }, () => "WHEN ? THEN ?").join(" ")} END)::int
     ),
     -- What every row before this one already cost.
     --
     -- ROWS ... AND 1 PRECEDING rather than CURRENT ROW, so the row that
     -- crosses the line is still paid for and a briefing always carries at
     -- least one body. The alternative has a cliff: MAX.text lets one entry be
     -- 100 KB, and a sum that included the current row would answer a whole
     -- briefing of heads and nothing else the moment such a row sorted first.
     -- The cost of the rule chosen is that the payload can overshoot by
     -- exactly one body, bounded by MAX.text and in practice by about 6.5 KB.
     --
     -- octet_length rather than length, because half of this corpus is Turkish
     -- and character count undercounts it by 10-15%. JSON escaping adds a few
     -- percent on top of that, so the budget is honest to within a few percent
     -- and not to the byte.
     --
     -- SPEND ORDER, and the first term is the one that matters: in_kind ASC is
     -- a round robin, so EVERY task's newest dead end is paid for before ANY
     -- task's second-newest anything. Pure recency would let one busy task's
     -- three fresh decisions eat the budget and return every dead end in the
     -- project as a head. That is listByTasksPerKind's own argument -- "a dead
     -- end is the one entry that stops the next session repeating something"
     -- one level down, applied to bytes instead of rows.
     --
     -- Then kind, in the order the caller listed them, which is why that array
     -- is ordered rather than a set.
     spent AS (
       SELECT *,
              SUM(octet_length(body)) OVER (
                ORDER BY in_kind ASC,
                         (CASE kind ${Array.from({ length: kindCount }, () => "WHEN ? THEN ?").join(" ")} END)::int ASC,
                         id DESC
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS spent_before
         FROM kept
     )
     SELECT id, task_id, kind, created_at, head,
            CASE WHEN coalesce(spent_before, 0) < ? THEN body END AS body
       FROM spent
      ORDER BY task_id, id`;
};


export async function pageByTasksPerKind(
  taskIds: number[],
  kinds: readonly EntryKind[],
  perKind: Partial<Record<EntryKind, number>>,
  budgetBytes: number,
): Promise<{ rows: Map<number, BriefingEntry[]>; bodiesOmitted: number }> {
  if (!taskIds.length || !kinds.length) return { rows: new Map(), bodiesOmitted: 0 };
  const rows = await all<BriefingEntry & { task_id: number }>(
    pageByTasksPerKindSql(taskIds.length, kinds.length),
    [
      HEAD_CHARS,
      HEAD_CHARS,
      ...taskIds,
      ...kinds,
      ...kinds.flatMap((k) => [k, perKind[k] ?? 0]),
      // The kinds again, as their spend priority: the caller's order.
      ...kinds.flatMap((k, i) => [k, i]),
      budgetBytes,
    ],
  );
  // Derived from the rows already in hand rather than counted again, exactly
  // as `contexts.pageByProject` does it. One budget is spent across the whole
  // briefing, so this total belongs beside `context_omitted` at the top of the
  // payload and not on any one task.
  return {
    rows: groupBy(rows, (r) => r.task_id),
    bodiesOmitted: rows.filter((r) => r.body === null).length,
  };
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
  text: `INSERT INTO entries (task_id, kind, body, author, model, user_id, answers_entry_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  params: [
    input.task_id,
    input.kind,
    input.body,
    input.author ?? "agent",
    input.model ?? null,
    input.user_id ?? null,
    input.answers_entry_id ?? null,
    now(),
  ],
});

export async function create(input: NewEntry): Promise<Entry> {
  const stmt = createStmt(input);
  const row = await one<Entry>(stmt.text, stmt.params);
  return row!;
}

export const remove = (id: number) => run("DELETE FROM entries WHERE id = ?", [id]);
