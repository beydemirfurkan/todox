import { tx } from "../db/client";
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
  input: tasks.NewTask & {
    actor?: string;
    model?: string | null;
    /** Who is doing this. Resolved from the session or the token, never sent. */
    user_id?: number | null;
    /** Hashes come from the caller: this process cannot see the files. */
    files?: { path: string; hash?: string | null }[];
  },
): Promise<Task> {
  const { files, ...row } = input;
  // The task and its opening event go in together; see `tasks.create`.
  const task = await tasks.create(row);

  // Deliberately outside that statement, and not in a transaction with it: the
  // file links need the id it just returned. A dropped link costs a note its
  // file, which the next `link_files` call fixes; a dropped event costs every
  // future report its arithmetic, which nothing fixes.
  if (files?.length) await refs.link({ task_id: task.id, paths: files });

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
  meta: { actor?: string; model?: string | null; user_id?: number | null } = {},
): Promise<Task | undefined> {
  const before = await tasks.byId(id);
  if (!before) return undefined;

  const stmt = tasks.updateStmt(id, closedAtFor(patch, before));
  if (!stmt) return before;

  const moved = patch.status && patch.status !== before.status;
  if (!moved) {
    const [rows] = await tx<Task>([stmt]);
    return rows[0];
  }

  // One transaction, because the pair is the invariant: a status the event log
  // never saw is a duration every later report gets wrong. This used to be two
  // independent writes, and a dropped second one added a permanent 24 hours to
  // the daily report -- see the note in `reports.ts`.
  const [rows] = await tx<Task>([
    stmt,
    events.createStmt({
      task_id: id,
      from_status: before.status,
      to_status: patch.status!,
      actor: meta.actor,
      model: meta.model,
      user_id: meta.user_id,
    }),
  ]);
  return rows[0];
}

export async function addEntry(input: entries.NewEntry): Promise<Entry> {
  const entry = await entries.create(input);
  await tasks.touch(input.task_id);
  return entry;
}

export const remove = (id: number) => tasks.remove(id);
