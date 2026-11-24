/**
 * Characters a full briefing may take, measured as the JSON it is sent as.
 *
 * Every other bound in the briefing is a budget on one axis -- note bodies, log
 * bodies, task bodies, a count of tasks -- and none of them bounds the whole.
 * What they leave open is the scaffolding: each live task's records arrive as
 * id, kind, date and head whether or not a body was paid for, so the payload
 * grows with the number of live tasks however tight the budgets are.
 *
 * It grew past what the client accepts. Claude Code transcripts on one machine,
 * November 2026: the largest `get_context` result accepted was 47,548
 * characters and the smallest refused 51,016. A refused result is written to a
 * file, and the agent went on without opening it -- twenty times out of twenty
 * on a project with 28 live tasks.
 *
 * Forty thousand, measured on one of those refused briefings (63.9K): it comes
 * to 37.4K with every open task still named, where 32,000 drops eight task
 * lines and 24,000 drops twenty-seven. The gap up to 47K is room for the
 * `client` and `notes` fields the MCP layer appends, and for text that costs
 * more tokens per character than that project's did.
 */
export const BRIEFING_MAX_CHARS = 40_000;

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
  files: object[];
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
  /**
   * Kept when everything else goes. This is what a process on the machine with
   * the code hashes to learn that a note went stale, and a task nobody hashes
   * goes stale in silence.
   */
  files: object[];
  entry_count: number;
}

export interface Fittable {
  global_context: CarriedRecord[];
  project_context: CarriedRecord[];
  context_omitted: number;
  requested?: { id: number }[];
  open_tasks: LiveTask[];
  idle_tasks: object[];
  open_tasks_omitted: number;
  log_bodies_omitted: number;
  task_bodies_omitted: number;
}

export type Fitted<B extends Fittable> = B & { condensed_tasks: TaskLine[] };

/** Makes one cut; false when this step has nothing left to cut. */
type Cut = (brief: Fitted<Fittable>) => boolean;

/**
 * Cuts the briefing down until it fits, least valuable first, and leaves every
 * cut counted in the field that already means it.
 *
 * The order is the argument:
 *  1. Live tasks become lines, the least worth reading first -- see `byWorth`.
 *  2. Lines are dropped, idle before condensed, into `open_tasks_omitted`. A
 *     dropped task is one `list_tasks` away.
 *  3. Note bodies go, least relevant first, into `context_omitted`. After the
 *     backlog because notes are the rules a session must not break, and a
 *     backlog line is only a pointer to other work.
 *  4. The task most worth reading becomes a line too.
 *
 * `requested` is never cut: it is the one part that is an ask, not a record.
 * Never a truncation either, for the reason every budget in `briefing.ts`
 * gives: half a record reads as the whole of a shorter one.
 */
export function fitToCeiling<B extends Fittable>(brief: B, maxChars = BRIEFING_MAX_CHARS): Fitted<B> {
  const fitted: Fitted<B> = {
    ...brief,
    global_context: brief.global_context.map((n) => ({ ...n })),
    project_context: brief.project_context.map((n) => ({ ...n })),
    open_tasks: [...brief.open_tasks],
    idle_tasks: [...brief.idle_tasks],
    condensed_tasks: [],
  };
  const leastWorthFirst = byWorth(brief).reverse();
  const cuts: Cut[] = [
    condense(leastWorthFirst.slice(0, -1)),
    dropLastLine("idle_tasks"),
    dropLastLine("condensed_tasks"),
    dropLastNoteBody("project_context"),
    dropLastNoteBody("global_context"),
    condense(leastWorthFirst.slice(-1)),
  ];
  for (const cut of cuts) while (charsOf(fitted) > maxChars && cut(fitted));
  return fitted;
}

/**
 * Live task ids, the most worth reading first: work somebody queued, then work
 * in progress, then tasks the log budget paid a body on -- with a `focus`,
 * those are the ones that match it -- then the list's own order, which is
 * priority and recency. List order alone condensed the task a session had come
 * to resume whenever something of a higher priority was waiting.
 */
function byWorth(brief: Fittable): number[] {
  const requested = new Set((brief.requested ?? []).map((t) => t.id));
  const tier = (task: LiveTask): number => {
    if (requested.has(task.id)) return 0;
    if (task.status === "doing") return 1;
    return recordsOf(task).some((r) => r.body !== null) ? 2 : 3;
  };
  return [...brief.open_tasks].sort((a, b) => tier(a) - tier(b)).map((t) => t.id);
}

/** Turns the named tasks into lines, one per call, in the order given. */
function condense(ids: number[]): Cut {
  const queue = [...ids];
  return (brief) => {
    const id = queue.shift();
    const task = brief.open_tasks.find((t) => t.id === id);
    if (!task) return false;
    brief.open_tasks = brief.open_tasks.filter((t) => t !== task);
    // Each one is worth more than those already condensed: in front of them,
    // so that dropping lines from the end drops the least worth reading.
    brief.condensed_tasks.unshift(toLine(task));
    // These counters mean "here, without a body". A condensed task's records
    // are no longer here at all, so they stop counting.
    // A head beside a null body is how an unpaid body looks; a task written
    // without one has neither, and was never counted.
    if (task.body === null && task.head) brief.task_bodies_omitted -= 1;
    brief.log_bodies_omitted -= recordsOf(task).filter((r) => r.body === null).length;
    return true;
  };
}

function dropLastLine(tier: "idle_tasks" | "condensed_tasks"): Cut {
  return (brief) => {
    if (brief[tier].pop() === undefined) return false;
    brief.open_tasks_omitted += 1;
    return true;
  };
}

function dropLastNoteBody(scope: "project_context" | "global_context"): Cut {
  return (brief) => {
    const note = brief[scope].findLast((n) => n.body !== null);
    if (!note) return false;
    note.body = null;
    brief.context_omitted += 1;
    return true;
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
    files: task.files,
    entry_count: task.entry_count,
  };
}

function recordsOf(task: LiveTask): CarriedRecord[] {
  const records = [...task.decisions, ...task.dead_ends, ...task.open_questions];
  return task.last_handoff ? [...records, task.last_handoff] : records;
}

/** Empty lists cost nothing: the MCP layer leaves them out before sending. */
const charsOf = (value: unknown): number =>
  JSON.stringify(value, (_key, v: unknown) => (Array.isArray(v) && v.length === 0 ? undefined : v)).length;
