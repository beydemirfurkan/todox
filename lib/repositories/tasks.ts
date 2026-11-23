import {
  CLOSED_STATUSES,
  DEFAULT_PRIORITY,
  OPEN_STATUSES,
  isClosedStatus,
  type Status,
} from "../constants";
import { all, groupBy, one, run, runStmt, setClause, type Statement } from "../db/client";
import type { Task } from "../types";
import { now } from "../util/time";

/**
 * `"closed"` is the complement of `"open"` and exists for the same reason: a
 * caller that wants finished work had to ask for `"all"` and split the answer
 * in JavaScript, which on the public share page meant reading every task in a
 * project to print forty of them.
 */
export type StatusFilter = Status | "open" | "closed" | "all";

export type NewTask = {
  project_id: number;
  title: string;
  body?: string | null;
  status?: Status;
  priority?: number;
  /** A person handing the new task straight to their agent. */
  requested_by?: number | null;
};

export type TaskPatch = Partial<
  Pick<Task, "title" | "body" | "status" | "priority" | "closed_at">
>;

/** One grouped read for the project dashboard, never one query per card. */
export async function latestUpdatedByProjects(
  projectIds: number[],
): Promise<Map<number, string>> {
  if (!projectIds.length) return new Map();
  const rows = await all<{ project_id: number; updated_at: string }>(
    `SELECT project_id, MAX(updated_at) AS updated_at
       FROM tasks WHERE project_id IN (${projectIds.map(() => "?").join(",")})
      GROUP BY project_id`,
    projectIds,
  );
  return new Map(rows.map((row) => [row.project_id, row.updated_at]));
}

/** The only columns `update` will write. See `setClause` for why this exists. */
const COLUMNS = ["title", "body", "status", "priority", "closed_at"] as const;

/**
 * Every task of a project for the board, without bodies.
 *
 * The board prints titles, statuses and ids; it never shows a body. Reading
 * `*` shipped every brief ever written -- closed tasks included -- from the
 * database to throw it away. `body` comes back null, so nothing can mistake
 * this for a full row and print it.
 */
export const listForBoard = (projectId: number) =>
  all<Task>(
    `SELECT id, project_id, title, NULL::text AS body, status, priority,
            created_at, updated_at, closed_at, requested_at, requested_by
       FROM tasks WHERE project_id = ?
      ORDER BY (status IN ('done','dropped')), priority, updated_at DESC`,
    [projectId],
  );

export function listByProject(projectId: number, status: StatusFilter = "open") {
  if (status === "all")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
       ORDER BY (status IN ('done','dropped')), priority, updated_at DESC`,
      [projectId],
    );

  if (status === "open" || status === "closed") {
    const set = status === "open" ? OPEN_STATUSES : CLOSED_STATUSES;
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
         AND status IN (${set.map(() => "?").join(",")})
       ORDER BY priority, updated_at DESC`,
      [projectId, ...set],
    );
  }

  return all<Task>(
    "SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY priority, updated_at DESC",
    [projectId, status],
  );
}

/**
 * The same list, cut in SQL, for the callers that only ever wanted the top of
 * it.
 *
 * `briefing` and `list_tasks` both fetched every open task and then sliced the
 * array. That reads the whole set and sorts it to hand back fifty rows -- and
 * it is the first query of every session. Measured on one project with 20,500
 * tasks, 12,300 of them open: 33.5ms to fetch and sort them all, against
 * 0.16ms for the same fifty once the ceiling and `idx_tasks_project_rank` are
 * both in play. The index alone changes nothing, because without a `LIMIT`
 * every matching row has to be read anyway; the two only pay together.
 *
 * Two round trips rather than one, because the count is what lets the caller
 * say how many it left out, and `count(*) OVER ()` would walk the whole set
 * again and give the ceiling back. The count is an index scan and costs a
 * fraction of the sort it replaces.
 *
 * Not for the project page or a share link: those filter and re-order the full
 * set in JavaScript, so a cut here would quietly change which tasks the
 * filters can see.
 */
