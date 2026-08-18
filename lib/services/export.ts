import { all, one } from "../db/client";

/**
 * Everything one account can take with it.
 *
 * The product tells people to run their own if the log matters to them, and the
 * delete-project warning said, in as many words, "there is no undo, and no
 * export first". Both of those were true at once, which made the advice
 * something you could only follow before you had any data worth moving.
 *
 * WHAT IS NOT IN HERE, and why each one is a decision rather than an oversight:
 *
 * - The account row. A password hash is not data somebody needs a copy of, and
 *   an export is a file that ends up in a Downloads folder and a chat window.
 * - Sessions, agent tokens, single-use email tokens, rate-limit counters. They
 *   are credentials and bookkeeping; restoring them would mean restoring a way
 *   in, and they are worthless on another instance anyway.
 * - Projects somebody else owns and shared with you. They are theirs to export.
 * - Memberships, invitations and notifications. Every one of those rows names
 *   another person by id or address. Your export should not be a way to take a
 *   copy of who your collaborators are.
 * - `share_token`. It is a capability: anyone holding it can read the project.
 *   A restored copy gets a new one or none.
 *
 * Ids are kept, because the log refers to them: a stale-ref line names a task,
 * and an import that renumbers has to rewrite those references or lose them.
 * They are internal ids of the exporting instance, and the importer treats them
 * as nothing more than keys to join on.
 */

/** Wide enough that no real account meets it, tight enough to bound the read. */
export const EXPORT_MAX_ROWS = 200_000;

export type ExportBundle = {
  format: "todox-export";
  /** Bumped when the shape changes in a way an importer has to know about. */
  version: 1;
  exported_at: string;
  counts: Record<string, number>;
  projects: unknown[];
  project_paths: unknown[];
  tasks: unknown[];
  entries: unknown[];
  task_events: unknown[];
  contexts: unknown[];
  refs: unknown[];
};

/**
 * Refused rather than truncated.
 *
 * Everything else in this codebase that hits a ceiling says what it left out
 * and carries on, because a briefing is a summary and a summary can be partial.
 * An export cannot: a file that silently stops at two hundred thousand rows is
 * a backup somebody trusts and discovers is short on the day they need it. So
 * this is the one read that would rather fail.
 */
export class ExportTooLarge extends Error {
  constructor(readonly rows: number) {
    super(
      `this account holds ${rows} rows, over the ${EXPORT_MAX_ROWS} an export carries in one file`,
    );
    this.name = "ExportTooLarge";
  }
}

const countFor = (userId: number) =>
  one<{ n: string }>(
    `SELECT
       (SELECT COUNT(*) FROM projects      WHERE user_id = ?)
     + (SELECT COUNT(*) FROM project_paths WHERE user_id = ?)
     + (SELECT COUNT(*) FROM contexts      WHERE user_id = ?)
     + (SELECT COUNT(*) FROM tasks       t JOIN projects p ON p.id = t.project_id WHERE p.user_id = ?)
     + (SELECT COUNT(*) FROM entries     e JOIN tasks t ON t.id = e.task_id
          JOIN projects p ON p.id = t.project_id WHERE p.user_id = ?)
     + (SELECT COUNT(*) FROM task_events v JOIN tasks t ON t.id = v.task_id
          JOIN projects p ON p.id = t.project_id WHERE p.user_id = ?)
       AS n`,
    [userId, userId, userId, userId, userId, userId],
  );

/**
 * Owned, not merely accessible.
 *
 * `ACCESS_SELECT` elsewhere deliberately includes projects shared with you,
 * because reading them is the point of sharing. Taking a copy is not: the rows
 * belong to whoever created the project, and they are the one who can export
 * them.
 */
const OWNED = "SELECT id FROM projects WHERE user_id = ?";

export async function exportAccount(userId: number): Promise<ExportBundle> {
  const total = Number((await countFor(userId))?.n ?? 0);
  if (total > EXPORT_MAX_ROWS) throw new ExportTooLarge(total);

  const [projects, projectPaths, tasks, entries, events, contexts, refs] = await Promise.all([
    all(
      `SELECT id, slug, name, root_path, summary, archived, created_at, share_log
         FROM projects WHERE user_id = ? ORDER BY id`,
      [userId],
    ),
    all(
      `SELECT id, project_id, path, created_at
         FROM project_paths WHERE user_id = ? ORDER BY id`,
      [userId],
    ),
    all(
      `SELECT t.id, t.project_id, t.title, t.body, t.status, t.priority,
              t.created_at, t.updated_at, t.closed_at
         FROM tasks t WHERE t.project_id IN (${OWNED}) ORDER BY t.id`,
      [userId],
    ),
    // `user_id` is dropped and `author` kept: the first names an account, the
    // second says whether a person or an agent wrote it, which is the part the
    // log is actually about.
    all(
      `SELECT e.id, e.task_id, e.kind, e.body, e.author, e.model, e.created_at
         FROM entries e
         JOIN tasks t ON t.id = e.task_id
        WHERE t.project_id IN (${OWNED}) ORDER BY e.id`,
      [userId],
    ),
    // Durations come from these, so a report on a restored copy says the same
    // thing as a report on the original. Dropping them would quietly change
    // history rather than lose it, which is worse.
    all(
      `SELECT v.id, v.task_id, v.from_status, v.to_status, v.at, v.actor, v.model
         FROM task_events v
         JOIN tasks t ON t.id = v.task_id
        WHERE t.project_id IN (${OWNED}) ORDER BY v.id`,
      [userId],
    ),
    all(
      `SELECT id, project_id, kind, title, body, created_at, updated_at
         FROM contexts WHERE user_id = ? ORDER BY id`,
      [userId],
    ),
    // Hashes travel. They are what makes a note able to say it has gone stale,
    // and recomputing them needs the files, which the server has never seen.
    all(
      `SELECT r.id, r.task_id, r.context_id, r.path, r.note, r.hash,
              r.linked_at, r.hash_seen, r.checked_at
         FROM refs r
         LEFT JOIN tasks t    ON t.id = r.task_id
         LEFT JOIN contexts c ON c.id = r.context_id
        WHERE t.project_id IN (${OWNED}) OR c.user_id = ?
        ORDER BY r.id`,
      [userId, userId],
    ),
  ]);

  return {
    format: "todox-export",
    version: 1,
    exported_at: new Date().toISOString(),
    counts: {
      projects: projects.length,
      project_paths: projectPaths.length,
      tasks: tasks.length,
      entries: entries.length,
      task_events: events.length,
      contexts: contexts.length,
      refs: refs.length,
    },
    projects,
    project_paths: projectPaths,
    tasks,
    entries,
    task_events: events,
    contexts,
    refs,
  };
}
