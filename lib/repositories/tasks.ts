import { DEFAULT_PRIORITY, OPEN_STATUSES, isClosedStatus, type Status } from "../constants";
import { all, one, run, runStmt, setClause, type Statement } from "../db/client";
import type { Task } from "../types";
import { now } from "../util/time";

export type StatusFilter = Status | "open" | "all";

export type NewTask = {
  project_id: number;
  title: string;
  body?: string | null;
  status?: Status;
  priority?: number;
};

export type TaskPatch = Partial<
  Pick<Task, "title" | "body" | "status" | "priority" | "closed_at">
>;

/** The only columns `update` will write. See `setClause` for why this exists. */
const COLUMNS = ["title", "body", "status", "priority", "closed_at"] as const;

export function listByProject(projectId: number, status: StatusFilter = "open") {
  if (status === "all")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
       ORDER BY (status IN ('done','dropped')), priority, updated_at DESC`,
      [projectId],
    );

  if (status === "open")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
         AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})
       ORDER BY priority, updated_at DESC`,
      [projectId, ...OPEN_STATUSES],
    );

  return all<Task>(
    "SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY priority, updated_at DESC",
    [projectId, status],
  );
}

/**
 * The same list, cut in SQL, for the callers that only ever wanted the top of
 * it.
 *
 * `briefing` and `list_tasks` both fetched every open task and then sliced the
 * array. That reads the whole set and sorts it to hand back fifty rows -- and
 * it is the first query of every session. Measured on one project with 20,500
 * tasks, 12,300 of them open: 33.5ms to fetch and sort them all, against
 * 0.16ms for the same fifty once the ceiling and `idx_tasks_project_rank` are
 * both in play. The index alone changes nothing, because without a `LIMIT`
 * every matching row has to be read anyway; the two only pay together.
 *
 * Two round trips rather than one, because the count is what lets the caller
 * say how many it left out, and `count(*) OVER ()` would walk the whole set
 * again and give the ceiling back. The count is an index scan and costs a
 * fraction of the sort it replaces.
 *
 * Not for the project page or a share link: those filter and re-order the full
 * set in JavaScript, so a cut here would quietly change which tasks the
 * filters can see.
 */
export async function pageByProject(
  projectId: number,
  status: StatusFilter,
  limit: number,
): Promise<{ rows: Task[]; total: number }> {
  const [rows, total] = await Promise.all([
    limitedByProject(projectId, status, limit),
    countByProject(projectId, status),
  ]);
  return { rows, total };
}

function limitedByProject(projectId: number, status: StatusFilter, limit: number) {
  if (status === "all")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
       ORDER BY (status IN ('done','dropped')), priority, updated_at DESC
       LIMIT ?`,
      [projectId, limit],
    );

  if (status === "open")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
         AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})
       ORDER BY priority, updated_at DESC
       LIMIT ?`,
      [projectId, ...OPEN_STATUSES, limit],
    );

  return all<Task>(
    `SELECT * FROM tasks WHERE project_id = ? AND status = ?
     ORDER BY priority, updated_at DESC LIMIT ?`,
    [projectId, status, limit],
  );
}

