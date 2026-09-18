import type { Status } from "../constants";
import { all, groupBy, one } from "../db/client";
import type { TaskEvent } from "../types";
import { now } from "../util/time";

export type NewEvent = {
  task_id: number;
  from_status: Status | null;
  to_status: Status;
  actor?: string;
  model?: string | null;
  /** Resolved from the session or the token, never from the caller. */
  user_id?: number | null;
};

export const listByTask = (taskId: number) =>
  all<TaskEvent>("SELECT * FROM task_events WHERE task_id = ? ORDER BY id", [taskId]);

/** Batch sibling of listByTask -- reports would otherwise be N+1 twice over. */
export async function listByTasks(taskIds: number[]): Promise<Map<number, TaskEvent[]>> {
  if (!taskIds.length) return new Map();
  const rows = await all<TaskEvent>(
    `SELECT * FROM task_events WHERE task_id IN (${taskIds.map(() => "?").join(",")})
     ORDER BY task_id, id`,
    taskIds,
  );
  return groupBy(rows, (r) => r.task_id);
}

/* There was a `listBetween(from, to)` here with no owner in the WHERE clause.
   It had no callers, and its twin in `entries` was the query that made one
   account's report read every account's log. Reach for `listByTasks` instead:
   the task ids already carry the ownership check. */

/**
 * The `INSERT` on its own, so a caller can run it inside the same transaction
 * as the status change it records. That pairing is the whole invariant: a
 * status the log never saw is a duration the report gets wrong, permanently.
 */
export function createStmt(input: NewEvent) {
  return {
    text: `INSERT INTO task_events (task_id, from_status, to_status, at, actor, model, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    params: [
      input.task_id,
      input.from_status,
      input.to_status,
      now(),
      input.actor ?? "agent",
      input.model ?? null,
      input.user_id ?? null,
    ],
  };
}

export async function create(input: NewEvent): Promise<TaskEvent> {
  const stmt = createStmt(input);
  const row = await one<TaskEvent>(stmt.text, stmt.params);
  return row!;
}

/**
 * One row per task: when its status last changed and to what, and when this
 * user last changed it. `session_status` reads it beside the entries' twin to
 * decide what a session still owes, so the two answer the same shape of
 * question on the two tables that record activity.
 *
 * `user_id` is null on every event written before the column existed and on
 * events whose account is gone; `FILTER (WHERE user_id = ?)` treats those as
 * nobody's, which is the honest answer.
 */
export type TaskActivity = {
  task_id: number;
  latest_at: string;
  latest_to_status: Status;
  last_by_user_at: string | null;
};

export async function activityByTasks(
  taskIds: number[],
  userId: number,
): Promise<Map<number, TaskActivity>> {
  if (!taskIds.length) return new Map();
  const rows = await all<TaskActivity>(
    `SELECT task_id,
            max(at) AS latest_at,
            (array_agg(to_status ORDER BY id DESC))[1] AS latest_to_status,
            max(at) FILTER (WHERE user_id = ?) AS last_by_user_at
       FROM task_events
      WHERE task_id IN (${taskIds.map(() => "?").join(",")})
      GROUP BY task_id`,
    [userId, ...taskIds],
  );
  return new Map(rows.map((r) => [r.task_id, r]));
}
