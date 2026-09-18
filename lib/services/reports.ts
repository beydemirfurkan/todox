import { OPEN_STATUSES, type EntryKind, type Status } from "../constants";
import * as entriesRepo from "../repositories/entries";
import * as eventsRepo from "../repositories/events";
import * as projectsRepo from "../repositories/projects";
import * as tasksRepo from "../repositories/tasks";
import type { Entry, Task, TaskEvent } from "../types";
import { ms, withinPeriod, type Period } from "../util/time";

export type TaskTiming = {
  /** First moment the task entered `doing`. Null if it never started. */
  started_at: string | null;
  closed_at: string | null;
  /** created -> closed. What a manager means by "how long did it take". */
  lead_ms: number | null;
  /** Time actually spent in `doing`, over the task's whole life. */
  active_ms: number;
  /**
   * Time in `doing` that nobody was plausibly attending, left out of
   * `active_ms`. The opposite caveat to `partial`: that one says the figure
   * is a floor, this one says how much was cut from a ceiling.
   */
  discounted_ms: number;
  /** True when active_ms is a floor: backfilled, or closed without ever starting. */
  partial: boolean;
};

export type TaskReport = TaskTiming & {
  id: number;
  title: string;
  body: string | null;
  project_slug: string;
  project_name: string;
  status: Status;
  priority: number;
  importance: "high" | "normal" | "low";
  created_at: string;
  models: string[];
  authors: string[];
  entry_counts: Record<EntryKind, number>;
  decisions: string[];
  dead_ends: string[];
  open_questions: string[];
  last_handoff: string | null;
  /**
   * The slice of `active_ms` that falls inside the window being reported on.
   * This is what the totals sum, so it is what a per-task line should show.
   */
  active_ms_in_period: number;
  /** The slice of `discounted_ms` inside the window, for the same reason. */
  discounted_ms_in_period: number;
};

export type ActivityReport = {
  period: Period;
  generated_at: string;
  totals: {
    created: number;
    completed: number;
    dropped: number;
    touched: number;
    entries: number;
    decisions: number;
    dead_ends: number;
    questions: number;
    active_ms: number;
    /**
     * Tasks the window touched whose time could not be measured at all.
     *
     * `active_ms` above sums time spent in `doing`, and a task that went
     * straight to `done` contributes a clean zero to it. Per task that is
     * already said out loud -- `partial` is true and the markdown marks the
     * figure with a tilde -- but the headline number rolled every one of those
     * zeros in and claimed nothing.
     *
     * Measured in production on 2026-09-04: 43 of 78 completed tasks never
     * passed through `doing`, and of the 38 in one report window, 23 answered
     * `active_ms: 0, partial: true`. So the headline was an average over a
     * denominator nobody was shown, and the product's own rule is that context
     * which lies is worse than none.
     */
    unmeasured: number;
    /**
     * `doing` time inside the window that was not counted, summed over every
     * task, because nobody was attending it -- see `doingSpans`.
     *
     * Measured on one account, 1-18 September 2026: `active_ms` came to
     * 5,430 hours in eighteen days. Tasks had been set 'doing' and left
     * there for three weeks, and every one of those weeks was on the
     * headline. A duration that can only grow is not a measurement, and
     * the product's claim is that the report comes from the log rather
     * than from a guess.
     */
    discounted_ms: number;
  };
  by_project: {
    slug: string;
    name: string;
    created: number;
    completed: number;
    touched: number;
    active_ms: number;
  }[];
  by_model: { model: string; entries: number; tasks: number }[];
  completed: TaskReport[];
  in_progress: TaskReport[];
  decisions: ReportEntry[];
  dead_ends: ReportEntry[];
  open_questions: ReportEntry[];
};

export type ReportEntry = {
  task_id: number;
  task: string;
  /** Null when the entry's task fell outside the window, same as `task`. */
  project_slug: string | null;
  /** Cut at a word boundary when `truncated`; the entry itself is on the task. */
  body: string;
  truncated: boolean;
  at: string;
};

