import { isClosedStatus } from "../constants";
import { tx } from "../db/client";
import { BadRequest } from "./errors";
import * as entries from "../repositories/entries";
import * as events from "../repositories/events";
import * as observations from "../repositories/observations";
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
  return { ...patch, closed_at: isClosedStatus(next) ? now() : null };
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

/**
 * The entry and the task's `updated_at` go in together.
 *
 * These were two awaits, and the second one carries the whole reason the first
 * is interesting: every list in the app is ordered by `updated_at`, so a task
 * whose log just grew but whose timestamp did not sinks below tasks nobody has
 * touched. The log would be right and the ordering that surfaces it wrong,
 * which is the failure this codebase keeps finding -- a write that half
 * happened and reads as if it fully did.
 */
/**
 * What `answers_entry_id` is allowed to point at.
 *
 * Ownership is not asked here -- `assertTask` at the RPC boundary has already
 * established that this caller may write to this task, and requiring the target
 * to be *on that task* is what makes that check cover the target too. It also
 * keeps the read the briefing does simple: a question and the thing that closes
 * it are always in the same log.
 *
 * `question` specifically, because the field means "this is no longer open" and
 * that only means anything for the kind that can be open. Pointing it at a
 * decision would quietly hide the decision from every briefing.
 */
async function assertAnswerable(taskId: number, entryId: number): Promise<void> {
  const target = await entries.byId(entryId);
  // Same message for "no such entry" and "not on this task" on purpose: the
  // reply must not tell a caller that an id exists somewhere else.
  if (!target || target.task_id !== taskId)
    throw new BadRequest(`entry #${entryId} is not on task #${taskId}`);
  if (target.kind !== "question")
    throw new BadRequest(
      `entry #${entryId} is a ${target.kind}, and only a question can be answered`,
    );
}

export async function addEntry(
  input: entries.NewEntry & {
    /**
     * An unverified observation this entry is written up from.
     *
     * Marked in the same transaction as the entry, because the two disagreeing
     * is worse than neither happening: an entry alone leaves the briefing
     * showing the same session until it expires, and a mark alone throws the
     * observation away with nothing written in its place.
     *
     * `promoteStmt` deliberately needs nothing from the row being inserted --
     * `tx()` runs no JavaScript between statements, so a promotion that wanted
     * the new entry's id would have needed a CTE, and a third exception to
     * that rule needs a better reason than bookkeeping.
     */
    from_observation_id?: number;
  },
): Promise<Entry> {
  if (input.answers_entry_id != null)
    await assertAnswerable(input.task_id, input.answers_entry_id);

  const { from_observation_id, ...row } = input;

  const [rows] = await tx<Entry>([
    entries.createStmt(row),
    tasks.touchStmt(row.task_id),
    ...(from_observation_id == null
      ? []
      : [observations.promoteStmt(from_observation_id, row.kind)]),
  ]);
  return rows[0];
}

export const remove = (id: number) => tasks.remove(id);
