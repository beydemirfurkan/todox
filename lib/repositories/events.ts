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

export const listBetween = (from: string, to: string) =>
  all<TaskEvent>("SELECT * FROM task_events WHERE at BETWEEN ? AND ? ORDER BY id", [
    from,
    to,
  ]);

export async function create(input: NewEvent): Promise<TaskEvent> {
  const row = await one<TaskEvent>(
    `INSERT INTO task_events (task_id, from_status, to_status, at, actor, model)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [
      input.task_id,
      input.from_status,
      input.to_status,
      now(),
      input.actor ?? "agent",
      input.model ?? null,
    ],
  );
  return row!;
}
