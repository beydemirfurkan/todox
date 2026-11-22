import * as entries from "../repositories/entries";
import * as projects from "../repositories/projects";
import * as tasks from "../repositories/tasks";

/** How far back "lately" reaches for the map. */
export const BRAIN_MAP_DAYS = 90;

export interface BrainMapProject {
  slug: string;
  name: string;
  activity: number;
  open: number;
  decisions: number;
  deadEnds: number;
  questions: number;
}

/**
 * Every project the account can see that has either open work or something
 * written in the last `BRAIN_MAP_DAYS`, busiest first. Three reads in one
 * round, all counts: the map needs how much and of what, never a body.
 */
export async function brainMapProjects(userId: number): Promise<BrainMapProject[]> {
  const since = new Date(Date.now() - BRAIN_MAP_DAYS * 86_400_000).toISOString();
  const [rows, counts, kinds] = await Promise.all([
    projects.list(userId),
    tasks.countsByProject(userId),
    entries.kindCountsByProjectSince(userId, since),
  ]);

  const byProject = new Map<number, Record<string, number>>();
  for (const k of kinds) {
    const bucket = byProject.get(k.project_id) ?? {};
    bucket[k.kind] = (bucket[k.kind] ?? 0) + k.n;
    byProject.set(k.project_id, bucket);
  }

  return rows
    .map((p) => {
      const c = counts.map.get(p.id) ?? counts.empty;
      const written = byProject.get(p.id) ?? {};
      return {
        slug: p.slug,
        name: p.name,
        activity: Object.values(written).reduce((sum, n) => sum + n, 0),
        open: c.todo + c.doing + c.blocked,
        decisions: written.decision ?? 0,
        deadEnds: written.dead_end ?? 0,
        questions: written.question ?? 0,
      };
    })
    .filter((p) => p.activity > 0 || p.open > 0)
    .sort((a, b) => b.activity - a.activity || b.open - a.open || a.slug.localeCompare(b.slug));
}
