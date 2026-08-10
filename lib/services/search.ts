import { all } from "../db/client";

export type SearchHit = {
  type: "task" | "entry" | "context";
  id: number;
  task_id?: number;
  project_slug: string | null;
  title: string;
  snippet: string;
  created_at: string;
};

type TaskRow = {
  id: number;
  title: string;
  body: string | null;
  created_at: string;
  project_slug: string;
};
type EntryRow = {
  id: number;
  task_id: number;
  kind: string;
  body: string;
  created_at: string;
  title: string;
  project_slug: string;
};
type ContextRow = {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  project_slug: string | null;
};

const cut = (s: string | null) => (s ?? "").replace(/\s+/g, " ").slice(0, 240);

/**
 * `%` and `_` are wildcards to ILIKE, so a search for either matched
 * everything and a search for a literal one found nothing.
 */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** ILIKE, not full-text search -- honest for this scale and zero index upkeep. */
export async function search(
  userId: number,
  query: string,
  limit = 30,
): Promise<SearchHit[]> {
  const like = `%${escapeLike(query)}%`;

  const [taskRows, entryRows, contextRows] = await Promise.all([
    all<TaskRow>(
      `SELECT t.id, t.title, t.body, t.created_at, p.slug AS project_slug
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ? AND (t.title ILIKE ? OR t.body ILIKE ?)
       ORDER BY t.updated_at DESC LIMIT ?`,
      [userId, like, like, limit],
    ),
    all<EntryRow>(
      `SELECT e.id, e.task_id, e.kind, e.body, e.created_at, t.title, p.slug AS project_slug
       FROM entries e JOIN tasks t ON t.id = e.task_id
       JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ? AND e.body ILIKE ? ORDER BY e.id DESC LIMIT ?`,
      [userId, like, limit],
    ),
    all<ContextRow>(
      `SELECT c.id, c.kind, c.title, c.body, c.created_at, p.slug AS project_slug
       FROM contexts c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.user_id = ? AND (c.title ILIKE ? OR c.body ILIKE ?)
       ORDER BY c.updated_at DESC LIMIT ?`,
      [userId, like, like, limit],
    ),
  ]);

  return [
    ...taskRows.map(
      (t): SearchHit => ({
        type: "task",
        id: t.id,
        project_slug: t.project_slug,
        title: t.title,
        snippet: cut(t.body),
        created_at: t.created_at,
      }),
    ),
    ...entryRows.map(
      (e): SearchHit => ({
        type: "entry",
        id: e.id,
        task_id: e.task_id,
        project_slug: e.project_slug,
        title: `${e.kind} @ ${e.title}`,
        snippet: cut(e.body),
        created_at: e.created_at,
      }),
    ),
    ...contextRows.map(
      (c): SearchHit => ({
        type: "context",
        id: c.id,
        project_slug: c.project_slug,
        title: `${c.kind}: ${c.title}`,
        snippet: cut(c.body),
        created_at: c.created_at,
      }),
    ),
  ]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    // The limit is a limit on the answer, not on each of the three queries.
    // Asking for 100 and receiving 300 is the kind of surprise that fills an
    // agent's context window without anyone deciding to.
    .slice(0, limit);
}
