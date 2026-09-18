import * as entriesRepo from "../repositories/entries";
import * as eventsRepo from "../repositories/events";
import * as tasksRepo from "../repositories/tasks";
import type { Status } from "../constants";
import type { Project } from "../types";
import { lacksHandoffSince, STALE_DOING_DAYS } from "./briefing";

/**
 * What a session still owes before it stops.
 *
 * The wrap-up contract in the instructions asks for three things on "every
 * task you touched", and measured on one account over eighteen days the
 * agents did not keep it: 78 tasks opened, 29 closed, and tasks left 'doing'
 * for weeks that turned the activity report's hours into fiction. The rule
 * was clear; what was missing was the list. An agent at the end of a long
 * session does not remember which tasks it moved, and a prompt cannot tell
 * it. This can: the two tables that record activity carry the user the
 * token resolved to, so "what did I touch, and did I write it up" is a
 * query.
 *
 * Two lists. `yours` is what this session did and has not closed out;
 * `stale` is what an earlier one left 'doing' and walked away from. Both
 * are small on purpose -- ids, titles, dates, one boolean -- because this is
 * read at the moment the habit gets dropped, and a payload that has to be
 * studied is a payload that gets skipped.
 *
 * A service because it reads three tables to answer one question, and
 * repositories never call each other.
 */

/** How far back "this session" reaches when the caller does not say. */
export const DEFAULT_WINDOW_HOURS = 12;

/** More than a project's live edge would ever hold; a cap, not a page. */
const TOUCHED_LIMIT = 50;

export type SessionStatus = {
  project: { slug: string; name: string };
  window_hours: number;
  /** Tasks this user changed or wrote on inside the window, any status. */
  yours: {
    id: number;
    title: string;
    status: Status;
    last_activity_at: string;
    /** No handoff since the last thing this user did here that was not one. */
    handoff_missing: boolean;
  }[];
  /** 'doing' with nothing logged for STALE_DOING_DAYS or more -- by anyone. */
  stale: {
    id: number;
    title: string;
    doing_since: string;
    idle_days: number;
  }[];
  /** What to do about the two lists, said only when there is something. */
  hint: string;
};

export async function sessionStatus(
  userId: number,
  project: Project,
  opts: { hours?: number } = {},
): Promise<SessionStatus> {
  const hours = opts.hours ?? DEFAULT_WINDOW_HOURS;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const [touched, doing] = await Promise.all([
    tasksRepo.touchedByUserSince(project.id, userId, since, TOUCHED_LIMIT),
    tasksRepo.pageByProject(project.id, "doing", TOUCHED_LIMIT),
  ]);
  const staleCandidates = doing.rows.filter((t) => ageDays(t.updated_at) >= STALE_DOING_DAYS);

  const ids = [...new Set([...touched, ...staleCandidates].map((t) => t.id))];
  const [events, entries] = await Promise.all([
    eventsRepo.activityByTasks(ids, userId),
    entriesRepo.activityByTasks(ids, userId),
  ]);

  const yours = touched.map((t) => {
    const ev = events.get(t.id);
    const en = entries.get(t.id);
    // The moment a handoff is owed from: the last thing this user did on the
    // task that was not itself a handoff. Either table may hold it.
    const owedFrom = latest(ev?.last_by_user_at, en?.last_non_handoff_by_user_at);
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      last_activity_at: latest(ev?.last_by_user_at, en?.last_by_user_at) ?? t.updated_at,
      handoff_missing:
        owedFrom !== null && lacksHandoffSince(en?.last_handoff_at ?? null, owedFrom),
    };
  });

  const stale = staleCandidates.map((t) => ({
    id: t.id,
    title: t.title,
    doing_since: events.get(t.id)?.latest_at ?? t.updated_at,
    idle_days: Math.floor(ageDays(t.updated_at)),
  }));

  return {
    project: { slug: project.slug, name: project.name },
    window_hours: hours,
    yours,
    stale,
    hint: hint(yours, stale),
  };
}

const ageDays = (iso: string): number => (Date.now() - Date.parse(iso)) / 86_400_000;

/** The later of two instants, when either may be missing. */
function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * The ask, as ids rather than counts, so it can be acted on without matching
 * the lists up again. Empty when nothing is owed: a sentence that appears on
 * every call is one an agent learns to skip.
 */
function hint(yours: SessionStatus["yours"], stale: SessionStatus["stale"]): string {
  const ids = (list: { id: number }[]) => list.map((t) => `#${t.id}`).join(", ");
  const lines: string[] = [];
  const stillDoing = yours.filter((t) => t.status === "doing");
  if (stillDoing.length)
    lines.push(
      `Still 'doing' from this session: ${ids(stillDoing)}. update_task each to its ` +
        `true status -- 'done', or back to 'todo' or 'blocked' if not finished.`,
    );
  const owed = yours.filter((t) => t.handoff_missing);
  if (owed.length)
    lines.push(
      `No handoff since you last touched: ${ids(owed)}. log_entry(kind:'handoff') on ` +
        `each -- state, next step, what to watch.`,
    );
  if (stale.length)
    lines.push(
      `'doing' for ${STALE_DOING_DAYS}+ days with nothing logged: ${ids(stale)}. ` +
        `Either continue one, or set it back to 'todo' or 'blocked' so the list stays true.`,
    );
  return lines.join(" ");
}