async function countByProject(projectId: number, status: StatusFilter): Promise<number> {
  const row =
    status === "all"
      ? await one<{ n: string }>("SELECT count(*) AS n FROM tasks WHERE project_id = ?", [
          projectId,
        ])
      : status === "open"
        ? await one<{ n: string }>(
            `SELECT count(*) AS n FROM tasks WHERE project_id = ?
               AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
            [projectId, ...OPEN_STATUSES],
          )
        : await one<{ n: string }>(
            "SELECT count(*) AS n FROM tasks WHERE project_id = ? AND status = ?",
            [projectId, status],
          );
  // `count(*)` arrives as a string: it is bigint, and the driver will not
  // narrow one to a JS number on its own.
  return Number(row?.n ?? 0);
}

export const byId = (id: number) => one<Task>("SELECT * FROM tasks WHERE id = ?", [id]);

/**
 * Everything created, closed or touched inside a window -- the report's raw input.
 *
 * `>= from AND < to`, never `BETWEEN`. `resolvePeriod` hands back a half-open
 * window whose `to` is the first instant *outside* it, and yesterday's `to` is
 * today's `from`; `BETWEEN` includes both ends, so a row written exactly on a
 * midnight boundary was counted in both days' reports. The window was made
 * half-open to fix precisely that -- see the note in `lib/util/time.ts` -- and
 * these four comparisons were what the fix never reached.
 */
export const activeBetween = (userId: number, from: string, to: string) =>
  all<Task>(
    `SELECT DISTINCT t.* FROM tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     LEFT JOIN entries e     ON e.task_id = t.id AND e.created_at >= ? AND e.created_at < ?
     LEFT JOIN task_events v ON v.task_id = t.id AND v.at         >= ? AND v.at         < ?
      WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)
        AND ((t.created_at >= ? AND t.created_at < ?)
         OR (t.closed_at   >= ? AND t.closed_at  < ?)
         OR e.id IS NOT NULL
         OR v.id IS NOT NULL)
     ORDER BY t.updated_at DESC`,
    [userId, from, to, from, to, userId, from, to, from, to],
  );

/**
 * Creates the task and its opening event in one statement.
 *
 * This is the one place a repository writes another module's table, and the
 * driver is the reason: it takes a list of prepared queries with no JavaScript
 * between them, so a second statement cannot use the id the first returned.
 * Two round trips would leave a task whose status was never recorded whenever
 * the second one dropped -- and `timingFor` replays those events to produce
 * every duration in every report. A CTE is the only way to make it atomic.
 */
export async function create(
  input: NewTask & { actor?: string; model?: string | null; user_id?: number | null },
): Promise<Task> {
  const ts = now();
  const status = input.status ?? "todo";
  // A task may open already closed -- `create_task` takes a status, and an
  // agent recording work it has just finished passes `done`. Deriving the
  // column here is safe in a way it is not in `update`: there is no previous
  // status to preserve. Left null, the task was missing from the closed side
  // of every report, so it counted as opened and never as finished.
  const closedAt = isClosedStatus(status) ? ts : null;
  const row = await one<Task>(
    `WITH t AS (
       INSERT INTO tasks (project_id, title, body, status, priority, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *
     ), e AS (
       INSERT INTO task_events (task_id, from_status, to_status, at, actor, model, user_id)
       SELECT t.id, NULL, t.status, ?, ?, ?, ? FROM t
     )
     SELECT * FROM t`,
    [
      input.project_id,
      input.title,
      input.body ?? null,
      status,
      input.priority ?? DEFAULT_PRIORITY,
      ts,
      ts,
      closedAt,
      ts,
      input.actor ?? "agent",
      input.model ?? null,
      input.user_id ?? null,
    ],
  );
  return row!;
}

/**
 * The `UPDATE` on its own, for a caller that has to run it beside another
 * table's write in one transaction. `update` is the same statement executed by
 * itself; neither builds its `SET` clause by hand.
 */
export function updateStmt(id: number, patch: TaskPatch) {
  const set = setClause(patch, COLUMNS);
  if (!set.sql) return undefined;
  return {
    text: `UPDATE tasks SET ${set.sql}, updated_at = ? WHERE id = ? RETURNING *`,
    params: [...set.values, now(), id],
  };
}

/**
 * `closed_at` is a normal column here and is written only when the caller asks
 * for it. Deriving it from `patch.status` inside this function meant every
 * update touched it, so editing the title of a finished task erased the date
 * it was finished. `task-service.update` owns that rule now, because it is the
 * only caller that knows the previous status.
 */
export async function update(id: number, patch: TaskPatch): Promise<Task | undefined> {
  const stmt = updateStmt(id, patch);
  if (!stmt) return byId(id);
  return one<Task>(stmt.text, stmt.params);
}

export const touchStmt = (id: number): Statement => ({
  text: "UPDATE tasks SET updated_at = ? WHERE id = ?",
  params: [now(), id],
});

export const touch = (id: number) => runStmt(touchStmt(id));

export const remove = (id: number) => run("DELETE FROM tasks WHERE id = ?", [id]);

/**
 * Move every task to another project, for a merge.
 *
 * Entries, events and refs hang off `task_id`, so they follow without being
 * touched -- and must not be touched, because rewriting them separately is how
 * a log ends up describing a task that moved without it.
 */
export const reassignStmt = (fromId: number, intoId: number): Statement => ({
  text: "UPDATE tasks SET project_id = ? WHERE project_id = ?",
  params: [intoId, fromId],
});

export async function counts(projectId: number) {
  // Postgres has no implicit boolean-to-integer, so FILTER replaces SUM(x=y).
  const row = await one<Record<string, string | null>>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'todo')    AS todo,
       COUNT(*) FILTER (WHERE status = 'doing')   AS doing,
       COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
       COUNT(*) FILTER (WHERE status = 'done')    AS done,
       COUNT(*) FILTER (WHERE status = 'dropped') AS dropped
     FROM tasks WHERE project_id = ?`,
    [projectId],
  );
  const n = (v: string | null | undefined) => Number(v ?? 0);
  return {
    todo: n(row?.todo),
    doing: n(row?.doing),
    blocked: n(row?.blocked),
    done: n(row?.done),
    dropped: n(row?.dropped),
  };
}

/** One query for a whole project's counts, so the home page is not N+1. */
export async function countsByProject(userId: number) {
  const rows = await all<{
    project_id: number;
    todo: string;
    doing: string;
    blocked: string;
    done: string;
    dropped: string;
  }>(
    `SELECT t.project_id,
       COUNT(*) FILTER (WHERE t.status = 'todo')    AS todo,
       COUNT(*) FILTER (WHERE t.status = 'doing')   AS doing,
       COUNT(*) FILTER (WHERE t.status = 'blocked') AS blocked,
       COUNT(*) FILTER (WHERE t.status = 'done')    AS done,
       COUNT(*) FILTER (WHERE t.status = 'dropped') AS dropped
      FROM tasks t JOIN projects p ON p.id = t.project_id
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE p.user_id = ? OR pm.user_id IS NOT NULL
     GROUP BY t.project_id`,
    [userId, userId],
  );

  const empty = { todo: 0, doing: 0, blocked: 0, done: 0, dropped: 0 };
  const map = new Map<number, typeof empty>();
  for (const r of rows)
    map.set(r.project_id, {
      todo: Number(r.todo),
      doing: Number(r.doing),
      blocked: Number(r.blocked),
      done: Number(r.done),
      dropped: Number(r.dropped),
    });
  return { map, empty };
}
