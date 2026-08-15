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

export const byId = (id: number) =>
  one<Context>("SELECT * FROM contexts WHERE id = ?", [id]);

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
