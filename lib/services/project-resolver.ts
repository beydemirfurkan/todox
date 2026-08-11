import * as projects from "../repositories/projects";
import type { Project } from "../types";
import {
  isAbsolutePath,
  isInside,
  lastSegment,
  normalisePath,
  slugify,
} from "../util/paths";
import { BadRequest } from "./errors";

/** Resolve a project by slug, by name, or by a filesystem path inside it. */
export async function resolve(
  userId: number,
  ref: string,
): Promise<Project | undefined> {
  const bySlug = await projects.bySlug(userId, slugify(ref));
  if (bySlug) return bySlug;

  const byName = await projects.byName(userId, ref);
  if (byName) return byName;

  // Deepest root wins, so a nested repo beats the parent that contains it.
  return (await projects.withRootPath(userId))
    .filter((p) => isInside(ref, p.root_path!))
    .sort((a, b) => b.root_path!.length - a.root_path!.length)[0];
}

/**
 * Enough to pick from, not the whole account.
 *
 * The message used to carry every slug and every absolute `root_path` the
 * account had, so one typo'd reference dumped the developer's entire directory
 * layout into the agent's transcript -- and into any log that records 400
 * bodies. Slugs alone identify a project; the paths were never the useful part.
 */
const SUGGESTIONS = 8;

export async function mustResolve(userId: number, ref: string): Promise<Project> {
  const p = await resolve(userId, ref);
  if (p) return p;

  const all = await projects.list(userId);
  const slugs = all.map((x) => x.slug);
  const shown = slugs.slice(0, SUGGESTIONS).join(", ");
  const rest = slugs.length - SUGGESTIONS;

  throw new BadRequest(
    `no project matches "${ref}". ` +
      (slugs.length
        ? `Known slugs: ${shown}${rest > 0 ? ` (+${rest} more)` : ""}. `
        : "You have no projects yet. ") +
      `Pass an absolute path to create one.`,
  );
}

/**
 * Resolve, creating one when the reference is a real filesystem path we don't
 * know yet. This is what lets an agent capture a task on its first try instead
 * of erroring out and asking the human to register a project.
 *
 * `repoRoot` comes from the caller because only the caller can see the disk.
 * This used to call `findProjectRoot(ref)` here, which walks up looking for a
 * `.git` — on a web host with no checkout every probe missed, so it fell back
 * to `dirname(ref)` and registered the *parent* of the repository under the
 * parent's name. An agent in `/Users/me/code` got a project called "code".
 */
export async function resolveOrCreate(
  userId: number,
  ref: string,
  repoRoot?: string,
): Promise<{ project: Project; created: boolean }> {
  const found = await resolve(userId, ref);
  if (found) return { project: found, created: false };

  if (!isAbsolutePath(ref))
    return { project: await mustResolve(userId, ref), created: false };

  // Normalised whichever branch it came from. Only the `repoRoot` one was, so
  // an agent that passed `cwd` alone -- which the tools explicitly allow --
  // stored `C:\Users\me\repo` while its neighbour stored `C:/Users/me/repo`.
  // Resolution survives that, because `isInside` folds both sides before
  // comparing. Anything that compares the stored string to a path it built
  // itself does not, and that has already cost a smoke suite once.
  const root = normalisePath(
    repoRoot && isAbsolutePath(repoRoot) ? repoRoot : ref,
  );
  // Not `node:path`'s basename: this process runs on Linux, where a backslash
  // is an ordinary character, so a Windows path would come back whole and the
  // project would be named "C:\Users\me\repo".
  const name = lastSegment(root) || "untitled";
  return {
    project: await projects.create(userId, {
      name,
      slug: await projects.nextFreeSlug(userId, name),
      root_path: root,
    }),
    created: true,
  };
}
