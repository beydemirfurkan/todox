import type { ContextKind } from "../constants";
import { all, one, run, setClause, type Statement } from "../db/client";
import { document, rank, TSQUERY, TSQUERY_FROM } from "../db/fts";
import type { Context } from "../types";
import { now } from "../util/time";

export type NewContext = {
  user_id: number;
  project_id: number | null;
  kind: ContextKind;
  title: string;
  body: string;
};

/**
 * A note as the briefing carries it.
 *
 * `body` is null when the note was past the briefing's ceiling -- not when the
 * note is empty, which cannot happen: `addContext` and `updateContext` both
 * require at least one character. So null means "ask for it", and it is the
 * only thing it can mean.
 */
export type BriefingNote = {
  id: number;
  kind: ContextKind;
  title: string;
  body: string | null;
  /**
   * When it was written and when it was last touched.
   *
   * Carried because `update_context` asks the agent to arbitrate between notes
   * that contradict each other, and age is most of the evidence for that: a
   * gotcha from last week and one from two years ago are not equally likely to
   * still be true. Asking for a judgement while withholding what it turns on is
   * the kind of thing that produces a confident wrong answer.
   */
  created_at: string;
  updated_at: string;
};

/** `null` means the account-wide scope, which is a real scope here, not "no
 *  filter" -- one person's global notes must never leak into another's. */
export const listByProject = (userId: number, projectId: number | null) =>
  projectId === null
    ? all<Context>(
        `SELECT * FROM contexts WHERE user_id = ? AND project_id IS NULL
         ORDER BY kind, updated_at DESC`,
        [userId],
      )
    : all<Context>(
        `SELECT c.* FROM contexts c
          JOIN projects p ON p.id = c.project_id
          LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
         WHERE c.project_id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)
         ORDER BY kind, updated_at DESC`,
        [userId, projectId, userId],
      );

/**
 * The briefing's read: every note's title, but only the newest `limit` bodies.
 *
 * `listByProject` above has no ceiling and must not get one -- `project-merge`
 * reads it to move a project's notes, and a LIMIT there would drop rows during
 * a merge, silently and permanently. So this is a second function rather than
 * a parameter, the same split `tasks` already makes between `listByProject`
 * and `pageByProject`.
 *
 * Titles come back for all of them and bodies for some, rather than a page and
 * a number. A count would tell an agent that notes exist and leave it no way
 * to name or fetch one: nothing lists context notes, so `open_tasks_omitted`'s
 * trick of pointing at `list_tasks` has no equivalent here. A title plus an id
 * is the smallest thing that stays honest -- the agent can see what it was not
 * given and ask for it by id with `get_context_note`.
 *
 * Ordered by `updated_at` rather than the shared function's `kind, updated_at`.
 * Sorting a knowledge base alphabetically by kind is arbitrary at the best of
 * times; it is actively wrong once there is a cut, because what falls off the
 * end is then whatever sorts last (`preference`) rather than whatever has gone
 * longest without being touched. The web pages keep the grouped order, which
 * is what they render.
 *
 * `id` breaks the tie, and it is not decoration: notes written in the same
 * second sort arbitrarily without it, so which of them keeps its body would
 * change between two calls that read the same rows.
 *
 * `focus` is what the session is about, and it decides which notes the body
 * budget is spent on rather than how many. Without it the ceiling keeps the
 * newest, which is a guess -- a standing rule written a year ago can be the one
 * that matters and recency will never surface it. With it, relevance sorts
 * first and recency still breaks the tie, so a note that matches nothing lands
 * exactly where it would have anyway.
 *
 * That fallback is the property worth keeping: `ts_rank` is 0 for a document
 * the query does not touch, so a focus that matches nothing produces the
 * identical order. Passing one can move a note up; it can never lose one.
 */