/**
 * How much of an entry body a report section carries.
 *
 * A report is a summary and the entry itself is one click away, but these
 * sections shipped the whole body: they are written agent-to-agent and run to
 * a few thousand characters -- the longest in this repo's own log is 3839, and
 * two thirds of them are over 1200. A month's worth of that is the entire log
 * in a page that renders each one as a single paragraph.
 *
 * `truncated` is the part a caller needs: the page links to the entry, the
 * markdown marks the cut. Neither may guess from the length, because a body
 * that stops exactly on the limit was not cut.
 */
const SUMMARY_CHARS = 480;

export function summarise(body: string): { body: string; truncated: boolean } {
  const text = body.trim();
  if (text.length <= SUMMARY_CHARS) return { body: text, truncated: false };

  const cut = text.slice(0, SUMMARY_CHARS);
  // Back up to the last whitespace so the summary does not stop mid-word.
  // `search` finds where that run starts; -1 means there is no whitespace at
  // all in reach -- a pasted url, a stack frame -- and then a hard cut is the
  // only answer. Half the budget is the floor: a body that opens with one word
  // and then an unbroken 470-character run should not summarise to that word.
  const boundary = cut.search(/\s\S*$/);
  const kept = boundary > SUMMARY_CHARS / 2 ? cut.slice(0, boundary) : cut;
  return { body: kept.trimEnd(), truncated: true };
}

const IMPORTANCE: Record<number, TaskReport["importance"]> = {
  1: "high",
  2: "normal",
  3: "low",
};

const EMPTY_COUNTS = (): Record<EntryKind, number> => ({
  note: 0,
  decision: 0,
  dead_end: 0,
  question: 0,
  handoff: 0,
});

/**
 * How long a `doing` span may run before only its attended stretches count.
 *
 * A working day is the unit here: a span shorter than this closed with a
 * status event, and that closing is the evidence that somebody was there.
 * Nobody spends a day writing todox entries about the work while doing it,
 * so a day with no entry in it is a day of work, not a day of absence.
 */
export const WHOLE_SPAN_MS = 24 * 3_600_000;

/**
 * How far either side of a sign of life a longer span counts as attended.
 *
 * Symmetric, because the entry usually comes *after* the work it describes:
 * a handoff at 17:00 is what the four hours before it looked like. Four
 * hours is half a working day -- two signs of life a day cover the day, and
 * a session that set a task 'doing' and vanished is worth a morning, not a
 * month.
 */
export const ATTENDED_GRACE_MS = 4 * 3_600_000;

/** One stretch in `doing`, and the parts of it somebody was plausibly there for. */
export type DoingSpan = {
  start: number;
  end: number;
  /** Disjoint, ordered, inside [start, end). */
  attended: [number, number][];
};

/**
 * Replays a task's status transitions into its `doing` spans, and says of
 * each which parts count.
 *
 * The rule the whole report rests on. A span is counted whole while it is
 * shorter than a day (`WHOLE_SPAN_MS`). Past that, only the stretches around
 * signs of life count -- the moment it was set 'doing', every entry written
 * inside it, every repeated 'doing', and the status change that ended it --
 * each worth `ATTENDED_GRACE_MS` either side, clipped to the span, overlaps
 * merged. The rest is `discounted`: time the status column said was work and
 * nothing else in the log agrees with.
 *
 * Why a union rather than "start to the last entry": a thirty-day span with
 * one entry on day twenty would otherwise count twenty days, which is exactly
 * the shape that put 1,316 hours on one project in eighteen days. And why
 * the whole-span rule at all: without it, "09:00 doing, 17:00 done, nothing
 * logged between" -- an honest day -- would count as four hours.
 *
 * An open span ends at `until`, or at `closed_at` for a task whose closing
 * event was lost -- the task row and its event are two writes, and counting
 * a dangling 'doing' up to now once added a day to every report forever.
 */
