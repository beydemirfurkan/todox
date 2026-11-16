import type { Status } from "@/lib/constants";

/**
 * What the project board's address says, and what it falls back to.
 *
 * The board is one page whose side panel shows a task, the standing notes or
 * the closed work. Which of those, and which task, lives in the query string
 * rather than in client state: the choice survives a refresh, can be sent to
 * somebody, and a status change -- a Server Action that re-renders the page --
 * comes back to the same panel without anything having to remember it.
 */

export const PANEL_VIEWS = ["task", "notes", "closed"] as const;
export type PanelView = (typeof PANEL_VIEWS)[number];

type Asked = string | string[] | undefined;

const firstOf = (asked: Asked) => (Array.isArray(asked) ? asked[0] : asked);

/** The asked-for view, or the task view: an unknown value is not an error page. */
export function panelView(asked: Asked): PanelView {
  const want = firstOf(asked);
  return PANEL_VIEWS.find((view) => view === want) ?? "task";
}

/**
 * The task the panel shows.
 *
 * An id from the address only counts when it is a task of this project --
 * `known` is that set -- so a foreign or deleted id falls through to the same
 * default a bare address gets instead of naming a row the caller cannot see.
 * The fallbacks are tried in order and may be undefined (a project with no
 * handoff has no "where it left off"); null means the project has no tasks.
 */
export function selectTaskId(
  asked: Asked,
  known: ReadonlySet<number>,
  fallbacks: readonly (number | undefined)[],
): number | null {
  const want = Number(firstOf(asked));
  if (known.has(want)) return want;
  return fallbacks.find((id): id is number => id !== undefined && known.has(id)) ?? null;
}

/** The board's address for a panel state, with the defaults left out of it. */
export function boardHref(slug: string, panel: { task: number | null; view: PanelView }): string {
  const query = new URLSearchParams();
  if (panel.task !== null) query.set("task", String(panel.task));
  if (panel.view !== "task") query.set("view", panel.view);
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