export async function pageByProject(
  projectId: number,
  status: StatusFilter,
  limit: number,
): Promise<{ rows: Task[]; total: number }> {
  const [rows, total] = await Promise.all([
    limitedByProject(projectId, status, limit),
    countByProject(projectId, status),
  ]);
  return { rows, total };
}

/**
 * The 'doing' tasks nobody has touched since `before`, oldest first, with how
 * many there are in all.
 *
 * Its own query because the lists the stale check used to read were cut by
 * priority and newest first -- fifty rows -- so the oldest 'doing' tasks, the
 * ones the check exists for, were the first thing the cut removed. One account
 * had 54 of them on 2026-10-16.
 */
export async function staleDoing(
  projectId: number,
  before: string,
  limit: number,
): Promise<{ rows: Task[]; total: number }> {
  const [rows, count] = await Promise.all([
    all<Task>(
      `SELECT * FROM tasks WHERE project_id = ? AND status = 'doing' AND updated_at < ?
       ORDER BY updated_at LIMIT ?`,
      [projectId, before, limit],
    ),
    one<{ n: string }>(
      "SELECT count(*) AS n FROM tasks WHERE project_id = ? AND status = 'doing' AND updated_at < ?",
      [projectId, before],
    ),
  ]);
  return { rows, total: Number(count?.n ?? 0) };
}

function limitedByProject(projectId: number, status: StatusFilter, limit: number) {
  if (status === "all")
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
       ORDER BY (status IN ('done','dropped')), priority, updated_at DESC
       LIMIT ?`,
      [projectId, limit],
    );

  if (status === "open" || status === "closed") {
    const set = status === "open" ? OPEN_STATUSES : CLOSED_STATUSES;
    return all<Task>(
      `SELECT * FROM tasks WHERE project_id = ?
         AND status IN (${set.map(() => "?").join(",")})
       ORDER BY priority, updated_at DESC
       LIMIT ?`,
      [projectId, ...set, limit],
    );
  }

  return all<Task>(
    `SELECT * FROM tasks WHERE project_id = ? AND status = ?
     ORDER BY priority, updated_at DESC LIMIT ?`,
    [projectId, status, limit],
  );
}

async function countByProject(projectId: number, status: StatusFilter): Promise<number> {
  const row =
    status === "all"
      ? await one<{ n: string }>("SELECT count(*) AS n FROM tasks WHERE project_id = ?", [
          projectId,
        ])
      : status === "open" || status === "closed"
        ? await one<{ n: string }>(
            `SELECT count(*) AS n FROM tasks WHERE project_id = ?
               AND status IN (${(status === "open" ? OPEN_STATUSES : CLOSED_STATUSES)
                 .map(() => "?")
                 .join(",")})`,
            [projectId, ...(status === "open" ? OPEN_STATUSES : CLOSED_STATUSES)],
          )
        : await one<{ n: string }>(
            "SELECT count(*) AS n FROM tasks WHERE project_id = ? AND status = ?",
            [projectId, status],
          );
  // `count(*)` arrives as a string: it is bigint, and the driver will not
  // narrow one to a JS number on its own.
  return Number(row?.n ?? 0);
}

export const byId = (id: number) => one<Task>("SELECT * FROM tasks WHERE id = ?", [id]);

/** One task's brief, for a view that already holds the rest of the row. */
export const bodyOf = async (id: number): Promise<string | null> =>
  (await one<{ body: string | null }>("SELECT body FROM tasks WHERE id = ?", [id]))?.body ?? null;

/** The same read for a handful of ids, so a list does not become a round trip
 *  each. Order follows the ids given, because the caller has already decided
 *  what order means here. */
export async function byIds(ids: number[]): Promise<Task[]> {
  if (!ids.length) return [];
  const rows = await all<Task>(
    `SELECT * FROM tasks WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const found = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => found.get(id)).filter((t): t is Task => Boolean(t));
}

