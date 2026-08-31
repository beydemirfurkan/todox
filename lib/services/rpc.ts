import type { ContextKind, EntryKind, Status } from "../constants";
import * as apiTokensRepo from "../repositories/api-tokens";
import * as contextsRepo from "../repositories/contexts";
import * as entriesRepo from "../repositories/entries";
import * as projectsRepo from "../repositories/projects";
import * as refsRepo from "../repositories/refs";
import * as tasksRepo from "../repositories/tasks";
import { briefing } from "./briefing";
import { fileContext } from "./file-context";
import { BadRequest } from "./errors";
import {
  assertContext,
  assertEntry,
  assertProject,
  assertProjectAccess,
  assertRef,
  assertRefs,
  assertTask,
} from "./ownership";
import { merge as mergeProjects } from "./project-merge";
import { mustResolve, resolveOrCreate } from "./project-resolver";
import { activityReport } from "./reports";
import { isMethod, parseParams, type MethodName } from "./rpc-schemas";
import { search } from "./search";
import * as taskService from "./task-service";
import { isAbsolutePath, normalisePath, scrubRemote } from "../util/paths";
import { resolvePeriod, type PeriodName } from "../util/time";
import { hashToken } from "../util/tokens";

/**
 * The agent-facing surface, in one place.
 *
 * The MCP server used to talk to the database directly. With accounts that is
 * no longer possible -- an agent runs on the developer's machine while the data
 * lives on the server -- so every operation is a method here, reached over
 * HTTP with a per-user token. One code path, no local/remote drift.
 *
 * Every handler receives the resolved `userId`; none of them accept one from
 * the caller. `token` is only set on transports that already authenticated
 * one (the MCP route) and is consumed by `recordClientInfo` to identify the
 * caller without re-reading the row.
 */
export type RpcContext = { userId: number; token?: string };

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

