import type { ContextKind } from "../constants";
import { all, one, run, setClause, type Statement } from "../db/client";
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
 */
export async function pageByProject(
  userId: number,
  projectId: number | null,
  limit: number,
): Promise<{ rows: BriefingNote[]; omitted: number }> {
  const rows =
    projectId === null
      ? await all<BriefingNote>(
          `WITH ranked AS (
             SELECT c.id, c.kind, c.title, c.body,
                    row_number() OVER (ORDER BY c.updated_at DESC, c.id DESC) AS rn
               FROM contexts c
              WHERE c.user_id = ? AND c.project_id IS NULL
           )
           SELECT id, kind, title, CASE WHEN rn <= ? THEN body END AS body
             FROM ranked ORDER BY rn`,
          [userId, limit],
        )
      : await all<BriefingNote>(
          `WITH ranked AS (
             SELECT c.id, c.kind, c.title, c.body,
                    row_number() OVER (ORDER BY c.updated_at DESC, c.id DESC) AS rn
               FROM contexts c
               JOIN projects p ON p.id = c.project_id
               LEFT JOIN project_memberships pm
                      ON pm.project_id = p.id AND pm.user_id = ?
              WHERE c.project_id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)
           )
           SELECT id, kind, title, CASE WHEN rn <= ? THEN body END AS body
             FROM ranked ORDER BY rn`,
          [userId, projectId, userId, limit],
        );

  return { rows, omitted: rows.filter((r) => r.body === null).length };
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

export async function create(input: NewContext): Promise<Context> {
  const ts = now();
  const row = await one<Context>(
    `INSERT INTO contexts (user_id, project_id, kind, title, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [input.user_id, input.project_id, input.kind, input.title, input.body, ts, ts],
  );
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
