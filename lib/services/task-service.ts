import * as entries from "../repositories/entries";
import * as events from "../repositories/events";
import * as refs from "../repositories/refs";
import * as tasks from "../repositories/tasks";
import type { Entry, Task } from "../types";
import { now } from "../util/time";

/**
 * Writes that must stay consistent across tables live here, not in the
 * repositories. The invariant: every status a task has ever held is on the
 * event log, because the reports are only as honest as that log.
 */

export async function create(
  input: tasks.NewTask & { actor?: string; model?: string | null; files?: string[] },
): Promise<Task> {
  const { actor, model, files, ...row } = input;
  const task = await tasks.create(row);

  await events.create({
    task_id: task.id,
    from_status: null,
    to_status: task.status,
    actor,
    model,
  });

  if (files?.length)
    await refs.link({ task_id: task.id, paths: files.map((path) => ({ path })) });

  return task;
}

/**
 * `closed_at` follows the status, and only a real transition moves it.
 *
 * It used to be derived inside the repository from `patch.status`, which meant
 * every update wrote the column: saving a title change on a finished task set
 * it to NULL and the task fell out of every report, and re-saving a done task
 * as done pushed the completion time forward. Both were invisible until a
 * report came out wrong.
 */
function closedAtFor(patch: tasks.TaskPatch, before: Task): tasks.TaskPatch {
  const next = patch.status;
  if (!next || next === before.status) return patch;
  const closes = next === "done" || next === "dropped";
  return { ...patch, closed_at: closes ? now() : null };
}

export async function update(
  id: number,
  patch: tasks.TaskPatch,
  meta: { actor?: string; model?: string | null } = {},
): Promise<Task | undefined> {
  const before = await tasks.byId(id);
  if (!before) return undefined;

  const after = await tasks.update(id, closedAtFor(patch, before));
  if (after && patch.status && patch.status !== before.status) {
    await events.create({
      task_id: id,
      from_status: before.status,
      to_status: patch.status,
      actor: meta.actor,
      model: meta.model,
    });
  }
  return after;
}

export async function addEntry(input: entries.NewEntry): Promise<Entry> {
  const entry = await entries.create(input);
  await tasks.touch(input.task_id);
  return entry;
}

export const remove = (id: number) => tasks.remove(id);
