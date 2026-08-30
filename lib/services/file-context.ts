import * as contextsRepo from "../repositories/contexts";
import * as entriesRepo from "../repositories/entries";
import * as projectPathsRepo from "../repositories/project-paths";
import * as refsRepo from "../repositories/refs";
import * as tasksRepo from "../repositories/tasks";
import type { Project, Ref } from "../types";
import { isAbsolutePath, normalisePath, relativeTo } from "../util/paths";

/**
 * What todox already knows about one file.
 *
 * The question a coding agent asks before it edits anything, and the one thing
 * in this schema that no competing memory layer can answer: they store what was
 * said, and todox stores what it was said *about*. `refs` has held the path on
 * every linked file since the first commit -- and every read went in by
 * `task_id`, `context_id` or `id`, so the column was write-only and the
 * question had no answer.
 *
 * A service rather than a repository because it crosses four tables to compose
 * one answer, and repositories never call each other.
 */

/** Entry kinds worth carrying here, and how many of each per task. */
const KINDS = ["dead_end", "decision"] as const;
const PER_KIND = 3;

export type FileContext = {
  /** What was actually matched on, repo-relative. */
  path: string;
  project: { slug: string; name: string };
  tasks: {
    id: number;
    title: string;
    status: string;
    priority: number;
    /** Why this file was attached to this task, if whoever linked it said. */
    note: string | null;
    dead_ends: string[];
    decisions: string[];
  }[];
  notes: { id: number; kind: string; title: string; body: string; note: string | null }[];
};

/**
 * Every absolute path this project could have stored for one repo-relative file.
 *
 * A file has as many absolute paths as the repo has machines, and `refs` stores
 * whichever one the agent that linked it was looking at. Matching the string
 * the caller sent would answer nothing the first time a project is opened on a
 * second computer -- the same failure `repo_url` exists to prevent for projects,
 * one level down.
 *
 * So the path is folded to its repo-relative form and expanded back over every
 * root the project is known by. Equality on a known set, never a suffix match:
 * `LIKE '%/auth.ts'` cannot use an index, and it answers a question about
 * `lib/auth.ts` with `vendor/lib/auth.ts`.
 */
function candidates(roots: string[], path: string): { relative: string; paths: string[] } {
  const wanted = normalisePath(path);

  // A relative path is already the shared name; an absolute one has to be cut
  // down to it by whichever root contains it. `find` rather than a filter: the
  // roots of one project do not nest, so at most one can match.
  const relative = isAbsolutePath(wanted)
    ? (roots.map((r) => relativeTo(wanted, r)).find((r) => r !== null) ?? null)
    : wanted;

  // Outside every known root, and not relative either. Nothing can be folded,
  // so the literal is all there is to go on -- honest, and it still matches for
  // the machine that linked it.
  if (relative === null || relative === "") return { relative: wanted, paths: [wanted] };

  return {
    relative,
    // An absolute path the caller sent stays in the set: a project can be open
    // at a root `project_paths` has not learned yet, and dropping it would
    // answer "nothing known" about a file linked minutes ago. A relative one
    // does not -- `refs` stores absolute paths, so searching for the bare
    // `lib/auth.ts` is a parameter that can never match anything.
    paths: [
      ...new Set([
        ...roots.map((r) => `${r}/${relative}`),
        ...(isAbsolutePath(wanted) ? [wanted] : []),
      ]),
    ],
  };
}

/**
 * Refs the caller is allowed to see, out of a set matched on path alone.
 *
 * `listByPaths` is deliberately unscoped -- `refs` has no project column, and
 * giving a repository one would mean joining `tasks` and `contexts` from
 * inside it. The narrowing happens here instead, against rows already loaded,
 * and it is the only thing standing between a path and another account's work.
 */
function mine<T extends { id: number; project_id: number | null; user_id?: number | null }>(
  rows: T[],
  projectId: number,
  userId: number,
  accountWideAllowed: boolean,
): Map<number, T> {
  const kept = rows.filter(
    (r) =>
      r.project_id === projectId ||
      (accountWideAllowed && r.project_id === null && r.user_id === userId),
  );
  return new Map(kept.map((r) => [r.id, r]));
}

export async function fileContext(
  userId: number,
  project: Project,
  path: string,
): Promise<FileContext> {
  const extra = await projectPathsRepo.listFor(userId, project.id);
  const roots = [...new Set([project.root_path, ...extra.map((p) => p.path)])]
    .filter((r): r is string => Boolean(r))
    .map(normalisePath);

  const { relative, paths } = candidates(roots, path);
  const refs = await refsRepo.listByPaths(paths);

  const idsOf = (pick: (r: Ref) => number | null) => [
    ...new Set(refs.map(pick).filter((id): id is number => id !== null)),
  ];
  const taskIds = idsOf((r) => r.task_id);
  const contextIds = idsOf((r) => r.context_id);

  const [taskRows, noteRows, logs] = await Promise.all([
    tasksRepo.byIds(taskIds),
    contextsRepo.byIds(contextIds),
    // Dead ends first, because they are the reason to ask before editing.
    entriesRepo.listByTasksPerKind(taskIds, KINDS, PER_KIND),
  ]);

  // Tasks belong to exactly one project; a context note may also be
  // account-wide, and those are the standing rules that apply everywhere.
  const tasks = mine(taskRows, project.id, userId, false);
  const notes = mine(noteRows, project.id, userId, true);

  // One ref per row, so a file linked to the same task twice cannot list it
  // twice. `refs` orders newest first, and the first ref is the one whose
  // `note` is worth showing.
  const seen = new Set<string>();
  const out: FileContext = { path: relative, project: { slug: project.slug, name: project.name }, tasks: [], notes: [] };

  for (const ref of refs) {
    const task = ref.task_id === null ? undefined : tasks.get(ref.task_id);
    if (task && !seen.has(`t${task.id}`)) {
      seen.add(`t${task.id}`);
      const log = logs.get(task.id) ?? [];
      const bodies = (kind: string) => log.filter((e) => e.kind === kind).map((e) => e.body);
      out.tasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        note: ref.note,
        dead_ends: bodies("dead_end"),
        decisions: bodies("decision"),
      });
    }

    const note = ref.context_id === null ? undefined : notes.get(ref.context_id);
    if (note && !seen.has(`c${note.id}`)) {
      seen.add(`c${note.id}`);
      out.notes.push({
        id: note.id,
        kind: note.kind,
        title: note.title,
        // In full, unlike the briefing's ceiling: one file's standing rules are
        // few, and the agent asked about this file specifically.
        body: note.body,
        note: ref.note,
      });
    }
  }

  return out;
}
