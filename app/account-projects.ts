import { cache } from "react";

import { countsByProject } from "@/lib/repositories/tasks";
import { arrange, arrangementFor } from "@/lib/services/project-organization";
import { listRecent } from "@/lib/services/project-activity";

/**
 * The account's projects, newest activity first, with their status counts
 * and how this person has arranged them.
 *
 * The sidebar needs this on every page and Today and the project page need
 * it again; `cache` makes that one set of queries per request rather than
 * three. The arrangement rides in the same round trip.
 */
export const accountProjects = cache(async (userId: number) => {
  const [projects, counts, arrangement] = await Promise.all([
    listRecent(userId),
    countsByProject(userId),
    arrangementFor(userId),
  ]);
  return {
    projects,
    counts,
    folders: arrangement.folders,
    placements: arrangement.placements,
    arranged: arrange({ projects, ...arrangement }),
  };
});