export async function pageByProject(
  userId: number,
  projectId: number | null,
  limit: number,
  focus?: string,
): Promise<{ rows: BriefingNote[]; omitted: number }> {
  // Account-wide notes are owned by the row; a project's are owned through the
  // project. One string each, because the focus query below repeats whichever
  // it is -- ownership belongs in both halves, for the same reason it belongs
  // in both arms of `search`.
  const joins =
    projectId === null
      ? ``
      : `JOIN projects p ON p.id = c.project_id
         LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?`;
  const where =
    projectId === null
      ? `c.user_id = ? AND c.project_id IS NULL`
      : `c.project_id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`;
  const scope = projectId === null ? [userId] : [userId, projectId, userId];

  const doc = document("contexts", "c");

  // `ts_rank` straight in the window's ORDER BY, which does mean two tsvectors
  // per note in the project on the call every session opens with. Measured:
  // 2ms -> 17ms at 100 notes, 5 -> 142 at 1,000, 27 -> 759 at 5,000. Paid once
  // per session and only when a focus was sent.
  //
  // The obvious fix -- find the matching notes through the GIN index first and
  // rank only those -- was written, measured at twice as slow (759ms ->
  // 1554ms), and reverted, because at the time every note matched anyway and
  // the pre-filter filtered nothing. `db/fts.ts` has since made the match
  // selective, so that idea is now worth retrying; it is not done here because
  // the numbers above were taken before it and re-taking them is the work.
  const relevance = focus ? `WITH q AS (SELECT ${TSQUERY} ${TSQUERY_FROM}),` : `WITH`;
  const order = focus
    ? `${rank(doc)} DESC, c.updated_at DESC, c.id DESC`
    : `c.updated_at DESC, c.id DESC`;

  const rows = await all<BriefingNote>(
    `${relevance} ranked AS (
       SELECT c.id, c.kind, c.title, c.body, c.created_at, c.updated_at,
              row_number() OVER (ORDER BY ${order}) AS rn
         FROM ${focus ? `q CROSS JOIN contexts c` : `contexts c`}
         ${joins}
        WHERE ${where}
     )
     SELECT id, kind, title, created_at, updated_at,
            CASE WHEN rn <= ? THEN body END AS body
       FROM ranked ORDER BY rn`,
    [...(focus ? [focus, focus] : []), ...scope, limit],
  );

  return { rows, omitted: rows.filter((r) => r.body === null).length };
}

/**
 * Which of these projects hold a note written by ANYBODY.
 *
 * The sibling below answers "which hold a note I wrote", which is the right
 * question for a personal list and the wrong one for deciding a project is
 * empty: a member can write standing rules into a project they do not own, and
 * `removeIfEmpty` refuses on any note regardless of who wrote it. Asking the
 * narrower question made the home page offer to clear projects that were not
 * empty, and the button then failed on a guard the list had not applied.
 */
export async function projectIdsHoldingNotes(projectIds: number[]): Promise<Set<number>> {
  if (!projectIds.length) return new Set();
  const rows = await all<{ project_id: number }>(
    `SELECT DISTINCT project_id FROM contexts
      WHERE project_id IN (${projectIds.map(() => "?").join(",")})`,
    projectIds,
  );
  return new Set(rows.map((r) => r.project_id));
}

/**
 * Which projects carry standing notes, for the caller that has to know whether
 * a project is empty.
 *
 * A set rather than counts, because the only question asked of it is "is there
 * anything here" -- and shipping a number nobody reads invites somebody to
 * start rendering it.
 *
 * Scoped by account rather than by membership on purpose: a note is written
 * against the writer's own account, and this only ever decides whether to show
 * the caller a project they already own.
 */
export async function projectIdsWithNotes(userId: number): Promise<Set<number>> {
  const rows = await all<{ project_id: number }>(
    `SELECT DISTINCT project_id FROM contexts
      WHERE user_id = ? AND project_id IS NOT NULL`,
    [userId],
  );
  return new Set(rows.map((r) => r.project_id));
}

export const byId = (id: number) =>
  one<Context>("SELECT * FROM contexts WHERE id = ?", [id]);

/** Batched `byId`, for a caller holding a set of ids from somewhere else --
 *  the refs on one file, say. It does no scoping: `contexts` has no project
 *  column it could scope by on its own, and the caller is the side that knows
 *  which account is asking. */
export async function byIds(ids: number[]): Promise<Context[]> {
  if (!ids.length) return [];
  return all<Context>(
    `SELECT * FROM contexts WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
}

/**
 * Beside `create` because a note written up from an observation has to mark
 * that observation in the same transaction, and only a service may sequence
 * the two. The SQL stays with the table that owns it; see the transaction rule
 * in CONTRIBUTING.md.
 */
export const createStmt = (input: NewContext, at = now()): Statement => ({
  text: `INSERT INTO contexts (user_id, project_id, kind, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  params: [input.user_id, input.project_id, input.kind, input.title, input.body, at, at],
});

export async function create(input: NewContext): Promise<Context> {
  const stmt = createStmt(input);
  const row = await one<Context>(stmt.text, stmt.params);
  return row!;
}

const COLUMNS = ["kind", "title", "body"] as const;

export async function update(
  id: number,
  patch: Partial<Pick<Context, "kind" | "title" | "body">>,
) {
  const set = setClause(patch, COLUMNS);
  if (!set.sql) return;
  await run(`UPDATE contexts SET ${set.sql}, updated_at = ? WHERE id = ?`, [
    ...set.values,
    now(),
    id,
  ]);
}

export const remove = (id: number) => run("DELETE FROM contexts WHERE id = ?", [id]);

/**
 * Move a project's notes to another project, for a merge.
 *
 * Scoped to a project id, so account-wide notes -- the ones stored with a null
 * `project_id` -- are left where they are. They were never part of either side.
 */
export const reassignStmt = (fromId: number, intoId: number): Statement => ({
  text: "UPDATE contexts SET project_id = ? WHERE project_id = ?",
  params: [intoId, fromId],
});
