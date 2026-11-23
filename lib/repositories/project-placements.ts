import { all, run } from "../db/client";
import type { ProjectPlacement } from "../types";

/** Every placement one person has made, for one pass over their project list. */
export const listByUser = (userId: number) =>
  all<ProjectPlacement>("SELECT * FROM project_placements WHERE user_id = ?", [userId]);

/*
 * One upsert per column, each with its column written out. The row may not
 * exist yet -- a project nobody arranged has none -- and each write must leave
 * the other two columns as they were.
 */

export const setFolder = (userId: number, projectId: number, folderId: number | null) =>
  run(
    `INSERT INTO project_placements (user_id, project_id, folder_id) VALUES (?, ?, ?)
     ON CONFLICT (user_id, project_id) DO UPDATE SET folder_id = EXCLUDED.folder_id`,
    [userId, projectId, folderId],
  );

export const setPinnedAt = (userId: number, projectId: number, at: string | null) =>
  run(
    `INSERT INTO project_placements (user_id, project_id, pinned_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, project_id) DO UPDATE SET pinned_at = EXCLUDED.pinned_at`,
    [userId, projectId, at],
  );

export const setArchivedAt = (userId: number, projectId: number, at: string | null) =>
  run(
    `INSERT INTO project_placements (user_id, project_id, archived_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, project_id) DO UPDATE SET archived_at = EXCLUDED.archived_at`,
    [userId, projectId, at],
  );
