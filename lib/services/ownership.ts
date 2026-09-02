import { all, one } from "../db/client";

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

/**
 * Members pass, not only the owner.
 *
 * An observation is about a repository rather than about a person: two people
 * sharing a project are working in the same tree, so a collaborator reading
 * "seven commits on feat/x" is reading about their own work as much as
 * anybody's, and has as much standing to promote it into the log.
 */
export const ownsObservation = (userId: number, id: number) =>
  owns(
    `SELECT 1 AS n FROM observations o
     JOIN projects p ON p.id = o.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
     WHERE o.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`,
    [userId, id, userId],
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
export async function assertObservation(userId: number, id: number) {
  if (!(await ownsObservation(userId, id))) throw new NotYours("observation", id);
}

/**
 * The batch sibling of `assertRef`, for a call that arrives with a list.
 *
 * `report_file_hashes` accepts up to five hundred refs, and checking them one
 * at a time meant five hundred of the six-way join above, issued together
 * against a pool of ten, on a route that gives up after thirty seconds. The
 * write that follows was already a single statement, which is what made the
 * check the expensive half.
 *
 * Same query, one round trip: ask which of these ids the account can reach and
 * refuse if any is missing. Refusing on the first absent id keeps the message
 * identical to the single version -- `NotYours` still cannot say whether the
 * row exists for somebody else, so a caller learns nothing from which id came
 * back named.
 */
export async function assertRefs(userId: number, ids: number[]): Promise<void> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;

  const rows = await all<{ id: number }>(
    `SELECT r.id FROM refs r
     LEFT JOIN tasks t     ON t.id = r.task_id
     LEFT JOIN contexts c  ON c.id = r.context_id
     LEFT JOIN projects tp ON tp.id = t.project_id
     LEFT JOIN project_memberships pm ON pm.project_id = tp.id AND pm.user_id = ?
     LEFT JOIN project_memberships cm ON cm.project_id = c.project_id AND cm.user_id = ?
     WHERE r.id IN (${wanted.map(() => "?").join(",")}) AND (
       tp.user_id = ? OR pm.user_id IS NOT NULL OR c.user_id = ? OR cm.user_id IS NOT NULL
     )`,
    [userId, userId, ...wanted, userId, userId],
  );

  const reachable = new Set(rows.map((r) => r.id));
  const missing = wanted.find((id) => !reachable.has(id));
  if (missing !== undefined) throw new NotYours("ref", missing);
}
