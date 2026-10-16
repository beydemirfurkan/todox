import { HEAD_CHARS } from "../repositories/entries";
import type { Task } from "../types";

/**
 * Advice returned beside a write that succeeded. Never a refusal: the write
 * path an agent takes has to stay as cheap as a human's, and a refused entry is
 * an entry that does not get written at all.
 *
 * Both rules were measured before they were written (production, 2026-10-16):
 * half of all handoffs had a first line longer than the briefing shows, and a
 * quarter of finished tasks were opened and closed inside fifteen minutes.
 */

/** A task done this quickly was work finished in the same breath it was filed. */
const QUICK_CLOSE_MINUTES = 15;

/**
 * The briefing shows an entry's first line and pays for bodies only while a
 * byte budget lasts, so a first line past `HEAD_CHARS` is a headline the next
 * session reads cut off.
 */
export function headlineHint(body: string): string | undefined {
  const first = body.split("\n", 1)[0].trim();
  if (first.length <= HEAD_CHARS) return undefined;
  return (
    `The first line is ${first.length} characters; the briefing shows ${HEAD_CHARS}. ` +
    "Next time, open with a one-line headline and put the detail below it."
  );
}

/** Said when a task goes to 'done' within minutes of being created. */
export function quickCloseHint(task: Pick<Task, "status" | "created_at" | "closed_at">) {
  if (task.status !== "done" || !task.closed_at) return undefined;
  const minutes = (Date.parse(task.closed_at) - Date.parse(task.created_at)) / 60_000;
  if (minutes >= QUICK_CLOSE_MINUTES) return undefined;
  return (
    "Done within minutes of being created. A task is for work that outlives the session; " +
    "for something finished now, a log_entry on the task it belongs to is enough."
  );
}
