import type { Status } from "@/lib/constants";

/**
 * How the task list on a project page is grouped, ordered and cut.
 *
 * Lifted out of the page so it can be asserted directly: it is the part with
 * answers that are right or wrong, and the 600 lines around it are markup.
 */

/**
 * How many rows the queued and the closed group will render.
 *
 * Every list on this page used to be unbounded except the closed one, which
 * was silently cut at twenty -- so a project with more than that quietly
 * looked smaller than it was. A ceiling is fine; not saying so is not, which
 * is why `paginate` returns what it left out rather than just the slice.
 *
 * Work in flight has no ceiling: it is the group the page exists for, and a
 * project with sixty tasks 'doing' has a different problem than a long page.
 */
export const QUEUED_SHOWN = 30;
export const CLOSED_SHOWN = 10;

/** Work first, and inside that the urgent first. Closed work sorts last. */
export const RANK: Record<Status, number> = {
  doing: 0,
  blocked: 1,
  todo: 2,
  done: 3,
  dropped: 4,
};

/**
 * The views a task can be asked about.
 *
 * Deliberately not wider than that. An earlier version admitted `"all"`, which
 * nothing produced and `matchesFilter` had no branch for -- it fell through to
 * comparing a status against the string "all", so adding the pill would have
 * shown an empty list. Narrow enough that the compiler catches the next one.
 */
export type FilterId = "open" | Status;

const CLOSED: readonly Status[] = ["done", "dropped"];

export const isClosed = (status: Status) => CLOSED.includes(status);

/** `done` is the "done or dropped" group, so it covers both. */
export function matchesFilter(task: { status: Status }, filter: FilterId): boolean {
  if (filter === "open") return !isClosed(task.status);
  if (filter === "done") return isClosed(task.status);
  return task.status === filter;
}

/** Status band, then priority, then most recently touched. */
export function compareTasks(
  a: { status: Status; priority: number; updated_at: string },
  b: { status: Status; priority: number; updated_at: string },
): number {
  return (
    RANK[a.status] - RANK[b.status] ||
    a.priority - b.priority ||
    b.updated_at.localeCompare(a.updated_at)
  );
}

/**
 * Newest closed first.
 *
 * `closed_at` is null on rows closed before the column existed, and a null
 * that sorted to one end would put the oldest history at the top of the
 * group. `updated_at` stands in for it: on those rows the close was the last
 * thing that happened.
 */
export function compareClosed(
  a: { closed_at: string | null; updated_at: string },
  b: { closed_at: string | null; updated_at: string },
): number {
  return (b.closed_at ?? b.updated_at).localeCompare(a.closed_at ?? a.updated_at);
}

/** The rows a view renders, and the number it is not showing. */
export function paginate<T>(rows: readonly T[], size: number): { shown: T[]; omitted: number } {
  return { shown: rows.slice(0, size), omitted: Math.max(0, rows.length - size) };
}

export type TaskGroups<T> = {
  /** doing then blocked, urgent first, uncapped. */
  inFlight: T[];
  queued: { shown: T[]; omitted: number; total: number };
  closed: { shown: T[]; omitted: number; total: number };
  counts: { doing: number; blocked: number; todo: number; closed: number };
};

/**
 * The three groups the page renders, from every task in the project.
 *
 * Every status lands in exactly one group, which is the property the old
 * filter pills had to be tested for and the groups get by construction: in
 * flight is doing and blocked, queued is todo, closed is done and dropped.
 */
export function groupTasks<
  T extends { status: Status; priority: number; updated_at: string; closed_at: string | null },
>(all: readonly T[]): TaskGroups<T> {
  const inFlight = all
    .filter((t) => matchesFilter(t, "doing") || matchesFilter(t, "blocked"))
    .sort(compareTasks);
  const todo = all.filter((t) => matchesFilter(t, "todo")).sort(compareTasks);
  const done = all.filter((t) => matchesFilter(t, "done")).sort(compareClosed);
  return {
    inFlight,
    queued: { ...paginate(todo, QUEUED_SHOWN), total: todo.length },
    closed: { ...paginate(done, CLOSED_SHOWN), total: done.length },
    counts: {
      doing: inFlight.filter((t) => t.status === "doing").length,
      blocked: inFlight.filter((t) => t.status === "blocked").length,
      todo: todo.length,
      closed: done.length,
    },
  };
}
