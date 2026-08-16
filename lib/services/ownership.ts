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

export const accessesProject = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM projects p
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE p.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, id, userId],
  );

export const ownsTask = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE t.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, id, userId],
  );

export const ownsEntry = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM entries e
     JOIN tasks t ON t.id = e.task_id
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE e.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, id, userId],
  );

export const ownsRef = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM refs r
     LEFT JOIN tasks t     ON t.id = r.task_id
     LEFT JOIN contexts c  ON c.id = r.context_id
     LEFT JOIN projects tp ON tp.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = tp.id AND pm.user_id = ?
     LEFT JOIN project_memberships cm ON cm.project_id = c.project_id AND cm.user_id = ?
     WHERE r.id = ? AND (
       tp.user_id = ? OR pm.user_id IS NOT NULL OR c.user_id = ? OR cm.user_id IS NOT NULL
     )`,
    [userId, userId, id, userId, userId],
  );

export const ownsContext = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM contexts c
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE c.id = ? AND (
       c.project_id IS NULL AND c.user_id = ?
       OR c.project_id IS NOT NULL AND (p.user_id = ? OR pm.user_id IS NOT NULL)
     )`,
    [userId, id, userId, userId],
  );

export async function assertTask(userId: number, id: number) {
  if (!(await ownsTask(userId, id))) throw new NotYours("task", id);
}
export async function assertProject(userId: number, id: number) {
  if (!(await ownsProject(userId, id))) throw new NotYours("project", id);
}
/**
 * The weaker of the two project gates: a member passes, not only the owner.
 *
 * Use it for writes that live *inside* a project -- a task, an entry, a note.
 * `assertProject` is for writes to the project row itself, which stay with
 * whoever owns it. Getting these two the wrong way round is why a
 * collaborator could log an entry but not add a note beside it.
 */
export async function assertProjectAccess(userId: number, id: number) {
  if (!(await accessesProject(userId, id))) throw new NotYours("project", id);
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
