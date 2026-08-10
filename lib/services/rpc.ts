import type { ContextKind, EntryKind, Status } from "../constants";
import * as contextsRepo from "../repositories/contexts";
import * as entriesRepo from "../repositories/entries";
import * as projectsRepo from "../repositories/projects";
import * as refsRepo from "../repositories/refs";
import * as tasksRepo from "../repositories/tasks";
import { briefing } from "./briefing";
import { BadRequest } from "./errors";
import { assertProject, assertRef, assertTask } from "./ownership";
import { mustResolve, resolveOrCreate } from "./project-resolver";
import { activityReport } from "./reports";
import { isMethod, parseParams, type MethodName } from "./rpc-schemas";
import { search } from "./search";
import * as taskService from "./task-service";
import { isAbsolutePath } from "../util/paths";
import { resolvePeriod, type PeriodName } from "../util/time";

/**
 * The agent-facing surface, in one place.
 *
 * The MCP server used to talk to the database directly. With accounts that is
 * no longer possible -- an agent runs on the developer's machine while the data
 * lives on the server -- so every operation is a method here, reached over
 * HTTP with a per-user token. One code path, no local/remote drift.
 *
 * Every handler receives the resolved `userId`; none of them accept one from
 * the caller.
 */
export type RpcContext = { userId: number };

type Handler = (ctx: RpcContext, params: Record<string, never>) => Promise<unknown>;

const pickRef = (p: { project?: string; cwd?: string }) => {
  const ref = p.project ?? p.cwd;
  if (!ref) throw new BadRequest("pass either `project` or `cwd`");
  return ref;
};

/**
 * How much of a list one call will hand back.
 *
 * Every result here was unbounded, and these are the calls an agent is told to
 * make first. A tool result is spent context: a project with a thousand tasks,
 * bodies included, is an answer nobody can afford to read.
 */
const PAGE = 200;

/** Always the same shape, truncated or not: a result that changes type under
 *  load is a result an agent cannot parse with any confidence. */
const capped = <T>(rows: T[]) => ({
  tasks: rows.slice(0, PAGE),
  omitted: Math.max(0, rows.length - PAGE),
});

