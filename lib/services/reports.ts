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
  /** Time actually spent in `doing`. What the developer means. */
  active_ms: number;
  /** True when the task predates event tracking, so active_ms is a floor. */
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
  decisions: { task_id: number; task: string; body: string; at: string }[];
  dead_ends: { task_id: number; task: string; body: string; at: string }[];
  open_questions: { task_id: number; task: string; body: string; at: string }[];
};

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
 * Reconstruct how long a task was actually being worked on by replaying its
 * status transitions. An open `doing` interval is counted up to `until`.
 */
export function timingFor(
  task: Task,
  events: TaskEvent[],
  until = Date.now(),
): TaskTiming {
  const ordered = [...events].sort((a, b) => ms(a.at) - ms(b.at));

  let active = 0;
  let doingSince: number | null = null;
  let startedAt: string | null = null;

  for (const e of ordered) {
    if (e.to_status === "doing" && doingSince === null) {
      doingSince = ms(e.at);
      startedAt ??= e.at;
    } else if (e.to_status !== "doing" && doingSince !== null) {
      active += ms(e.at) - doingSince;
      doingSince = null;
    }
  }
  if (doingSince !== null) active += until - doingSince;

  const closedAt = task.closed_at;
  return {
    started_at: startedAt,
    closed_at: closedAt,
    lead_ms: closedAt ? ms(closedAt) - ms(task.created_at) : null,
    active_ms: active,
    // A backfilled task has no real transition history before today.
    partial: ordered.some((e) => e.actor === "backfill"),
  };
}

function reportFor(
  task: Task,
  projectSlug: string,
  projectName: string,
  log: Entry[],
  events: TaskEvent[],
): TaskReport {
  const counts = EMPTY_COUNTS();
  for (const e of log) counts[e.kind] += 1;

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
    open_questions: log.filter((e) => e.kind === "question").map((e) => e.body),
    last_handoff: handoff?.body ?? null,
    ...timingFor(task, events),
  };
}

export async function activityReport(
  userId: number,
  period: Period,
  opts: { projectId?: number } = {},
): Promise<ActivityReport> {
  const [projectRows, candidatesAll] = await Promise.all([
    projectsRepo.list(userId, true),
    tasksRepo.activeBetween(userId, period.from, period.to),
  ]);

  const projects = new Map(projectRows.map((p) => [p.id, p]));
  const candidates = candidatesAll.filter((t) =>
    opts.projectId ? t.project_id === opts.projectId : true,
  );
  const ids = candidates.map((t) => t.id);

  // Three queries total, whatever the window contains. Loading the log and the
  // events per task turned the monthly report into hundreds of round trips.
  const [logs, eventsByTask, periodEntriesAll] = await Promise.all([
    entriesRepo.listByTasks(ids),
    eventsRepo.listByTasks(ids),
    entriesRepo.listBetween(period.from, period.to),
  ]);

  const reports = candidates.map((task) => {
    const project = projects.get(task.project_id);
    return reportFor(
      task,
      project?.slug ?? "unknown",
      project?.name ?? "unknown",
      logs.get(task.id) ?? [],
      eventsByTask.get(task.id) ?? [],
    );
  });

  const known = new Set(ids);
  const periodEntries = periodEntriesAll.filter((e) => known.has(e.task_id));

  const titleOf = (taskId: number) =>
    reports.find((r) => r.id === taskId)?.title ?? `#${taskId}`;

  const pick = (kind: EntryKind) =>
    periodEntries
      .filter((e) => e.kind === kind)
      .map((e) => ({
        task_id: e.task_id,
        task: titleOf(e.task_id),
        body: e.body,
        at: e.created_at,
      }));

  const created = reports.filter((r) => withinPeriod(r.created_at, period));
  const completed = reports.filter(
    (r) => r.status === "done" && withinPeriod(r.closed_at, period),
  );
  const dropped = reports.filter(
    (r) => r.status === "dropped" && withinPeriod(r.closed_at, period),
  );
  const inProgress = reports.filter(
    (r) => OPEN_STATUSES.includes(r.status) && !completed.includes(r),
  );

  const activeInPeriod = (r: TaskReport) =>
    activeMsWithin(eventsByTask.get(r.id) ?? [], period);

  const byProject = [...new Set(reports.map((r) => r.project_slug))]
    .map((slug) => {
      const rows = reports.filter((r) => r.project_slug === slug);
      return {
        slug,
        name: rows[0]?.project_name ?? slug,
        created: rows.filter((r) => withinPeriod(r.created_at, period)).length,
        completed: rows.filter(
          (r) => r.status === "done" && withinPeriod(r.closed_at, period),
        ).length,
        touched: rows.length,
        active_ms: rows.reduce((n, r) => n + activeInPeriod(r), 0),
      };
    })
    .sort((a, b) => b.active_ms - a.active_ms || b.touched - a.touched);

  const byModel = [
    ...new Set(periodEntries.map((e) => e.model).filter((m): m is string => !!m)),
  ]
    .map((model) => ({
      model,
      entries: periodEntries.filter((e) => e.model === model).length,
      tasks: new Set(periodEntries.filter((e) => e.model === model).map((e) => e.task_id))
        .size,
    }))
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
 * month doesn't dump all its hours into today's summary.
 */
function activeMsWithin(events: TaskEvent[], period: Period): number {
  const from = ms(period.from);
  const to = ms(period.to);

  let total = 0;
  let doingSince: number | null = null;
  for (const e of [...events].sort((a, b) => ms(a.at) - ms(b.at))) {
    if (e.to_status === "doing" && doingSince === null) doingSince = ms(e.at);
    else if (e.to_status !== "doing" && doingSince !== null) {
      total += overlap(doingSince, ms(e.at), from, to);
      doingSince = null;
    }
  }
  if (doingSince !== null) total += overlap(doingSince, Date.now(), from, to);
  return total;
}

const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