/**
 * Everything created, closed or touched inside a window -- the report's raw input.
 *
 * `>= from AND < to`, never `BETWEEN`. `resolvePeriod` hands back a half-open
 * window whose `to` is the first instant *outside* it, and yesterday's `to` is
 * today's `from`; `BETWEEN` includes both ends, so a row written exactly on a
 * midnight boundary was counted in both days' reports. The window was made
 * half-open to fix precisely that -- see the note in `lib/util/time.ts` -- and
 * these four comparisons were what the fix never reached.
 *
 * `projectId` narrows in SQL. The report used to take every task the account
 * touched in the window and keep the matching ones in JavaScript, so asking for
 * one project's report cost exactly what asking for all of them did -- on a
 * four-way join with no LIMIT, which is the expensive read here.
 */
export const activeBetween = (
  userId: number,
  from: string,
  to: string,
  projectId?: number,
) =>
  all<Task>(
    // EXISTS rather than two LEFT JOINs under a DISTINCT: the joins produced a
    // row per entry times per event, and DISTINCT then compared every one of
    // them whole, bodies included. Each EXISTS stops at its first match.
    `SELECT t.* FROM tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)
        ${projectId === undefined ? "" : "AND t.project_id = ?"}
        AND ((t.created_at >= ? AND t.created_at < ?)
         OR (t.closed_at   >= ? AND t.closed_at  < ?)
         OR EXISTS (SELECT 1 FROM entries e
                     WHERE e.task_id = t.id AND e.created_at >= ? AND e.created_at < ?)
         OR EXISTS (SELECT 1 FROM task_events v
                     WHERE v.task_id = t.id AND v.at >= ? AND v.at < ?))
     ORDER BY t.updated_at DESC`,
    [
      userId,
      userId,
      ...(projectId === undefined ? [] : [projectId]),
      from,
      to,
      from,
      to,
      from,
      to,
      from,
      to,
    ],
  );

/**
 * The tasks one user has left a status change or an entry on since `since`,
 * inside one project -- what `session_status` calls "yours". Any status: a
 * task moved to 'done' an hour ago is owed a handoff as much as one still
 * 'doing', and BASE asks for one on every task touched.
 *
 * `user_id` rather than `actor`: `actor` is free text a client chooses, and
 * two agents on one account share it. The column that says who is the one
 * the token resolved. Rows from before it existed have null and count for
 * nobody, which is right -- nothing this session did is that old.
 */
export const touchedByUserSince = (
  projectId: number,
  userId: number,
  since: string,
  limit: number,
) =>
  all<Task>(
    `SELECT DISTINCT t.* FROM tasks t
     LEFT JOIN entries e     ON e.task_id = t.id AND e.user_id = ? AND e.created_at >= ?
     LEFT JOIN task_events v ON v.task_id = t.id AND v.user_id = ? AND v.at         >= ?
      WHERE t.project_id = ?
        AND (e.id IS NOT NULL OR v.id IS NOT NULL)
     ORDER BY t.updated_at DESC
     LIMIT ?`,
    [userId, since, userId, since, projectId, limit],
  );

/**
 * Creates the task and its opening event in one statement.
 *
 * This is the one place a repository writes another module's table, and the
 * driver is the reason: it takes a list of prepared queries with no JavaScript
 * between them, so a second statement cannot use the id the first returned.
 * Two round trips would leave a task whose status was never recorded whenever
 * the second one dropped -- and `timingFor` replays those events to produce
 * every duration in every report. A CTE is the only way to make it atomic.
 */
export async function create(
  input: NewTask & { actor?: string; model?: string | null; user_id?: number | null },
): Promise<Task> {
  const ts = now();
  const status = input.status ?? "todo";
  // A task may open already closed -- `create_task` takes a status, and an
  // agent recording work it has just finished passes `done`. Deriving the
  // column here is safe in a way it is not in `update`: there is no previous
  // status to preserve. Left null, the task was missing from the closed side
  // of every report, so it counted as opened and never as finished.
  const closedAt = isClosedStatus(status) ? ts : null;
  const row = await one<Task>(
    `WITH t AS (
       INSERT INTO tasks (project_id, title, body, status, priority, created_at, updated_at, closed_at,
                          requested_at, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *
     ), e AS (
       INSERT INTO task_events (task_id, from_status, to_status, at, actor, model, user_id)
       SELECT t.id, NULL, t.status, ?, ?, ?, ? FROM t
     )
     SELECT * FROM t`,
    [
      input.project_id,
      input.title,
      input.body ?? null,
      status,
      input.priority ?? DEFAULT_PRIORITY,
      ts,
      ts,
      closedAt,
      input.requested_by ? ts : null,
      input.requested_by ?? null,
      ts,
      input.actor ?? "agent",
      input.model ?? null,
      input.user_id ?? null,
    ],
  );
  return row!;
}

