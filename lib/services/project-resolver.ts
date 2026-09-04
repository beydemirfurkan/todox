import * as projectPaths from "../repositories/project-paths";
import * as projects from "../repositories/projects";
import type { Project } from "../types";
import {
  isAbsolutePath,
  isInside,
  lastSegment,
  normalisePath,
  repoKey,
  sameOsFamily,
  scrubRemote,
  slugify,
} from "../util/paths";
import { BadRequest } from "./errors";

/** Everything the caller can tell us about the repo behind a path. */
export type RepoHints = {
  /** The repository root containing `cwd`, when the caller can see a disk. */
  repoRoot?: string;
  /** `git remote get-url origin`, the only name this repo has on every machine. */
  repoUrl?: string;
};

/** Where this account has a project on disk: the first path, plus every other. */
async function knownPaths(userId: number) {
  const [rooted, extra] = await Promise.all([
    projects.withRootPath(userId),
    projectPaths.listAll(userId),
  ]);

  // The rows are re-checked rather than trusted through a `!`. The query is
  // meant to return only projects that have a path, and when it briefly did
  // not, the assertion turned a null column into a TypeError inside a filter --
  // so one bad row failed every lookup for the account instead of being skipped.
  const byProject = new Map<number, { project: Project; paths: string[] }>();
  for (const p of rooted) {
    if (typeof p.root_path !== "string") continue;
    byProject.set(p.id, { project: p, paths: [p.root_path] });
  }
  for (const row of extra) {
    byProject.get(row.project_id)?.paths.push(row.path);
  }
  return byProject;
}

/** The project whose remote matches, or undefined. Oldest wins. */
async function byRemote(userId: number, repoUrl: string | undefined) {
  const key = repoKey(repoUrl);
  if (!key) return undefined;
  const rows = await projects.withRepoUrl(userId);
  return rows.find((p) => repoKey(p.repo_url) === key);
}

