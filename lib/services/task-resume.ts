import * as entries from "../repositories/entries";
import type { BriefingEntry } from "../repositories/entries";
import { attributed } from "./briefing";

/**
 * What a task's log has to say to whoever is starting it, in the answer to the
 * call that starts it.
 *
 * The briefing hands every session the log of every open task, and of 471 tasks
 * it named over forty sessions, 35 were ever opened or written on. The rest was
 * carried for nothing, on every later turn. What an agent does do is set a task
 * 'doing' -- so the log of that one task goes there, where it is certainly the
 * one being worked on and nothing new has to be remembered to ask for it.
 *
 * Small enough to send every time, and absent when there is nothing to say: a
 * task just created answers with its receipt alone.
 */
export const RESUME_MAX_CHARS = 1_500;

/**
 * In the order they are spent. The handoff is where the work was left; dead
 * ends are what the session would otherwise repeat; a question is something
 * nobody has settled; a decision can wait for `get_task`.
 */
const KINDS = ["handoff", "dead_end", "question", "decision"] as const;
const PER_KIND = { handoff: 1, dead_end: 3, question: 2, decision: 2 } as const;

/**
 * No budget on the read: it is eight rows at most, and the ceiling is applied
 * when they are fitted. The query pays for whichever body crosses its budget
 * and nulls the ones after it, so one long handoff would otherwise take the
 * bodies of the short dead ends that do fit.
 */
const READ_BYTES = Number.MAX_SAFE_INTEGER;

/** Whole (`body`) or its first line (`head`), never part of a body and never both. */
export type ResumeRecord = { id: number; kind: string; date: string; by?: string } & (
  | { body: string }
  | { head: string }
);

export interface TaskResume {
  log: ResumeRecord[];
  /** Records named by their head or left out; `get_task` reads them. */
  more?: number;
}

export async function taskResume(userId: number, taskId: number): Promise<TaskResume | null> {
  const { rows } = await entries.pageByTasksPerKind([taskId], KINDS, PER_KIND, READ_BYTES);
  const log = (rows.get(taskId) ?? []).map((row) => attributed(row, userId));
  return log.length ? fitResume(inSpendOrder(log)) : null;
}

/** By kind in the order above, newest first; the query answers oldest first. */
function inSpendOrder(log: BriefingEntry[]): BriefingEntry[] {
  const newestFirst = [...log].reverse();
  return KINDS.flatMap((kind) => newestFirst.filter((e) => e.kind === kind));
}

/**
 * Whole records while they fit, then heads, then a count.
 *
 * A body is only taken if every later record could still be named by its head,
 * decisions aside: one long handoff must not be the reason the dead end under
 * it is never seen.
 */
export function fitResume(log: BriefingEntry[], maxChars = RESUME_MAX_CHARS): TaskResume {
  const kept: ResumeRecord[] = [];
  let room = maxChars - charsOf({ log: [], more: log.length });
  for (const [i, entry] of log.entries()) {
    const reserved = log
      .slice(i + 1)
      .filter((e) => e.kind !== "decision")
      .reduce((sum, e) => sum + costOf(headOf(e)), 0);
    const whole = wholeOf(entry);
    const record = whole && costOf(whole) + reserved <= room ? whole : headOf(entry);
    if (costOf(record) > room) continue;
    kept.push(record);
    room -= costOf(record);
  }
  const more = log.length - kept.filter((r) => "body" in r).length;
  return { log: kept, ...(more ? { more } : {}) };
}

function base(entry: BriefingEntry): { id: number; kind: string; date: string; by?: string } {
  const { id, kind, by } = entry;
  return { id, kind, date: new Date(entry.created_at).toISOString().slice(0, 10), ...(by ? { by } : {}) };
}

const headOf = (entry: BriefingEntry): ResumeRecord => ({ ...base(entry), head: entry.head });

/** A body that is only its first line is sent as `body`: there is no more of it to read. */
const wholeOf = (entry: BriefingEntry): ResumeRecord | null =>
  entry.body === null ? null : { ...base(entry), body: entry.body };

const charsOf = (value: unknown): number => JSON.stringify(value).length;
/** A record and the comma after it. */
const costOf = (record: ResumeRecord): number => charsOf(record) + 1;