/**
 * The `UPDATE` on its own, for a caller that has to run it beside another
 * table's write in one transaction. `update` is the same statement executed by
 * itself; neither builds its `SET` clause by hand.
 */
export function updateStmt(id: number, patch: TaskPatch) {
  const set = setClause(patch, COLUMNS);
  if (!set.sql) return undefined;
  return {
    text: `UPDATE tasks SET ${set.sql}, updated_at = ? WHERE id = ? RETURNING *`,
    params: [...set.values, now(), id],
  };
}

/**
 * `closed_at` is a normal column here and is written only when the caller asks
 * for it. Deriving it from `patch.status` inside this function meant every
 * update touched it, so editing the title of a finished task erased the date
 * it was finished. `task-service.update` owns that rule now, because it is the
 * only caller that knows the previous status.
 */
export async function update(id: number, patch: TaskPatch): Promise<Task | undefined> {
  const stmt = updateStmt(id, patch);
  if (!stmt) return byId(id);
  return one<Task>(stmt.text, stmt.params);
}

/* ------------------------------------------------------ the agent's queue */

/** How many requests a briefing carries; a queue longer than this is a backlog. */
export const REQUESTED_LIMIT = 10;

/** A task waiting for the agent, with the name of whoever asked. */
export type RequestedTask = Pick<
  Task,
  "id" | "project_id" | "title" | "body" | "priority" | "updated_at" | "requested_at" | "requested_by"
> & {
  requested_at: string;
  requested_by_name: string | null;
};

const REQUESTED_SELECT = `
  SELECT t.id, t.project_id, t.title, t.body, t.priority, t.updated_at, t.requested_at, t.requested_by,
         u.name AS requested_by_name
    FROM tasks t
    LEFT JOIN users u ON u.id = t.requested_by`;

/**
 * Requests still waiting: asked for, and not yet started. Taking one -- an
 * agent setting it to `doing` -- is what takes it off the queue, so there is
 * no second flag to clear and nothing to forget. Put back to `todo`
 * unfinished, which is what a session that ends mid-task is told to do, it
 * is still asked for and comes back; only finishing, dropping or taking it
 * back in the panel ends the request.
 */
export const requestedByProject = (projectId: number, limit = REQUESTED_LIMIT) =>
  all<RequestedTask>(
    `${REQUESTED_SELECT}
      WHERE t.project_id = ? AND t.requested_at IS NOT NULL AND t.status = ?
      ORDER BY t.requested_at
      LIMIT ?`,
    [projectId, "todo", limit],
  );

/** The same, across every project a person can see, for Today. One query, not one per project. */
export async function requestedAcross(projectIds: number[], limit: number): Promise<RequestedTask[]> {
  if (!projectIds.length) return [];
  return all<RequestedTask>(
    `${REQUESTED_SELECT}
      WHERE t.project_id IN (${projectIds.map(() => "?").join(",")})
        AND t.requested_at IS NOT NULL AND t.status = ?
      ORDER BY t.requested_at
      LIMIT ?`,
    [...projectIds, "todo", limit],
  );
}

/** Hands an existing task to the agent. Touches it too: being asked for is activity. */
export const request = (id: number, byUserId: number): Promise<number> => {
  const at = now();
  return run("UPDATE tasks SET requested_at = ?, requested_by = ?, updated_at = ? WHERE id = ?", [at, byUserId, at, id]);
};

export const withdrawRequest = (id: number): Promise<number> =>
  run("UPDATE tasks SET requested_at = NULL, requested_by = NULL, updated_at = ? WHERE id = ?", [now(), id]);

