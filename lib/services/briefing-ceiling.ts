/**
 * Characters a briefing may take, measured as the JSON it is sent as.
 *
 * Every other bound in the briefing is a budget on one axis -- note bodies,
 * log bodies, task bodies, a count of tasks -- and none of them is a bound on
 * the whole. The axis they leave open is the scaffolding: each live task's
 * records arrive as id, kind, date and head whether or not a body was paid
 * for, so the payload grows with the number of live tasks however tight the
 * budgets are.
 *
 * It grew past what the client will accept. Claude Code transcripts on one
 * machine, 2026-10-21: of 61 `get_context` results, 52 were refused with
 * "exceeds maximum allowed tokens" and saved to a file the agent never opened
 * -- the smallest refused was 50,658 characters, the largest accepted 26,613.
 * On one project (30 live tasks) the 84 KB breakdown was 49 KB of open tasks,
 * of which 7 KB were task bodies and most of the rest records with no body at
 * all. The agents said "the todox context is too big, I am not reading it",
 * and they were right that they could not.
 *
 * Twenty-four thousand sits under the largest result seen accepted, with room
 * for the `client` and `notes` fields the MCP layer appends afterwards.
 */
export const BRIEFING_MAX_CHARS = 24_000;

interface HandoffHead {
  id: number;
  created_at: string;
  head: string;
}

interface CarriedRecord {
  body: string | null;
}

/** What a live task carries, as far as cutting it down needs to know. */
export interface LiveTask {
  id: number;
  title: string;
  status: string;
  priority: number;
  updated_at: string;
  head: string;
  body: string | null;
  last_handoff: (HandoffHead & CarriedRecord) | null;
  decisions: CarriedRecord[];
  dead_ends: CarriedRecord[];
  open_questions: CarriedRecord[];
  entry_count: number;
}

/** A task carried as one line: what it is, and where it was left. */
export interface TaskLine {
  id: number;
  title: string;
  status: string;
  priority: number;
  updated_at: string;
  last_handoff: HandoffHead | null;
  entry_count: number;
}

export interface Fittable {
  global_context: CarriedRecord[];
  project_context: CarriedRecord[];
  context_omitted: number;
  open_tasks: LiveTask[];
  condensed_tasks: TaskLine[];
  idle_tasks: TaskLine[];
  open_tasks_omitted: number;
  log_bodies_omitted: number;
  task_bodies_omitted: number;
}

/** Characters saved by one cut, or null when this step has nothing left to cut. */
type Cut = (brief: Fittable) => number | null;

/**
 * Cuts the briefing down until it fits, least valuable first, and leaves every
 * cut counted in the field that already means it.
 *
 * The order is the argument:
 *  1. Live tasks become lines, from the end of the list -- priority, then
 *     recency, so the least urgent first. The most urgent stays whole.
 *  2. Lines are dropped, idle ones before condensed ones, into
 *     `open_tasks_omitted`. A dropped task is one `list_tasks` away.
 *  3. Note bodies go, least relevant first, into `context_omitted`. Last
 *     among the cuts because notes are the rules a session must not break,
 *     and a backlog line is only a pointer to other work.
 *  4. The most urgent task becomes a line too.
 *
 * Never a truncation, for the reason every budget in `briefing.ts` gives: half
 * a record reads as the whole of a shorter one.
 */
export function fitToCeiling<B extends Fittable>(brief: B, maxChars = BRIEFING_MAX_CHARS): B {
  const fitted: B = {
    ...brief,
    global_context: brief.global_context.map((n) => ({ ...n })),
    project_context: brief.project_context.map((n) => ({ ...n })),
    open_tasks: [...brief.open_tasks],
    condensed_tasks: [...brief.condensed_tasks],
    idle_tasks: [...brief.idle_tasks],
  };
  const cuts: Cut[] = [
    condenseDownTo(1),
    dropLastLine("idle_tasks"),
    dropLastLine("condensed_tasks"),
    dropLastNoteBody("project_context"),
    dropLastNoteBody("global_context"),
    condenseDownTo(0),
  ];
  let size = charsOf(fitted);
  for (const cut of cuts) size = cutWhileOver(fitted, cut, size, maxChars);
  return fitted;
}

/**
 * Applies one cut until the briefing fits or the cut runs out. The size is
 * tracked from what each cut reports, which can be off by a comma per cut, so
 * it is measured again before the loop believes it fits.
 */
function cutWhileOver(brief: Fittable, cut: Cut, size: number, maxChars: number): number {
  let current = size;
  while (current > maxChars) {
    const saved = cut(brief);
    if (saved === null) return current;
    current -= saved;
    if (current <= maxChars) current = charsOf(brief);
  }
  return current;
}

function condenseDownTo(keepWhole: number): Cut {
  return (brief) => {
    if (brief.open_tasks.length <= keepWhole) return null;
    const task = brief.open_tasks.pop();
    if (!task) return null;
    const line = toLine(task);
    // Popped from the end, so each one is more urgent than those already
    // condensed: in front of them keeps the list order.
    brief.condensed_tasks.unshift(line);
    // These counters mean "here, without a body". A condensed task's records
    // are no longer here at all, so they stop counting.
    if (task.body === null && task.head) brief.task_bodies_omitted -= 1;
    brief.log_bodies_omitted -= bodilessRecords(task);
    return charsOf(task) - charsOf(line);
  };
}

function dropLastLine(tier: "idle_tasks" | "condensed_tasks"): Cut {
  return (brief) => {
    const line = brief[tier].pop();
    if (!line) return null;
    brief.open_tasks_omitted += 1;
    return charsOf(line);
  };
}

function dropLastNoteBody(scope: "project_context" | "global_context"): Cut {
  return (brief) => {
    const note = brief[scope].findLast((n) => n.body !== null);
    if (!note) return null;
    const saved = charsOf(note.body) - charsOf(null);
    note.body = null;
    brief.context_omitted += 1;
    return saved;
  };
}

function toLine(task: LiveTask): TaskLine {
  const handoff = task.last_handoff;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    updated_at: task.updated_at,
    last_handoff: handoff ? { id: handoff.id, created_at: handoff.created_at, head: handoff.head } : null,
    entry_count: task.entry_count,
  };
}

function bodilessRecords(task: LiveTask): number {
  const records = [...task.decisions, ...task.dead_ends, ...task.open_questions];
  if (task.last_handoff) records.push(task.last_handoff);
  return records.filter((r) => r.body === null).length;
}

const charsOf = (value: unknown): number => JSON.stringify(value).length;
