import { OPEN_STATUSES, type Status } from "../constants";
import { all, one, run, setClause } from "../db/client";
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

export const byId = (id: number) => one<Task>("SELECT * FROM tasks WHERE id = ?", [id]);

/** Everything created, closed or touched inside a window -- the report's raw input. */
export const activeBetween = (userId: number, from: string, to: string) =>
  all<Task>(
    `SELECT DISTINCT t.* FROM tasks t
     JOIN projects p ON p.id = t.project_id AND p.user_id = ?
     LEFT JOIN entries e     ON e.task_id = t.id AND e.created_at BETWEEN ? AND ?
     LEFT JOIN task_events v ON v.task_id = t.id AND v.at         BETWEEN ? AND ?
     WHERE (t.created_at BETWEEN ? AND ?)
        OR (t.closed_at  BETWEEN ? AND ?)
        OR e.id IS NOT NULL
        OR v.id IS NOT NULL
     ORDER BY t.updated_at DESC`,
    [userId, from, to, from, to, from, to, from, to],
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
  input: NewTask & { actor?: string; model?: string | null },
): Promise<Task> {
  const ts = now();
  const row = await one<Task>(
    `WITH t AS (
       INSERT INTO tasks (project_id, title, body, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING *
     ), e AS (
       INSERT INTO task_events (task_id, from_status, to_status, at, actor, model)
       SELECT t.id, NULL, t.status, ?, ?, ? FROM t
     )
     SELECT * FROM t`,
    [
      input.project_id,
      input.title,
      input.body ?? null,
      input.status ?? "todo",
      input.priority ?? 2,
      ts,
      ts,
      ts,
      input.actor ?? "agent",
      input.model ?? null,
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

export const touch = (id: number) =>
  run("UPDATE tasks SET updated_at = ? WHERE id = ?", [now(), id]);

export const remove = (id: number) => run("DELETE FROM tasks WHERE id = ?", [id]);

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
     WHERE p.user_id = ?
     GROUP BY t.project_id`,
    [userId],
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
