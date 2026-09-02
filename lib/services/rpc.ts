import type { ContextKind, EntryKind, Status } from "../constants";
import * as apiTokensRepo from "../repositories/api-tokens";
import * as contextsRepo from "../repositories/contexts";
import * as entriesRepo from "../repositories/entries";
import * as observationsRepo from "../repositories/observations";
import * as projectsRepo from "../repositories/projects";
import * as refsRepo from "../repositories/refs";
import * as tasksRepo from "../repositories/tasks";
import * as toolUsage from "../repositories/tool-usage";
import { briefing } from "./briefing";
import { fileContext } from "./file-context";
import { BadRequest } from "./errors";
import { addContext } from "./context-service";
import {
  assertContext,
  assertEntry,
  assertObservation,
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
  /**
   * The projects that hold something, and a count of the ones that do not.
   *
   * `get_context` registers a project for whatever directory an agent happens
   * to be working in, which is a deliberate convenience -- it is why capturing
   * a task works on the first try instead of erroring out. The cost is that a
   * directory somebody opened an editor in once becomes a row, and in
   * production 18 of 58 projects had never been given a task or a note. A list
   * that is two-thirds noise is a list an agent stops reading.
   *
   * Nothing is deleted and nothing is hidden from the resolver: an empty
   * project still answers to its slug and its path, so an agent that lands in
   * that directory again finds it. What changes is only what a caller asking
   * "what am I working on" is shown.
   *
   * A note without a task still counts as work, which is not a detail -- five
   * projects were in exactly that state, and they are the ones holding
   * standing rules the briefing reads. Defining "empty" as "no tasks" would
   * have hidden the notes along with them.
   *
   * Said out loud rather than trimmed in silence, the way `open_tasks_omitted`
   * and `observations_omitted` are: a caller that cannot see the number cannot
   * tell an empty account from a filtered one.
   */
  listProjects: async ({ userId }) => {
    const [rows, counts, withNotes] = await Promise.all([
      projectsRepo.list(userId),
      tasksRepo.countsByProject(userId),
      contextsRepo.projectIdsWithNotes(userId),
    ]);

    const carries = rows.filter((p) => counts.map.has(p.id) || withNotes.has(p.id));

    return {
      projects: carries.map((p) => ({
        slug: p.slug,
        name: p.name,
        root_path: p.root_path,
        summary: p.summary,
        shared: Boolean(p.share_token),
        counts: counts.map.get(p.id) ?? counts.empty,
      })),
      empty_projects_omitted: rows.length - carries.length,
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
      from_observation_id?: number;
      model?: string;
    },
  ) => {
    await assertTask(userId, p.task_id);
    // A second gate, because `from_observation_id` names a row in a different
    // table: ownership of the task says nothing about ownership of the
    // observation, and marking somebody else's handled would quietly remove it
    // from a briefing that was not this caller's.
    if (p.from_observation_id != null) await assertObservation(userId, p.from_observation_id);
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
    p: {
      project?: string;
      cwd?: string;
      kind: ContextKind;
      title: string;
      body: string;
      from_observation_id?: number;
    },
  ) => {
    const ref = p.project ?? p.cwd;
    const projectId = ref ? (await mustResolve(userId, ref)).id : null;
    // A note inside a shared project, not the project row: a member who can
    // already open tasks and log entries here can write one. This asserted
    // ownership, which left a collaborator able to record work but not what
    // the work decided.
    if (projectId) await assertProjectAccess(userId, projectId);
    // The observation is a row in another table, so reaching the project says
    // nothing about reaching it. See `logEntry` above.
    if (p.from_observation_id != null) await assertObservation(userId, p.from_observation_id);
    return addContext({
      user_id: userId,
      project_id: projectId,
      kind: p.kind,
      title: p.title,
      body: p.body,
      from_observation_id: p.from_observation_id,
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

  search: async (
    { userId },
    p: { query: string; project?: string; kinds?: string[]; limit?: number },
  ) => {
    // Resolved here rather than inside `search`, which takes ids: a slug that
    // matches nothing must answer 404 rather than quietly searching everything,
    // which is what an unresolved filter would do.
    const projectId = p.project ? (await mustResolve(userId, p.project)).id : null;
    return search(userId, p.query, p.limit ?? 30, { projectId, kinds: p.kinds });
  },

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

  /**
   * What a session did to the tree. Written by the process that can see it,
   * never by the model -- there is no tool for this, for the same reason there
   * is none for `recordClientInfo`.
   *
   * The reply is the interesting half: it hands back the last `head_sha` this
   * account recorded for the project, so the *next* session can tell what the
   * last one never got round to reporting. That is the whole crash-recovery
   * story, and it is deliberately at the start of a session rather than the end
   * of one -- a process being killed is exactly when a final write does not
   * happen.
   *
   * `mustResolve`, never `resolveOrCreate`: an unregistered directory is one
   * nobody has asked todox to remember, and registering a project as a *side
   * effect* of automatic capture would mean opening an editor anywhere quietly
   * created one. This is the write path with no human in it, so it is the last
   * one that should be able to create anything. If the project is not there
   * the call fails, the carrier swallows it, and nothing is observed -- which
   * is the correct amount of nothing.
   */
  recordObservation: async (
    { userId },
    p: {
      project?: string;
      cwd?: string;
      session_id: string;
      client?: string;
      branch?: string;
      base_sha?: string;
      head_sha?: string;
      commits: number;
      files_changed: number;
      commit_subjects?: string;
      started_at?: string;
    },
  ) => {
    const project = await mustResolve(userId, pickRef({ project: p.project, cwd: p.cwd }));
    await assertProjectAccess(userId, project.id);

    // Read before the write: afterwards it would answer with the row this call
    // just wrote, which is this session's own HEAD and tells the next session
    // nothing.
    const previous = await observationsRepo.lastHeadFor(userId, project.id);

    await observationsRepo.record({
      user_id: userId,
      project_id: project.id,
      session_id: p.session_id,
      client: p.client ?? null,
      branch: p.branch ?? null,
      base_sha: p.base_sha ?? null,
      head_sha: p.head_sha ?? null,
      commits: p.commits,
      files_changed: p.files_changed,
      commit_subjects: p.commit_subjects ?? null,
      started_at: p.started_at,
    });

    // Retention, swept on a write path because this deployment has no
    // scheduler -- the same shape `auth.ts` uses to sweep rate limits on
    // login. This call happens at most a handful of times per session.
    await observationsRepo.purgeExpired();

    return { ok: true, project: project.slug, last_head_sha: previous };
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

  // Counted here because this is the one place both transports pass through --
  // the hosted endpoint and the stdio process reach the same function, so a
  // count taken here cannot describe one of them and miss the other.
  //
  // `parseParams` is inside the try on purpose. A rejected call is the most
  // useful thing this table can hold: an agent asking for something real and
  // being refused on a shape nobody ever sees. Counting only what succeeded
  // would hide exactly the failure worth finding.
  // Guarded here as well as inside the repository, and not out of caution: the
  // two live in different files and only one of them is on the path of every
  // tool call. On the failure path it matters twice over -- a counter that
  // rejected there would replace the error the caller actually needs to see
  // with one about bookkeeping.
  const count = (ok: boolean) => toolUsage.record(ctx.userId, method, ok).catch(() => {});

  try {
    const clean = parseParams(method, params);
    const result = await methods[method](ctx, clean as Record<string, never>);
    await count(true);
    return result;
  } catch (error) {
    await count(false);
    throw error;
  }
}
