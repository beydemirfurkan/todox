import { one } from "../db/client";

/**
 * Single place that answers "does this row belong to this account?".
 *
 * Ids travel through URLs, form fields and MCP arguments, so every write path
 * has to prove ownership before it touches a row. Keeping the joins here means
 * there is one thing to audit rather than a check scattered per call site.
 */

export class NotYours extends Error {
  constructor(what: string, id: number) {
    super(`${what} #${id} does not exist or is not yours`);
    this.name = "NotYours";
  }
}

const owns = async (text: string, params: unknown[]) =>
  Boolean(await one<{ n: number }>(text, params));

export const ownsProject = (userId: number, id: number) =>
  owns("SELECT 1 AS n FROM projects WHERE id = ? AND user_id = ?", [id, userId]);

export const ownsTask = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM tasks t JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? AND p.user_id = ?`,
    [id, userId],
  );

export const ownsEntry = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM entries e
     JOIN tasks t ON t.id = e.task_id
     JOIN projects p ON p.id = t.project_id
     WHERE e.id = ? AND p.user_id = ?`,
    [id, userId],
  );

export const ownsRef = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM refs r
     LEFT JOIN tasks t     ON t.id = r.task_id
     LEFT JOIN contexts c  ON c.id = r.context_id
     LEFT JOIN projects tp ON tp.id = t.project_id
     WHERE r.id = ? AND (tp.user_id = ? OR c.user_id = ?)`,
    [id, userId, userId],
  );

export const ownsContext = (userId: number, id: number) =>
  owns("SELECT 1 AS n FROM contexts WHERE id = ? AND user_id = ?", [id, userId]);

export async function assertTask(userId: number, id: number) {
  if (!(await ownsTask(userId, id))) throw new NotYours("task", id);
}
export async function assertProject(userId: number, id: number) {
  if (!(await ownsProject(userId, id))) throw new NotYours("project", id);
}
export async function assertEntry(userId: number, id: number) {
  if (!(await ownsEntry(userId, id))) throw new NotYours("entry", id);
}
export async function assertRef(userId: number, id: number) {
  if (!(await ownsRef(userId, id))) throw new NotYours("ref", id);
}
export async function assertContext(userId: number, id: number) {
  if (!(await ownsContext(userId, id))) throw new NotYours("context", id);
}