export const touchStmt = (id: number): Statement => ({
  text: "UPDATE tasks SET updated_at = ? WHERE id = ?",
  params: [now(), id],
});

export const touch = (id: number) => runStmt(touchStmt(id));

export const remove = (id: number) => run("DELETE FROM tasks WHERE id = ?", [id]);

/**
 * Move every task to another project, for a merge.
 *
 * Entries, events and refs hang off `task_id`, so they follow without being
 * touched -- and must not be touched, because rewriting them separately is how
 * a log ends up describing a task that moved without it.
 */
export const reassignStmt = (fromId: number, intoId: number): Statement => ({
  text: "UPDATE tasks SET project_id = ? WHERE project_id = ?",
  params: [intoId, fromId],
});

export async function counts(projectId: number) {
  // Postgres has no implicit boolean-to-integer, so FILTER replaces SUM(x=y).
  const row = await one<Record<string, string | null>>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'todo')    AS todo,
       COUNT(*) FILTER (WHERE status = 'doing')   AS doing,
       COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
       COUNT(*) FILTER (WHERE status = 'done')    AS done,
       COUNT(*) FILTER (WHERE status = 'dropped') AS dropped
     FROM tasks WHERE project_id = ?`,
    [projectId],
  );
  const n = (v: string | null | undefined) => Number(v ?? 0);
  return {
    todo: n(row?.todo),
    doing: n(row?.doing),
    blocked: n(row?.blocked),
    done: n(row?.done),
    dropped: n(row?.dropped),
  };
}

/** One query for a whole project's counts, so the home page is not N+1. */
export async function countsByProject(userId: number) {
  const rows = await all<{
    project_id: number;
    todo: string;
    doing: string;
    blocked: string;
    done: string;
    dropped: string;
  }>(
    `SELECT t.project_id,
       COUNT(*) FILTER (WHERE t.status = 'todo')    AS todo,
       COUNT(*) FILTER (WHERE t.status = 'doing')   AS doing,
       COUNT(*) FILTER (WHERE t.status = 'blocked') AS blocked,
       COUNT(*) FILTER (WHERE t.status = 'done')    AS done,
       COUNT(*) FILTER (WHERE t.status = 'dropped') AS dropped
      FROM tasks t JOIN projects p ON p.id = t.project_id
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE p.user_id = ? OR pm.user_id IS NOT NULL
     GROUP BY t.project_id`,
    [userId, userId],
  );

  const empty = { todo: 0, doing: 0, blocked: 0, done: 0, dropped: 0 };
  const map = new Map<number, typeof empty>();
  for (const r of rows)
    map.set(r.project_id, {
      todo: Number(r.todo),
      doing: Number(r.doing),
      blocked: Number(r.blocked),
      done: Number(r.done),
      dropped: Number(r.dropped),
    });
  return { map, empty };
}

/** What a lane on the dashboard prints of a task: enough for a line and a link. */
export type LaneTask = Pick<
  Task,
  "id" | "project_id" | "title" | "status" | "priority" | "updated_at"
>;

export const openByProjectsSql = (projectCount: number): string =>
  `SELECT id, project_id, title, status, priority, updated_at
     FROM (
       SELECT t.id, t.project_id, t.title, t.status, t.priority, t.updated_at,
              ROW_NUMBER() OVER (
                PARTITION BY t.project_id, t.status
                ORDER BY t.priority, t.updated_at DESC
              ) AS rank
         FROM tasks t
        WHERE t.project_id IN (${Array.from({ length: projectCount }, () => "?").join(",")})
          AND t.status IN (${OPEN_STATUSES.map(() => "?").join(",")})
     ) ranked
    WHERE rank <= ?
    ORDER BY project_id, priority, updated_at DESC`;

/**
 * The top `perStatus` open tasks of each status, for a set of projects, in one
 * query.
 *
 * The dashboard draws a lane per project and a cell per status, and a lane has
 * room for a few lines -- the counts beside it already come from
 * `countsByProject`, which is what lets a cell say how many it is not showing.
 * Cut per project AND per status, because a flat "newest fifty" would hand one
 * busy project every row and leave the lanes under it empty; and cut for
 * 'doing' as well as 'todo', because the account that measured `staleDoing`
 * had fifty-four of those in one project.
 *
 * No body: a body may be 100 KB and a lane prints a title.
 */
export async function openByProjects(
  projectIds: number[],
  perStatus: number,
): Promise<Map<number, LaneTask[]>> {
  if (!projectIds.length) return new Map();
  const rows = await all<LaneTask>(openByProjectsSql(projectIds.length), [
    ...projectIds,
    ...OPEN_STATUSES,
    perStatus,
  ]);
  return groupBy(rows, (row) => row.project_id);
}

/**
 * How Today orders each open status across projects. In progress and stuck
 * read newest first -- what was touched last is what you were on. Up next
 * puts the important ones first, then the recently touched.
 */
const ACROSS_ORDER = {
  doing: "updated_at DESC",
  todo: "priority, updated_at DESC",
  blocked: "updated_at DESC",
} as const;

export type AcrossStatus = keyof typeof ACROSS_ORDER;

export const openAcrossSql = (projectCount: number, status: AcrossStatus): string =>
  `SELECT id, project_id, title, status, priority, updated_at
     FROM tasks
    WHERE project_id IN (${Array.from({ length: projectCount }, () => "?").join(",")})
      AND status = ?
    ORDER BY ${ACROSS_ORDER[status]}, id DESC
    LIMIT ?`;

/**
 * One status, across a set of projects, as a single list rather than a lane
 * per project: Today asks "what is in progress anywhere", not "what is in
 * progress in each". The project ids are the caller's accessible set, so this
 * never decides access itself. The totals come from `countsByProject`.
 */
export async function openAcross(
  projectIds: number[],
  status: AcrossStatus,
  limit: number,
): Promise<LaneTask[]> {
  if (!projectIds.length) return [];
  return all<LaneTask>(openAcrossSql(projectIds.length, status), [...projectIds, status, limit]);
}

export type StalledTask = Pick<Task, "id" | "project_id" | "title" | "status" | "updated_at">;

export const stalledByProjectsSql = (projectCount: number): string =>
  `SELECT id, project_id, title, status, updated_at, COUNT(*) OVER () AS total
     FROM tasks
    WHERE project_id IN (${Array.from({ length: projectCount }, () => "?").join(",")})
      AND (status = 'blocked' OR (status = 'doing' AND updated_at < ?))
    ORDER BY updated_at
    LIMIT ?`;

/**
 * Tasks that will not move by themselves, across a set of projects: the
 * blocked ones, and the ones left in 'doing' with nothing written since
 * `quietBefore`. Longest waiting first, with how many there are in all.
 *
 * `staleDoing` answers the second half for one project and the briefing; the
 * dashboard asks for every project at once and wants the blocked ones in the
 * same list, because to the person reading it they are the same thing -- work
 * that is waiting on them. `COUNT(*) OVER ()` is affordable here where
 * `pageByProject` refused it: the set it walks is the stalled tasks, not every
 * open one.
 */
export async function stalledByProjects(
  projectIds: number[],
  quietBefore: string,
  limit: number,
): Promise<{ rows: StalledTask[]; total: number }> {
  if (!projectIds.length) return { rows: [], total: 0 };
  const rows = await all<StalledTask & { total: string }>(
    stalledByProjectsSql(projectIds.length),
    [...projectIds, quietBefore, limit],
  );
  return {
    rows: rows.map(({ total: _total, ...task }) => task),
    total: Number(rows[0]?.total ?? 0),
  };
}

/**
 * How many tasks this account finished since `since`, across every project it
 * can see. One number for `get_developer`'s "lately" line; the report has the
 * detail.
 */
export async function countDoneSince(userId: number, since: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
      WHERE (p.user_id = ? OR pm.user_id IS NOT NULL)
        AND t.status = 'done' AND t.closed_at >= ?`,
    [userId, userId, since],
  );
  return Number(row?.n ?? 0);
}
