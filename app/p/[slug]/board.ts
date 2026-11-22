import type { Status } from "@/lib/constants";

/**
 * What a project page's address says, and what it falls back to.
 *
 * Two choices live in the query string rather than in client state -- which
 * section (the tasks or the standing notes) and how the tasks are laid out (a
 * list or the board) -- so the choice survives a refresh, can be sent to
 * somebody, and a status change, a Server Action that re-renders the page,
 * comes back to the same view without anything having to remember it.
 */

export const PROJECT_TABS = ["tasks", "notes"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export const TASK_VIEWS = ["list", "board"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

type Asked = string | string[] | undefined;

const firstOf = (asked: Asked) => (Array.isArray(asked) ? asked[0] : asked);

/** The asked-for section, or the tasks: an unknown value is not an error page. */
export function projectTab(asked: Asked): ProjectTab {
  const want = firstOf(asked);
  return PROJECT_TABS.find((tab) => tab === want) ?? "tasks";
}

/** The asked-for layout, or the list. */
export function taskView(asked: Asked): TaskView {
  const want = firstOf(asked);
  return TASK_VIEWS.find((view) => view === want) ?? "list";
}

/** The project's address for a section and a layout, defaults left out. */
export function projectHref(slug: string, state: { tab: ProjectTab; view: TaskView }): string {
  const query = new URLSearchParams();
  if (state.tab !== "tasks") query.set("tab", state.tab);
  if (state.view !== "list") query.set("view", state.view);
  const search = query.toString();
  return search ? `/p/${slug}?${search}` : `/p/${slug}`;
}

/** The same threshold `session_status` uses for a stale 'doing'. */
export const QUIET_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * Whole days a task has sat in 'doing' with nothing written, once that is long
 * enough to say out loud; null otherwise.
 *
 * Only 'doing' can be quiet. A queued task that nobody has touched for a month
 * is a queue working as intended; one that claims to be in progress and has
 * not moved is the log going stale, which is the thing this product exists to
 * make visible.
 */
export function quietDays(task: { status: Status; updated_at: string }, now: Date): number | null {
  if (task.status !== "doing") return null;
  const days = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / DAY_MS);
  return days >= QUIET_AFTER_DAYS ? days : null;
}

/** Entry ids only grow, so the highest one is the most recent. */
export function newest<T extends { id: number }>(rows: Iterable<T>): T | undefined {
  let latest: T | undefined;
  for (const row of rows) if (!latest || row.id > latest.id) latest = row;
  return latest;
}