/** Resolve a project by slug, by name, by remote, or by a path inside it. */
export async function resolve(
  userId: number,
  ref: string,
  hints: RepoHints = {},
): Promise<Project | undefined> {
  const bySlug = await projects.bySlug(userId, slugify(ref));
  if (bySlug) return bySlug;

  const byName = await projects.byName(userId, ref);
  if (byName) return byName;

  // Before the path, because the path is the thing that differs between two
  // machines and the remote is the thing that does not.
  const byUrl = await byRemote(userId, hints.repoUrl);
  if (byUrl) return byUrl;

  // Deepest root wins, so a nested repo beats the parent that contains it.
  const candidates = [...(await knownPaths(userId)).values()].flatMap(({ project, paths }) =>
    paths.filter((path) => isInside(ref, path)).map((path) => ({ project, path })),
  );
  return candidates.sort((a, b) => b.path.length - a.path.length)[0]?.project;
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

export async function mustResolve(
  userId: number,
  ref: string,
  hints: RepoHints = {},
): Promise<Project> {
  const p = await resolve(userId, ref, hints);
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

export type Resolution = {
  project: Project;
  created: boolean;
  /** Said out loud when a duplicate was the likely -- but not certain -- read. */
  warning?: string;
};

/**
 * A project already registered for this repo from another machine.
 *
 * Only reached when the remote did not answer, which is most of the time: the
 * column is optional and an agent that never calls `update_project` leaves it
 * null forever. The folder name alone is far too weak -- two clients can both
 * have a `website` -- so it has to be paired with something. That something is
 * the shape of the path: `C:/Users/me/app` and `/Users/me/app` cannot both
 * exist on one machine, so a project known *only* by paths from the other
 * family is the same repo seen from a second computer.
 *
 * Deliberately not applied within one OS family. `~/work/api` and
 * `~/personal/api` are two repositories with one folder name, and silently
 * fusing their logs is worse than the duplicate this function exists to stop.
 */
function adoptable(
  candidates: { project: Project; paths: string[] }[],
  root: string,
): Project | undefined {
  const foreign = candidates.filter(
    ({ paths }) => paths.length > 0 && paths.every((p) => !sameOsFamily(p, root)),
  );
  return foreign[0]?.project;
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
  hints: RepoHints = {},
): Promise<Resolution> {
  const found = await resolve(userId, ref, hints);
  if (found) {
    await remember(userId, found, ref, hints);
    return { project: found, created: false };
  }

  if (!isAbsolutePath(ref))
    return { project: await mustResolve(userId, ref, hints), created: false };

  // Normalised whichever branch it came from. Only the `repoRoot` one was, so
  // an agent that passed `cwd` alone -- which the tools explicitly allow --
  // stored `C:\Users\me\repo` while its neighbour stored `C:/Users/me/repo`.
  // Resolution survives that, because `isInside` folds both sides before
  // comparing. Anything that compares the stored string to a path it built
  // itself does not, and that has already cost a smoke suite once.
  const root = normalisePath(
    hints.repoRoot && isAbsolutePath(hints.repoRoot) ? hints.repoRoot : ref,
  );
  // Not `node:path`'s basename: this process runs on Linux, where a backslash
  // is an ordinary character, so a Windows path would come back whole and the
  // project would be named "C:\Users\me\repo".
  const name = lastSegment(root) || "untitled";

  // A PROJECT IS A REPOSITORY, NOT A PATH, and until now only the resolver's
  // reading order said so -- creation took any absolute path at its word.
  //
  // What that cost, measured 2026-09-04: twelve of one account's twenty-one
  // projects were its client's per-prompt scratch directories
  // (`Documents/Codex/2026-09-02/yol`), plus the client's own installation
  // under `Program Files` and its binary cache. Four of the twelve hold real
  // tasks, which is the expensive half: a log written in a dated prompt folder
  // is not noise, it is work filed where nobody will look for it again.
  //
  // The evidence is deliberately weak and deliberately not a guess about the
  // path's SHAPE. Either the caller found a root marker at or above the
  // directory (`repo_root`), or it read a remote off it (`repo_url`). Both are
  // things only the machine with the disk can answer, both are already asked
  // for in `REMOTE_NOTE`, and both are filled in automatically by the stdio
  // process. A path with neither is a directory somebody happened to be
  // standing in.
  //
  // `create_project` is untouched: naming a project is a deliberate act, and
  // this rule is about what happens without one.
  if (!hints.repoRoot && !hints.repoUrl) throw new BadRequest(noEvidence(ref));

  const sameName = await projects.listByName(userId, name);
  if (sameName.length) {
    const paths = await knownPaths(userId);
    const withPaths = sameName.map(
      (project) => paths.get(project.id) ?? { project, paths: [] },
    );

    const adopted = adoptable(withPaths, root);
    if (adopted) {
      await remember(userId, adopted, ref, hints);
      return { project: adopted, created: false };
    }

    return {
      project: await create(userId, name, root, hints.repoUrl),
      created: true,
      warning: duplicateWarning(name, withPaths),
    };
  }

  return {
    project: await create(userId, name, root, hints.repoUrl),
    created: true,
    // Only on the call that registers the project, and only when there is no
    // remote to identify it by. The condition holds for 44 of 58 projects in
    // production, so saying it in every briefing would make it wallpaper --
    // this is the one moment it is news, and the one moment somebody is
    // looking at the project for the first time.
    //
    // The duplicate branch above says the same thing in more detail, so it is
    // not repeated here.
    ...(hints.repoUrl ? {} : { warning: noRemoteWarning(name) }),
  };
}

/**
 * Write down what this call taught us about the project, so the next one is
 * cheaper and the next machine is free.
 *
 * Two things get learned, and both matter:
 *
 * The path, because otherwise the match would depend on the remote arriving on
 * every single call -- one `get_context` that forgot `repo_url` would miss,
 * register a duplicate, and undo the whole point.
 *
 * The remote, because a project registered before any of this existed has none,
 * and nothing else will ever fill it in. Every project in the account that
 * predates this is in exactly that state: identifiable on the machine it was
 * created on and nowhere else. The first session that arrives with git access
 * is the chance to fix that, and it costs one write, once.
 */
async function remember(userId: number, project: Project, ref: string, hints: RepoHints) {
  if (!project.repo_url && hints.repoUrl)
    await projects.update(userId, project.id, { repo_url: scrubRemote(hints.repoUrl) });

  if (!isAbsolutePath(ref)) return;
  const root = normalisePath(
    hints.repoRoot && isAbsolutePath(hints.repoRoot) ? hints.repoRoot : ref,
  );
  const known = (await knownPaths(userId)).get(project.id)?.paths ?? [];
  if (known.some((p) => isInside(root, p))) return;
  await projectPaths.add(userId, project.id, root);
}

const create = async (userId: number, name: string, root: string, repoUrl?: string) =>
  projects.create(userId, {
    name,
    slug: await projects.nextFreeSlug(userId, name),
    root_path: root,
    repo_url: repoUrl ? scrubRemote(repoUrl) : null,
  });

/**
 * Why a directory was not turned into a project, and what to send instead.
 *
 * Written to be actionable by the thing that will read it, which is a model
 * mid-tool-call: it names the two parameters, says how to get each, and says
 * what to do if the directory really is not a repository. An error that only
 * says no teaches an agent to stop calling the tool.
 */
const noEvidence = (ref: string) =>
  `no repository at ${ref}. todox registers repositories, not directories, ` +
  `and nothing here says this path is one. Send \`repo_root\` -- the directory ` +
  `holding .git -- or \`repo_url\` from \`git remote get-url origin\`, and the ` +
  `same call will register it. If this is a scratch directory rather than a ` +
  `checkout, pass \`project\` to work in an existing project, or ` +
  `\`create_project\` to name one deliberately.`;

/**
 * Registered by its path, because there was no remote to register it by.
 *
 * Says what it costs rather than that it happened: `repo_url` is the only
 * identifier that means the same thing on a second computer, and without it
 * `adoptable()` will only match across OS families -- so two Macs, or two
 * Linux boxes, each get their own copy of the same repository and the history
 * splits. That is not theoretical here; it is what `merge_projects` exists to
 * undo.
 *
 * Written for the agent to relay, not to act on. A directory with no origin
 * cannot be given one from this side, and telling a model to run
 * `update_project` would have it invent a URL.
 */
const noRemoteWarning = (name: string) =>
  `"${name}" was registered by its path, because this directory has no git remote. ` +
  `todox identifies a project by its remote first, so opening this same repo on a ` +
  `second computer will register it again and split the history. If it is a checkout ` +
  `that simply has no origin yet, adding one and reopening is the fix; tell the ` +
  `developer rather than guessing a URL.`;

const duplicateWarning = (
  name: string,
  existing: { project: Project; paths: string[] }[],
) => {
  const others = existing.map((e) => e.project.slug).join(", ");
  return (
    `You already have a project called "${name}" (${others}), and this path is on the ` +
    `same kind of machine, so it was registered separately rather than assumed to be ` +
    `the same repo. If it is the same one, merge them: ` +
    `merge_projects(from:"<the duplicate>", into:"<the original>", confirm:"<the duplicate>"). ` +
    `Setting repo_url on both with update_project stops this happening again.`
  );
};
