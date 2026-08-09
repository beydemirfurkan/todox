import type { ContextKind } from "../constants";
import { all, one, run } from "../db/client";
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
        `SELECT * FROM contexts WHERE user_id = ? AND project_id = ?
         ORDER BY kind, updated_at DESC`,
        [userId, projectId],
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

export async function update(
  id: number,
  patch: Partial<Pick<Context, "kind" | "title" | "body">>,
) {
  const fields = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!fields.length) return;
  await run(
    `UPDATE contexts SET ${fields.map(([k]) => `${k} = ?`).join(", ")},
       updated_at = ? WHERE id = ?`,
    [...fields.map(([, v]) => v), now(), id],
  );
}

export const remove = (id: number) => run("DELETE FROM contexts WHERE id = ?", [id]);