export function doingSpans(
  task: Task,
  events: TaskEvent[],
  entries: Pick<Entry, "created_at">[],
  until = Date.now(),
): DoingSpan[] {
  const ordered = [...events].sort((a, b) => ms(a.at) - ms(b.at));
  const ceiling = task.closed_at ? Math.min(ms(task.closed_at), until) : until;
  const entryTimes = entries.map((e) => ms(e.created_at)).sort((a, b) => a - b);

  const spans: DoingSpan[] = [];
  let start: number | null = null;
  let signs: number[] = [];

  const close = (end: number, closedByEvent: boolean) => {
    if (start !== null && end > start) {
      const from = start;
      const inside = entryTimes.filter((t) => t >= from && t < end);
      const points = [...signs, ...inside, ...(closedByEvent ? [end] : [])];
      spans.push({ start: from, end, attended: attendedWithin(from, end, points) });
    }
    start = null;
  };

  for (const e of ordered) {
    const at = ms(e.at);
    if (e.to_status === "doing") {
      if (start === null) {
        start = at;
        signs = [at];
      } else signs.push(at);
    } else if (start !== null) close(at, true);
  }
  if (start !== null) close(ceiling, false);
  return spans;
}

/**
 * The stretches of [start, end) that count, given the moments somebody was
 * demonstrably there. Whole when the span is under a day; otherwise the
 * merged union of a grace window around each moment.
 */
function attendedWithin(start: number, end: number, points: number[]): [number, number][] {
  if (end - start < WHOLE_SPAN_MS) return [[start, end]];
  const windows = points
    .map((p): [number, number] => [
      Math.max(start, p - ATTENDED_GRACE_MS),
      Math.min(end, p + ATTENDED_GRACE_MS),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);

  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }
  return merged;
}

const spanLength = (s: DoingSpan) => s.end - s.start;
const attendedLength = (s: DoingSpan) => s.attended.reduce((n, [a, b]) => n + (b - a), 0);

/**
 * Reconstruct how long a task was actually being worked on by replaying its
 * status transitions -- see `doingSpans` for what "actually" means here.
 */
export function timingFor(
  task: Task,
  events: TaskEvent[],
  entries: Pick<Entry, "created_at">[],
  until = Date.now(),
): TaskTiming {
  const spans = doingSpans(task, events, entries, until);
  const active = spans.reduce((n, s) => n + attendedLength(s), 0);
  const whole = spans.reduce((n, s) => n + spanLength(s), 0);

  const ordered = [...events].sort((a, b) => ms(a.at) - ms(b.at));
  const first = ordered.find((e) => e.to_status === "doing");
  const closedAt = task.closed_at;

  return {
    started_at: first?.at ?? null,
    closed_at: closedAt,
    lead_ms: closedAt ? ms(closedAt) - ms(task.created_at) : null,
    active_ms: active,
    discounted_ms: whole - active,
    // Partial when the numbers cannot be trusted at face value: a backfilled
    // task has no real history, and one that closed without ever being `doing`
    // reports zero for work that plainly took time. A discount is the other
    // caveat and never sets this: it says the figure was cut, not that it is
    // a floor.
    partial: ordered.some((e) => e.actor === "backfill") || (!first && Boolean(closedAt)),
  };
}

