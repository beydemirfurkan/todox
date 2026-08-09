import { basename } from "node:path";

import * as projects from "../repositories/projects";
import type { Project } from "../types";
import { findProjectRoot, isInside, slugify } from "../util/paths";

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

export async function mustResolve(userId: number, ref: string): Promise<Project> {
  const p = await resolve(userId, ref);
  if (p) return p;
  const known = (await projects.list(userId)).map((x) => ({
    slug: x.slug,
    root_path: x.root_path,
  }));
  throw new Error(
    `no project matches "${ref}". Known projects: ${JSON.stringify(known)}. ` +
      `Pass an absolute path to create one.`,
  );
}

/**
 * Resolve, creating one when the reference is a real filesystem path we don't
 * know yet. This is what lets an agent capture a task on its first try instead
 * of erroring out and asking the human to register a project.
 */
export async function resolveOrCreate(
  userId: number,
  ref: string,
): Promise<{ project: Project; created: boolean }> {
  const found = await resolve(userId, ref);
  if (found) return { project: found, created: false };

  if (!ref.startsWith("/"))
    return { project: await mustResolve(userId, ref), created: false };

  const root = findProjectRoot(ref);
  const name = basename(root) || "untitled";
  return {
    project: await projects.create(userId, {
      name,
      slug: await projects.nextFreeSlug(userId, name),
      root_path: root,
    }),
    created: true,
  };
}
