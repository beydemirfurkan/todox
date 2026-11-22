import { cache } from "react";

import { countsByProject } from "@/lib/repositories/tasks";
import { listRecent } from "@/lib/services/project-activity";

/**
 * The account's projects, newest activity first, with their status counts.
 *
 * The sidebar needs this on every page and Today needs it again for its own
 * lists; `cache` makes that one set of queries per request rather than two.
 */
export const accountProjects = cache(async (userId: number) => {
  const [projects, counts] = await Promise.all([listRecent(userId), countsByProject(userId)]);
  return { projects, counts };
});
