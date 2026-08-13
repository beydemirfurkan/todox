import type { Status } from "@/lib/constants";

/**
 * How the task list on a project page is filtered, ordered and cut.
 *
 * Lifted out of the page so it can be asserted directly: it is the part with
 * answers that are right or wrong, and the 600 lines around it are markup.
 */

/**
 * How many rows one view will render.
 *
 * Every list on this page used to be unbounded except the closed one, which
 * was silently cut at twenty -- so a project with more than that quietly
 * looked smaller than it was. A ceiling is fine; not saying so is not, which
 * is why `paginate` returns what it left out rather than just the slice.
 */
export const PAGE = 60;

/** Work first, and inside that the urgent first. Closed work sorts last. */
export const RANK: Record<Status, number> = {
  doing: 0,
  blocked: 1,
  todo: 2,
  done: 3,
  dropped: 4,
};

/**
 * The filters the page offers.
 *
 * Deliberately not wider than that. An earlier version admitted `"all"`, which
 * nothing produced and `matchesFilter` had no branch for -- it fell through to
 * comparing a status against the string "all", so adding the pill would have
 * shown an empty list. Narrow enough that the compiler catches the next one.
 */
export type FilterId = "open" | Status;

const CLOSED: readonly Status[] = ["done", "dropped"];

export const isClosed = (status: Status) => CLOSED.includes(status);

/**
 * The filter a query string asked for, if it is one that exists.
 *
 * `?s=` is caller-controlled and arrives as a string or a repeated string;
 * anything unrecognised falls back to the default view rather than to an empty
 * one.
 */
export function resolveFilter(
  asked: string | string[] | undefined,
  available: readonly FilterId[],
): FilterId {
  const first = Array.isArray(asked) ? asked[0] : asked;
  return available.some((id) => id === first) ? (first as FilterId) : "open";
}

/** `done` is the "done or dropped" pill, so it covers both. */
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

/** The rows a view renders, and the number it is not showing. */
export function paginate<T>(rows: readonly T[], size = PAGE): { shown: T[]; omitted: number } {
  return { shown: rows.slice(0, size), omitted: Math.max(0, rows.length - size) };
}