/*
 * The shape stays the same truncated or not -- a result that changes type
 * under load is a result an agent cannot parse with any confidence -- but the
 * cut moved into SQL. Slicing here read the project's whole backlog to hand
 * back two hundred rows.
 */

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
    p: {
      name: string;
      slug?: string;
      root_path?: string;
      repo_url?: string;
      summary?: string;
    },
  ) =>
    projectsRepo.create(userId, {
      ...p,
      // Normalised the way auto-registration normalises it. These two used to
      // disagree, and the stored form is now something resolution matches on.
      root_path: p.root_path ? normalisePath(p.root_path) : undefined,
      repo_url: p.repo_url ? scrubRemote(p.repo_url) : undefined,
      slug: await projectsRepo.nextFreeSlug(userId, p.slug ?? p.name),
    }),

  updateProject: async (
    { userId },
    p: {
      project: string;
      name?: string;
      root_path?: string;
      repo_url?: string;
      summary?: string;
    },
  ) => {
    const { project, ...patch } = p;
    const found = await mustResolve(userId, project);
    // `mustResolve` answers for a member too, but the project row belongs to
    // its owner: without this the UPDATE below matches nothing and the
    // unchanged row goes back as if it had been written. The web path has
    // always asserted here; this surface had not.
    await assertProject(userId, found.id);
    if (patch.root_path) patch.root_path = normalisePath(patch.root_path);
    if (patch.repo_url) patch.repo_url = scrubRemote(patch.repo_url);
    await projectsRepo.update(userId, found.id, patch);
    return projectsRepo.byId(userId, found.id);
  },

  deleteProject: async ({ userId }, p: { project: string; confirm: string }) => {
    const found = await mustResolve(userId, p.project);
    // Same reason as `updateProject`, one degree worse: the DELETE is scoped
    // to the owner, so a member's call removed nothing and still came back
    // with `{ deleted: <slug>, tasks_removed: N }`.
    await assertProject(userId, found.id);
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

  mergeProjects: ({ userId }, p: { from: string; into: string; confirm: string }) =>
    mergeProjects(userId, p),

  getContext: async (
    { userId },
    p: {
      project?: string;
      cwd?: string;
      create_if_missing?: boolean;
      focus?: string;
      repo_root?: string;
      repo_url?: string;
    },
  ) => {
    const which = pickRef(p);
    // The first session in a new repo is the case this product exists for, and
    // it used to be the one that failed: `create_if_missing` defaulted to false
    // and nothing in the instructions mentioned it, so the agent got an error
    // and no stated way forward. A path is an unambiguous "this repo"; a slug
    // that matches nothing is still a typo worth reporting.
    const create = p.create_if_missing ?? isAbsolutePath(which);

    const hints = { repoRoot: p.repo_root, repoUrl: p.repo_url };

    if (create) {
      const { project, created, warning } = await resolveOrCreate(userId, which, hints);
      return {
        project_created: created,
        ...(warning ? { warning } : {}),
        ...(await briefing(userId, project, p.focus)),
      };
    }
    return briefing(userId, await mustResolve(userId, which, hints), p.focus);
  },

  listTasks: async ({ userId }, p: { project?: string; cwd?: string; status?: string }) => {
    const { rows, total } = await tasksRepo.pageByProject(
      (await mustResolve(userId, pickRef(p))).id,
      (p.status ?? "open") as never,
      PAGE,
    );
    return { tasks: rows, omitted: Math.max(0, total - rows.length) };
  },

  getTask: async ({ userId }, p: { task_id: number }) => {
    await assertTask(userId, p.task_id);
    const [task, log, refs] = await Promise.all([
      tasksRepo.byId(p.task_id),
      // The newest end of a long log is the useful end; the rest is history the
      // handoff already summarises. Cut in SQL: the slice was applied to a read
      // of the whole log, so the ceiling bounded the answer and not the cost.
      entriesRepo.pageByTask(p.task_id, PAGE),
      refsRepo.listByTask(p.task_id),
    ]);
    return {
      ...task!,
      entries: log.rows,
      ...(log.rows.length < log.total ? { entries_omitted: log.total - log.rows.length } : {}),
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
      repo_url?: string;
      model?: string;
    },
  ) => {
    const hints = { repoRoot: p.repo_root, repoUrl: p.repo_url };
    // An explicit project must already exist; a cwd may create one. That
    // asymmetry stops a typo'd slug from silently spawning a junk project.
    const { project, created, warning } = p.project
      ? { project: await mustResolve(userId, p.project, hints), created: false, warning: undefined }
      : await resolveOrCreate(userId, pickRef({ cwd: p.cwd }), hints);

    const task = await taskService.create({
      project_id: project.id,
      title: p.title,
      body: p.body,
      status: p.status,
      priority: p.priority,
      files: p.files,
      model: p.model,
      // From the resolved token, never from the payload -- see the note at the
      // top of this file. `rpc-schemas.ts` has no field for it and must not.
      user_id: userId,
    });

    return {
      task,
      project: { slug: project.slug, name: project.name, root_path: project.root_path },
      project_created: created,
      ...(warning ? { warning } : {}),
      ...(created
        ? {
            next: `Registered a new project "${project.slug}". Call update_project with a one-paragraph summary and repo_url set to \`git remote get-url origin\` — the summary is what a cold session reads, and the remote is the only name this project has on any machine but this one.`,
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
    return taskService.update(task_id, patch, { model, user_id: userId });
  },

  logEntry: async (
    { userId },
    p: {
      task_id: number;
      kind: EntryKind;
      body: string;
      author?: string;
      answers_entry_id?: number;
      model?: string;
    },
  ) => {
    await assertTask(userId, p.task_id);
    return taskService.addEntry({ ...p, user_id: userId });
  },

  linkFiles: async (
    { userId },
    p: {
      task_id?: number;
      context_id?: number;
      paths: { path: string; note?: string; hash?: string | null }[];
    },
  ) => {
    // The schema guarantees exactly one, so the branch is which assert to run
    // rather than whether to run one. Both repository calls take no account id.
    if (p.task_id !== undefined) {
      await assertTask(userId, p.task_id);
      return refsRepo.link({ task_id: p.task_id, paths: p.paths });
    }
    await assertContext(userId, p.context_id!);
    return refsRepo.link({ context_id: p.context_id, paths: p.paths });
  },

  reportRefs: async ({ userId }, p: { refs: { id: number; hash: string | null }[] }) => {
    // Each row is proved to be the caller's before anything is written; the
    // ids come off a payload we handed out, but that is not a reason to trust
    // them coming back. One query for the lot: the schema allows five hundred
    // per call, and one join each is five hundred of them at once against a
    // pool of ten.
    await assertRefs(userId, p.refs.map((r) => r.id));
    // What was written, not what was sent. A ref unlinked between the check
    // above and the write matches nothing, and reporting the caller's own count
    // told an agent its staleness report had landed when it had not.
    const recorded = await refsRepo.recordCheck(p.refs);
    return { recorded };
  },

  unlinkRef: async ({ userId }, p: { ref_id: number }) => {
    await assertRef(userId, p.ref_id);
    const removed = await refsRepo.unlink(p.ref_id);
    return { unlinked: removed > 0 };
  },

  acceptRef: async ({ userId }, p: { ref_id: number }) => {
    await assertRef(userId, p.ref_id);
    // `acceptSeen` re-baselines onto what an agent last reported, so it does
    // nothing at all until one has looked. Saying which of the two happened
    // matters: a silent no-op here reads as "warning cleared", and the next
    // briefing carrying the same warning is then the confusing part.
    const accepted = await refsRepo.acceptSeen(p.ref_id);
    return accepted > 0
      ? { accepted: true }
      : {
          accepted: false,
          reason:
            "nothing has been reported for this file yet, so there is no state to accept — hash it and send report_file_hashes first",
        };
  },

  getFileContext: async ({ userId }, p: { path: string; project?: string; cwd?: string }) => {
    // Resolution, not creation: asking what is known about a file in a repo
    // todox has never seen is a question with an answer -- nothing -- and
    // registering a project as a side effect of a read would be a surprise.
    const project = await mustResolve(userId, pickRef({ project: p.project, cwd: p.cwd }));
    return fileContext(userId, project, p.path);
  },

  getContextNote: async ({ userId }, p: { context_id: number }) => {
    // Same guard as the write paths, for the same reason: `contexts.byId`
    // takes no user id, so this is the only thing between an id off the wire
    // and somebody else's note. A foreign one answers 404, never 403.
    await assertContext(userId, p.context_id);
    return contextsRepo.byId(p.context_id);
  },

  addContext: async (
    { userId },
    p: { project?: string; cwd?: string; kind: ContextKind; title: string; body: string },
  ) => {
    const ref = p.project ?? p.cwd;
    const projectId = ref ? (await mustResolve(userId, ref)).id : null;
    // A note inside a shared project, not the project row: a member who can
    // already open tasks and log entries here can write one. This asserted
    // ownership, which left a collaborator able to record work but not what
    // the work decided.
    if (projectId) await assertProjectAccess(userId, projectId);
    return contextsRepo.create({
      user_id: userId,
      project_id: projectId,
      kind: p.kind,
      title: p.title,
      body: p.body,
    });
  },

  updateContext: async (
    { userId },
    p: { context_id: number; kind?: ContextKind; title?: string; body?: string },
  ) => {
    const { context_id: id, ...patch } = p;
    // `contexts.update` takes no user id -- this is the only thing standing
    // between a context id off the wire and somebody else's note.
    await assertContext(userId, id);
    await contextsRepo.update(id, patch);
    return contextsRepo.byId(id);
  },

  deleteContext: async ({ userId }, p: { context_id: number }) => {
    await assertContext(userId, p.context_id);
    const removed = await contextsRepo.remove(p.context_id);
    return { deleted: removed > 0 };
  },

  deleteEntry: async ({ userId }, p: { entry_id: number }) => {
    await assertEntry(userId, p.entry_id);
    const removed = await entriesRepo.remove(p.entry_id);
    return { deleted: removed > 0 };
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

  recordClientInfo: async (
    { token },
    p: { name: string; version?: string; model?: string },
  ) => {
    // The HTTP RPC route can hit this with `token` undefined; the capture
    // side already authenticated, so refuse here rather than recording a
    // useless empty row.
    if (!token) throw new BadRequest("missing token");
    await apiTokensRepo.recordClientUse(hashToken(token), {
      name: p.name,
      version: p.version ?? "unknown",
      seenAt: new Date().toISOString(),
    });
    return { ok: true };
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