function reportFor(
  task: Task,
  projectSlug: string,
  projectName: string,
  log: Entry[],
  events: TaskEvent[],
  period: Period,
): TaskReport {
  const counts = EMPTY_COUNTS();
  for (const e of log) counts[e.kind] += 1;

  // A question with an answer is not an open question. Computed from the task's
  // whole log rather than from the period, because the answer may have been
  // written long after the question and a report that reopens it sends somebody
  // to solve a solved problem.
  const answered = new Set(
    log.map((e) => e.answers_entry_id).filter((id): id is number => id != null),
  );

  const models = [
    ...new Set([...log, ...events].map((x) => x.model).filter((m): m is string => !!m)),
  ];
  const handoff = [...log].reverse().find((e) => e.kind === "handoff");

  return {
    id: task.id,
    title: task.title,
    body: task.body,
    project_slug: projectSlug,
    project_name: projectName,
    status: task.status,
    priority: task.priority,
    importance: IMPORTANCE[task.priority] ?? "normal",
    created_at: task.created_at,
    models,
    authors: [...new Set(log.map((e) => e.author))],
    entry_counts: counts,
    decisions: log.filter((e) => e.kind === "decision").map((e) => e.body),
    dead_ends: log.filter((e) => e.kind === "dead_end").map((e) => e.body),
    open_questions: log
      .filter((e) => e.kind === "question" && !answered.has(e.id))
      .map((e) => e.body),
    last_handoff: handoff?.body ?? null,
    ...timingFor(task, events, log),
    // Both figures, because they answer different questions and mixing them up
    // is what made the markdown report show line items summing to several
    // times its own header: `active_ms` is the task's whole life, this one is
    // only the part that falls inside the window being reported on.
    ...withinPeriodOf(doingSpans(task, events, log), period),
  };
}

