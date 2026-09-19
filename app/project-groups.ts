/**
 * How the dashboard's projects are grouped for reading.
 *
 * The home page was a grid of every project at equal weight, newest activity
 * first. On the account that measured it that was thirty-two cards over
 * 4,200px, and the six with work in flight sat among twenty-four that had
 * none -- the same shape the project page had before it was folded into the
 * order the agent's briefing reads in. The dashboard now reads the same way:
 * what is moving, then what is not, and the empty shells last, behind the
 * fold they already had.
 *
 * "Moving" is a task in `doing` or `blocked`. A project with only queued or
 * finished work is quiet -- the log is complete, nobody is in it today -- and
 * a quiet project is a line, not a card. The counts come from the one query
 * the page already makes per visit; this is a partition, not a read.
 */

export type ProjectCounts = { doing: number; blocked: number };

export type ProjectGroups<T> = { live: T[]; quiet: T[] };

export const isLive = (counts: ProjectCounts | undefined): boolean =>
  !!counts && counts.doing + counts.blocked > 0;

/**
 * `live` holds work in flight, `quiet` the rest that is not empty. Both keep
 * the order they arrived in -- the list is newest activity first already,
 * and this is not the place to invent a second order.
 */
export function groupProjects<T extends { id: number }>(
  projects: readonly T[],
  counts: ReadonlyMap<number, ProjectCounts>,
  empty: ReadonlySet<number>,
): ProjectGroups<T> {
  const live: T[] = [];
  const quiet: T[] = [];
  for (const project of projects) {
    if (isLive(counts.get(project.id))) live.push(project);
    else if (!empty.has(project.id)) quiet.push(project);
  }
  return { live, quiet };
}