export const methods = {
  listProjects: async ({ userId }) => {
    const [rows, counts] = await Promise.all([
      projectsRepo.list(userId),
      tasksRepo.countsByProject(userId),
    ]);
    return {
      projects: rows.map((p) => ({
        slug: p.slug,
        name: p.name,
        root_path: p.root_path,
        summary: p.summary,
        shared: Boolean(p.share_token),
        counts: counts.map.get(p.id) ?? counts.empty,
      })),
    };
  },

  createProject: async (
    { userId },
    p: { name: string; slug?: string; root_path?: string; summary?: string },
  ) =>
    projectsRepo.create(userId, {
      ...p,
      slug: await projectsRepo.nextFreeSlug(userId, p.slug ?? p.name),
    }),

  updateProject: async (
    { userId },
    p: { project: string; name?: string; root_path?: string; summary?: string },
  ) => {
    const { project, ...patch } = p;
    const found = await mustResolve(userId, project);
    await projectsRepo.update(userId, found.id, patch);
    return projectsRepo.byId(userId, found.id);
  },

  deleteProject: async ({ userId }, p: { project: string; confirm: string }) => {
    const found = await mustResolve(userId, p.project);
    // Case-insensitive, like the account page's own confirmation: the point is
    // to stop this happening by reflex, not to test anybody's typing.
    if (p.confirm.trim().toLowerCase() !== found.slug.toLowerCase())
      throw new BadRequest(
        `confirm must be the project's slug, "${found.slug}", to delete it and everything in it`,
      );
    const counts = await tasksRepo.counts(found.id);
    await projectsRepo.remove(userId, found.id);
    return { deleted: found.slug, tasks_removed: Object.values(counts).reduce((a, b) => a + b, 0) };
  },

  getContext: async (
    { userId },
    p: { project?: string; cwd?: string; create_if_missing?: boolean; repo_root?: string },
  ) => {
    const which = pickRef(p);
    // The first session in a new repo is the case this product exists for, and
    // it used to be the one that failed: `create_if_missing` defaulted to false
    // and nothing in the instructions mentioned it, so the agent got an error
    // and no stated way forward. A path is an unambiguous "this repo"; a slug
    // that matches nothing is still a typo worth reporting.
    const create = p.create_if_missing ?? isAbsolutePath(which);

    if (create) {
      const { project, created } = await resolveOrCreate(userId, which, p.repo_root);
      return { project_created: created, ...(await briefing(userId, project)) };
    }
    return briefing(userId, await mustResolve(userId, which));
  },

  listTasks: async ({ userId }, p: { project?: string; cwd?: string; status?: string }) => {
    const rows = await tasksRepo.listByProject(
      (await mustResolve(userId, pickRef(p))).id,
      p.status as never,
    );
    return capped(rows);
  },

  getTask: async ({ userId }, p: { task_id: number }) => {
    await assertTask(userId, p.task_id);
    const [task, entries, refs] = await Promise.all([
      tasksRepo.byId(p.task_id),
      entriesRepo.listByTask(p.task_id),
      refsRepo.listByTask(p.task_id),
    ]);
    // The newest end of a long log is the useful end; the rest is history the
    // handoff already summarises.
    const shown = entries.slice(-PAGE);
    return {
      ...task!,
      entries: shown,
      ...(shown.length < entries.length
        ? { entries_omitted: entries.length - shown.length }
        : {}),
      files: refs.map((r) => ({
        id: r.id,
        path: r.path,
        note: r.note,
        hash: r.hash,
        status: refsRepo.freshness(r),
        checked_at: r.checked_at,
      })),
    };
  },

  createTask: async (
    { userId },
    p: {
      cwd?: string;
      project?: string;
      title: string;
      body?: string;
      status?: Status;
      priority?: number;
      files?: { path: string; hash?: string | null }[];
      repo_root?: string;
      model?: string;
    },
  ) => {
    // An explicit project must already exist; a cwd may create one. That
    // asymmetry stops a typo'd slug from silently spawning a junk project.
    const { project, created } = p.project
      ? { project: await mustResolve(userId, p.project), created: false }
      : await resolveOrCreate(userId, pickRef({ cwd: p.cwd }), p.repo_root);

    const task = await taskService.create({
      project_id: project.id,
      title: p.title,
      body: p.body,
      status: p.status,
      priority: p.priority,
      files: p.files,
      model: p.model,
    });

    return {
      task,
      project: { slug: project.slug, name: project.name, root_path: project.root_path },
      project_created: created,
      ...(created
        ? {
            next: `Registered a new project "${project.slug}". Call update_project with a one-paragraph summary so the next cold session knows what this repo is.`,
          }
        : {}),
    };
  },

  updateTask: async (
    { userId },
    p: {
      task_id: number;
      title?: string;
      body?: string;
      status?: Status;
      priority?: number;
      model?: string;
    },
  ) => {
    await assertTask(userId, p.task_id);
    const { task_id, model, ...patch } = p;
    return taskService.update(task_id, patch, { model });
  },

  logEntry: async (
    { userId },
    p: { task_id: number; kind: EntryKind; body: string; author?: string; model?: string },
  ) => {
    await assertTask(userId, p.task_id);
    return taskService.addEntry(p);
  },

  linkFiles: async (
    { userId },
    p: { task_id: number; paths: { path: string; note?: string; hash?: string | null }[] },
  ) => {
    await assertTask(userId, p.task_id);
    return refsRepo.link({ task_id: p.task_id, paths: p.paths });
  },

  reportRefs: async ({ userId }, p: { refs: { id: number; hash: string | null }[] }) => {
    // Each row is proved to be the caller's before anything is written; the
    // ids come off a payload we handed out, but that is not a reason to trust
    // them coming back.
    await Promise.all(p.refs.map((r) => assertRef(userId, r.id)));
    await refsRepo.recordCheck(p.refs);
    return { recorded: p.refs.length };
  },

  addContext: async (
    { userId },
    p: { project?: string; cwd?: string; kind: ContextKind; title: string; body: string },
  ) => {
    const ref = p.project ?? p.cwd;
    const projectId = ref ? (await mustResolve(userId, ref)).id : null;
    if (projectId) await assertProject(userId, projectId);
    return contextsRepo.create({
      user_id: userId,
      project_id: projectId,
      kind: p.kind,
      title: p.title,
      body: p.body,
    });
  },

  search: ({ userId }, p: { query: string; limit?: number }) =>
    search(userId, p.query, p.limit ?? 30),

  activityReport: async (
    { userId },
    p: { period?: PeriodName; from?: string; to?: string; project?: string; tz?: string },
  ) => {
    // The agent runs on the developer's machine, so it is the one that knows
    // what "today" means to them. The server would only ever answer UTC.
    const window = resolvePeriod(p.period ?? "today", {
      from: p.from,
      to: p.to,
      tz: p.tz,
    });
    const projectId = p.project ? (await mustResolve(userId, p.project)).id : undefined;
    return activityReport(userId, window, { projectId });
  },
  // Keyed by MethodName rather than string, so a handler without a schema in
  // rpc-schemas.ts -- or a schema without a handler -- fails to compile. The
  // two lists have to stay in step; that is the whole point of validating here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<MethodName, (ctx: RpcContext, params: any) => unknown> as unknown as Record<
  MethodName,
  Handler
>;

export type { MethodName };

/**
 * Params are validated here, not trusted here.
 *
 * The cast below is the only thing standing between the handler signatures and
 * the JSON on the wire, and a cast does nothing at runtime -- so `parseParams`
 * has to run first. Without it `updateTask`'s `...patch` collects arbitrary
 * caller-chosen keys, which the repositories then have to defend against on
 * their own.
 */
export async function invoke(ctx: RpcContext, method: string, params: unknown) {
  if (!isMethod(method)) throw new BadRequest(`unknown method "${method}"`);
  const clean = parseParams(method, params);
  return methods[method](ctx, clean as Record<string, never>);
}