export async function activityReport(
  userId: number,
  period: Period,
  opts: { projectId?: number } = {},
): Promise<ActivityReport> {
  const [projectRows, candidates] = await Promise.all([
    projectsRepo.list(userId, true),
    // Narrowed in the query. This filtered the result in JavaScript, so scoping
    // a report to one project reduced what came back and not what was read.
    tasksRepo.activeBetween(userId, period.from, period.to, opts.projectId),
  ]);

  const projects = new Map(projectRows.map((p) => [p.id, p]));
  const ids = candidates.map((t) => t.id);

  // Three queries total, whatever the window contains. Loading the log and the
  // events per task turned the monthly report into hundreds of round trips.
  const [logs, eventsByTask, periodEntries] = await Promise.all([
    entriesRepo.listByTasks(ids),
    eventsRepo.listByTasks(ids),
    entriesRepo.listByTasksBetween(ids, period.from, period.to),
  ]);

  const reports = candidates.map((task) => {
    const project = projects.get(task.project_id);
    return reportFor(
      task,
      project?.slug ?? "unknown",
      project?.name ?? "unknown",
      logs.get(task.id) ?? [],
      eventsByTask.get(task.id) ?? [],
      period,
    );
  });

  // `titleOf` used to be a linear scan of `reports` per entry, which is a
  // quadratic on a month with a few thousand entries in it.
  const titles = new Map(reports.map((r) => [r.id, r.title]));
  const titleOf = (taskId: number) => titles.get(taskId) ?? `#${taskId}`;
  // Same reason the title has a fallback: an entry can belong to a task the
  // window did not pick up. A section then has no task page to link to, which
  // is a missing link and not a broken one.
  const slugs = new Map(reports.map((r) => [r.id, r.project_slug]));
  const slugOf = (taskId: number) => slugs.get(taskId) ?? null;

  // Answered anywhere, not just inside the window: a question closed last month
  // is not an open question this week, and a report that says otherwise sends
  // somebody to re-answer it.
  const answered = new Set(
    [...logs.values()]
      .flat()
      .map((e) => e.answers_entry_id)
      .filter((id): id is number => id != null),
  );

  const pick = (kind: EntryKind): ReportEntry[] =>
    periodEntries
      .filter((e) => e.kind !== "question" || !answered.has(e.id))
      .filter((e) => e.kind === kind)
      .map((e) => ({
        task_id: e.task_id,
        task: titleOf(e.task_id),
        project_slug: slugOf(e.task_id),
        ...summarise(e.body),
        at: e.created_at,
      }));

  const created = reports.filter((r) => withinPeriod(r.created_at, period));
  const completed = reports.filter(
    (r) => r.status === "done" && withinPeriod(r.closed_at, period),
  );
  const dropped = reports.filter(
    (r) => r.status === "dropped" && withinPeriod(r.closed_at, period),
  );
  const isCompleted = new Set(completed.map((r) => r.id));
  const inProgress = reports.filter(
    (r) => OPEN_STATUSES.includes(r.status) && !isCompleted.has(r.id),
  );

  const activeInPeriod = (r: TaskReport) => r.active_ms_in_period;

  // Grouped in one pass each. These were nested filters -- a scan of every task
  // per project and of every entry per model -- which is fine for a day and
  // quadratic for a month.
  const perProject = new Map<string, TaskReport[]>();
  for (const r of reports) {
    const bucket = perProject.get(r.project_slug);
    if (bucket) bucket.push(r);
    else perProject.set(r.project_slug, [r]);
  }

  const byProject = [...perProject.entries()]
    .map(([slug, rows]) => ({
      slug,
      name: rows[0]?.project_name ?? slug,
      created: rows.filter((r) => withinPeriod(r.created_at, period)).length,
      completed: rows.filter(
        (r) => r.status === "done" && withinPeriod(r.closed_at, period),
      ).length,
      touched: rows.length,
      active_ms: rows.reduce((n, r) => n + activeInPeriod(r), 0),
    }))
    .sort((a, b) => b.active_ms - a.active_ms || b.touched - a.touched);

  const perModel = new Map<string, { entries: number; tasks: Set<number> }>();
  for (const e of periodEntries) {
    if (!e.model) continue;
    const bucket = perModel.get(e.model) ?? { entries: 0, tasks: new Set<number>() };
    bucket.entries += 1;
    bucket.tasks.add(e.task_id);
    perModel.set(e.model, bucket);
  }

  const byModel = [...perModel.entries()]
    .map(([model, b]) => ({ model, entries: b.entries, tasks: b.tasks.size }))
    .sort((a, b) => b.entries - a.entries);

  return {
    period,
    generated_at: new Date().toISOString(),
    totals: {
      created: created.length,
      completed: completed.length,
      dropped: dropped.length,
      touched: reports.length,
      entries: periodEntries.length,
      decisions: periodEntries.filter((e) => e.kind === "decision").length,
      dead_ends: periodEntries.filter((e) => e.kind === "dead_end").length,
      questions: periodEntries.filter((e) => e.kind === "question").length,
      active_ms: reports.reduce((n, r) => n + activeInPeriod(r), 0),
      // Counted from `partial` rather than from `active_ms === 0`, because
      // those are different facts: a task can genuinely have spent no time in
      // the window, and saying "not measured" about it would be its own small
      // lie in the other direction.
      unmeasured: reports.filter((r) => r.partial).length,
      discounted_ms: reports.reduce((n, r) => n + r.discounted_ms_in_period, 0),
    },
    by_project: byProject,
    by_model: byModel,
    completed,
    in_progress: inProgress,
    decisions: pick("decision"),
    dead_ends: pick("dead_end"),
    open_questions: pick("question"),
  };
}

/**
 * Time in `doing` clipped to the reporting window, so a task started last
 * month doesn't dump all its hours into today's summary -- and the part of
 * that clipped time which was discounted, so the window's headline can say
 * how much it left out.
 *
 * The spans come from `doingSpans`, so a dangling `doing` on a closed task
 * already stops at `closed_at`. Without that the phantom interval runs to
 * now, which means it overlaps *every* window and quietly adds a full day to
 * each one.
 */
export function withinPeriodOf(
  spans: DoingSpan[],
  period: Period,
): { active_ms_in_period: number; discounted_ms_in_period: number } {
  const from = ms(period.from);
  const to = ms(period.to);
  let active = 0;
  let whole = 0;
  for (const s of spans) {
    whole += overlap(s.start, s.end, from, to);
    for (const [a, b] of s.attended) active += overlap(a, b, from, to);
  }
  return { active_ms_in_period: active, discounted_ms_in_period: whole - active };
}

const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
