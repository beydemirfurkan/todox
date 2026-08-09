import type { ContextKind, EntryKind, Status } from "../constants";
import * as contextsRepo from "../repositories/contexts";
import * as entriesRepo from "../repositories/entries";
import * as projectsRepo from "../repositories/projects";
import * as refsRepo from "../repositories/refs";
import * as tasksRepo from "../repositories/tasks";
import { briefing } from "./briefing";
import { assertProject, assertTask } from "./ownership";
import { mustResolve, resolveOrCreate } from "./project-resolver";
import { activityReport } from "./reports";
import { search } from "./search";
import * as taskService from "./task-service";
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
  if (!ref) throw new Error("pass either `project` or `cwd`");
  return ref;
};

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

  getContext: async ({ userId }, p: { project: string; create_if_missing?: boolean }) => {
    if (p.create_if_missing) {
      const { project, created } = await resolveOrCreate(userId, p.project);
      return { project_created: created, ...(await briefing(userId, project)) };
    }
    return briefing(userId, await mustResolve(userId, p.project));
  },

  listTasks: async ({ userId }, p: { project?: string; cwd?: string; status?: string }) =>
    tasksRepo.listByProject(
      (await mustResolve(userId, pickRef(p))).id,
      p.status as never,
    ),

  getTask: async ({ userId }, p: { task_id: number }) => {
    await assertTask(userId, p.task_id);
    const [task, entries, refs] = await Promise.all([
      tasksRepo.byId(p.task_id),
      entriesRepo.listByTask(p.task_id),
      refsRepo.listByTask(p.task_id),
    ]);
    return {
      ...task!,
      entries,
      files: refs.map((r) => ({
        id: r.id,
        path: r.path,
        note: r.note,
        status: refsRepo.freshness(r),
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
      files?: string[];
      model?: string;
    },
  ) => {
    // An explicit project must already exist; a cwd may create one. That
    // asymmetry stops a typo'd slug from silently spawning a junk project.
    const { project, created } = p.project
      ? { project: await mustResolve(userId, p.project), created: false }
      : await resolveOrCreate(userId, pickRef({ cwd: p.cwd }));

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
    p: { task_id: number; paths: { path: string; note?: string }[] },
  ) => {
    await assertTask(userId, p.task_id);
    return refsRepo.link({ task_id: p.task_id, paths: p.paths });
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
    p: { period?: PeriodName; from?: string; to?: string; project?: string },
  ) => {
    const window = resolvePeriod(p.period ?? "today", { from: p.from, to: p.to });
    const projectId = p.project ? (await mustResolve(userId, p.project)).id : undefined;
    return activityReport(userId, window, { projectId });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, (ctx: RpcContext, params: any) => unknown> as unknown as Record<
  string,
  Handler
>;

export type MethodName = keyof typeof methods;

export const isMethod = (name: string): name is string & MethodName =>
  Object.hasOwn(methods, name);

export function invoke(ctx: RpcContext, method: string, params: unknown) {
  if (!isMethod(method)) throw new Error(`unknown method "${method}"`);
  return methods[method](ctx, (params ?? {}) as Record<string, never>);
}
