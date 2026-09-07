import * as contexts from "../repositories/contexts";
import * as projects from "../repositories/projects";
import * as tasks from "../repositories/tasks";
import type { Project } from "../types";

export type ProjectWithActivity = Project & { activity_at: string };

const newest = (dates: Array<string | undefined>): string =>
  dates.reduce<string>((latest, date) => (date && date > latest ? date : latest), dates[0] ?? "");

/** Projects ordered by work somebody chose to keep, newest first. */
export async function listRecent(userId: number): Promise<ProjectWithActivity[]> {
  const rows = await projects.list(userId);
  if (!rows.length) return [];
  const projectIds = rows.map((project) => project.id);
  const [taskActivity, contextActivity] = await Promise.all([
    tasks.latestUpdatedByProjects(projectIds),
    contexts.latestUpdatedByProjects(projectIds),
  ]);

  return rows
    .map((project) => ({
      ...project,
      activity_at: newest([
        project.created_at,
        taskActivity.get(project.id),
        contextActivity.get(project.id),
      ]),
    }))
    .sort(
      (first, second) =>
        second.activity_at.localeCompare(first.activity_at) || second.id - first.id,
    );
}
