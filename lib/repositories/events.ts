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
