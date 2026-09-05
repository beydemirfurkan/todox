import { z } from "zod";

import {
  CONTEXT_KINDS,
  ENTRY_KINDS,
  MAX_PRIORITY,
  MIN_PRIORITY,
  STATUSES,
} from "../constants";
import { BadRequest } from "./errors";

/**
 * The shape of every RPC method's parameters, in one place.
 *
 * This is the runtime half of `lib/services/rpc.ts`. The handler signatures
 * there are TypeScript, which means they are erased before a request ever
 * arrives -- the route used to hand `payload.params` straight through with a
 * cast, so `const { task_id, ...patch } = p` collected whatever JSON the caller
 * felt like sending. The repositories now allow-list their columns, but this is
 * the layer that stops unvalidated input reaching them at all.
 *
 * The MCP server imports the same shapes for its tool definitions, so the
 * agent's tool surface and the server's validation cannot drift apart. The
 * `.describe()` text is written for an agent reading the tool list.
 */

/**
 * Length ceilings, set far above anything real work produces.
 *
 * Nothing here had one. `reportRefs.refs` was the single bounded collection in
 * the file, and its neighbours are the ones an agent is most likely to build
 * from a loop: `refs.link` spends six bind parameters per path, so a caller
 * that hands over a monorepo's file list crosses Postgres' 65535-parameter
 * ceiling and gets a driver error -- which is not a `BadRequest`, so it lands
 * in the generic 500 branch and tells the agent nothing. A refusal it can read
 * is the point of these numbers, not the numbers themselves.
 */
const MAX = {
  /** Titles, names, slugs -- anything meant to fit on one line. */
  line: 500,
  /** A filesystem path. Windows stops well short of this; Linux allows 4096. */
  path: 4_096,
  /** Bodies, summaries, notes. Long prose is the point of this product. */
  text: 100_000,
  /**
   * A project summary: what this repository is, for somebody who has never
   * seen it. Deliberately far below `text`.
   *
   * It was `text` -- a hundred thousand characters -- and the description
   * asking for "1-3 sentences" was the only thing holding it. Measured across
   * production on 2026-09-05: the median summary is 198 characters and reads
   * like a description, while the two longest are 1,114 and 1,108 and read
   * like release notes. This is the one field on the page whose whole job is
   * to be short, and the page leads with it.
   */
  summary: 320,
  /** A search term. Longer than this is not a search. */
  query: 200,
  /** Paths in one call, matching the ceiling `reportRefs` already had. */
  files: 500,
} as const;

const model = z
  .string()
  .max(MAX.line)
  .optional()
  .describe("Your own model id, e.g. 'claude-opus-5'. Always pass this.");

const projectRef = z
  .string()
  .max(MAX.path)
  .describe("Slug, name, or a path inside the project");

/**
 * How an unverified observation becomes a record somebody stands behind.
 *
 * On the two methods that already write records rather than on a tool of its
 * own: promoting *is* writing an entry or a note, and a separate verb would
 * have been a twenty-fourth thing for a model to hold in its head to do
 * something `log_entry` was already the word for. It also stops the
 * observation coming back in the next briefing, which is half of why an agent
 * reaches for it.
 */
const fromObservation = z
  .number()
  .int()
  .optional()
  .describe(
    "The id of an unverified observation from get_context that this record is based on. It marks the observation handled, so it stops appearing in the briefing — use it whenever you write up something an observation told you, and write the body yourself rather than copying the observation.",
  );

/**
 * Filled in by the MCP server, not by the model. The web host has no checkout,
 * so it cannot find a repository root on its own.
 */
const repoRoot = z
  .string()
  .max(MAX.path)
  .optional()
  .describe("Absolute path of the repository root containing `cwd` -- the directory holding .git. Registering a NEW project needs this or `repo_url`: todox stores repositories, not directories, and a bare `cwd` is a directory you happen to be standing in.");

/**
 * How the server recognises this repo somewhere other than this machine.
 *
 * Same shape as `repoUrl` below, different reader: that one is a field somebody
 * is deliberately setting on a project, this one rides along with a `cwd` so
 * resolution has something better than an absolute path to match on. Locally
 * the MCP server fills it in and the model never sees it; hosted, there is
 * nobody else who can, so the description has to ask for it plainly.
 */
const repoIdentity = z
  .string()
  .max(MAX.line)
  .optional()
  .describe(
    "Output of `git remote get-url origin` for this repo. This is how todox recognises the same repository when you open it on another machine — without it, a second machine registers a duplicate project and the history splits in two.",
  );

/** A path or a slug arriving from a caller, wherever one is accepted. */
const ref = z.string().max(MAX.path);

/**
 * The only identifier a project has that means the same thing on somebody
 * else's machine. `root_path` is where it sits on one laptop.
 */
const repoUrl = z
  .string()
  .max(MAX.line)
  .optional()
  .describe(
    "Output of `git remote get-url origin`, verbatim — ssh or https, both fine. This is what identifies the project anywhere other than this one machine.",
  );

/** Accepts anything `new Date()` understands, which is what `resolvePeriod` uses. */
const datetime = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), {
    message: "must be a date the server can parse, e.g. 2026-08-09T00:00:00Z",
  })
  .describe("ISO datetime; overrides `period`");

export const SHAPES = {
  listProjects: { model },

  createProject: {
    name: z.string().min(1).max(MAX.line).describe("Human name, e.g. 'Checkout Service'"),
    slug: z
      .string()
      .min(1)
      .max(MAX.line)
      .optional()
      .describe("Defaults to a slug of the name"),
    root_path: ref.optional().describe("Absolute path of the repo/working dir"),
    repo_url: repoUrl,
    summary: z.string().max(MAX.summary).optional().describe(
      "What this repository IS, for somebody who has never seen it -- one or two sentences, the way a site's meta description reads. Not a changelog, not a status, not what changed recently: those are what tasks and the log are for, and a summary that carries them goes stale the day after it is written. This is the first thing on the project page and it is capped, so write the sentence you would give a new colleague in a corridor.",
    ),
    model,
  },

  updateProject: {
    project: projectRef,
    name: z.string().min(1).max(MAX.line).optional(),
    root_path: ref.optional(),
    repo_url: repoUrl,
    summary: z.string().max(MAX.summary).optional().describe(
      "What this repository IS, for somebody who has never seen it -- one or two sentences, the way a site's meta description reads. Not a changelog, not a status, not what changed recently: those are what tasks and the log are for, and a summary that carries them goes stale the day after it is written. This is the first thing on the project page and it is capped, so write the sentence you would give a new colleague in a corridor.",
    ),
    model,
  },

  /**
   * The counterweight to registering a project from any path it is handed.
   *
   * That is what makes capture frictionless, and it means one mistyped `cwd`
   * used to leave a project in the account for good: nothing anywhere could
   * remove one. The confirmation is the slug, in the same shape the account
   * page asks for a username -- this cascades to every task, entry and note
   * underneath it.
   */
  deleteProject: {
    project: projectRef,
    confirm: z
      .string()
      .max(MAX.line)
      .describe(
        "The project's slug, typed again. Everything under it goes with it: tasks, log entries, notes and file links. Ask the human first.",
      ),
    model,
  },

  /**
   * The way back from a repo that registered twice.
   *
   * `slug` is not an updatable column on purpose, so a project that came out as
   * `todox-2` cannot be renamed into place -- the rows have to move instead.
   * Same confirmation shape as `deleteProject`, because one project does stop
   * existing.
   */
  mergeProjects: {
    from: projectRef.describe(
      "The duplicate. Its tasks, notes and paths move, then it stops existing.",
    ),
    into: projectRef.describe("The project that survives, keeping its slug."),
    confirm: z
      .string()
      .max(MAX.line)
      .describe(
        "The slug of `from`, typed again. Ask the human before calling this: it is not undoable.",
      ),
    model,
  },

  getContext: {
    project: ref
      .optional()
      .describe("Project slug, name, or any absolute path inside the project"),
    /**
     * The instructions have always told agents to "call get_context with the
     * absolute path of the directory you are working in (cwd)", and the field
     * was called `project`. With `strict()` on, an agent that followed the
     * instruction literally got `Unrecognized key: "cwd"` on its very first
     * call. `listTasks` already accepted both; this now matches it.
     */
    cwd: ref
      .optional()
      .describe("Absolute working directory, used if project is omitted"),
    create_if_missing: z
      .boolean()
      .optional()
      .describe(
        "Register a project for this repo if the path matches none. Defaults to true when what you passed is an absolute path, so a first session in a new repo works without a second call. Registering needs `repo_root` or `repo_url` as well -- a path on its own is not evidence of a repository.",
      ),
    focus: z
      .string()
      .max(MAX.line)
      .optional()
      .describe(
        "What this session is about, in a sentence -- the bug, the feature, the file. Both budgets are spent against it -- the standing notes AND the log -- so the bodies that come back are the ones about what you asked instead of whichever were written most recently. Send it whenever you know; it can only move a record up the list, never drop one, so a focus that matches nothing costs nothing.",
      ),
    repo_root: repoRoot,
    repo_url: repoIdentity,
    model,
  },

  listTasks: {
    project: ref.optional(),
    cwd: ref
      .optional()
      .describe("Absolute working directory, used if project is omitted"),
    status: z
      .enum([...STATUSES, "open", "all"])
      .optional()
      .describe("Default 'open' (todo + doing + blocked)"),
    model,
  },

  getTask: { task_id: z.number().int(), model },

  createTask: {
    cwd: ref
      .optional()
      .describe(
        "Absolute working directory. Resolves — and if needed creates — the project.",
      ),
    project: ref
      .optional()
      .describe("Explicit slug or name. Use when the task does not belong to `cwd`."),
    title: z.string().min(1).max(MAX.line),
    body: z.string().max(MAX.text).optional().describe("Goal, constraints, acceptance"),
    status: z.enum(STATUSES).optional(),
    priority: z
      .number()
      .int()
      .min(MIN_PRIORITY)
      .max(MAX_PRIORITY)
      .optional()
      .describe("1 high, 2 normal (default), 3 low. This is what reports call importance."),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(MAX.path),
          hash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullish(),
        }),
      )
      .max(MAX.files)
      .optional()
      .describe("Absolute paths of files in play, with their sha256"),
    repo_root: repoRoot,
    repo_url: repoIdentity,
    model,
  },

  updateTask: {
    task_id: z.number().int(),
    title: z.string().min(1).max(MAX.line).optional(),
    body: z.string().max(MAX.text).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.number().int().min(MIN_PRIORITY).max(MAX_PRIORITY).optional(),
    model,
  },

  logEntry: {
    task_id: z.number().int(),
    kind: z
      .enum(ENTRY_KINDS)
      .describe(
        "decision — why it is this way, so nobody re-argues it. dead_end — what was tried and failed, and why; the whole cost of one is paid by the session that does not read it. handoff — the state you are leaving, detailed enough to continue without asking. question — something only the developer can settle that you are leaving open on purpose; not for anything you could look up. note — anything else worth keeping.",
      ),
    body: z
      .string()
      .min(1)
      .max(MAX.text)
      .describe(
        "Write for a stranger, not for yourself. One entry says one thing: what was decided and why it beat the alternative, or what was tried and how it failed. Not a transcript of the session — measurements, file listings and options nobody chose belong in the task body or a context note, and an entry that repeats what the diff already shows is noise the next session reads past. Reports and briefings show the opening of a body, so the first paragraph has to stand on its own; the length after it is for whoever follows the link.",
      ),
    author: z.enum(["agent", "human"]).optional(),
    answers_entry_id: z
      .number()
      .int()
      .optional()
      .describe(
        "The id of a `question` entry on this same task that this entry settles. A question with an answer stops being open: it drops out of the briefing and out of report windows, while both it and the answer stay readable through get_task. Use it whenever you resolve something a previous session had to ask about — it is the only way a question ever closes.",
      ),
    from_observation_id: fromObservation,
    model,
  },

  /**
   * For an entry that was wrong when it was written -- a decision recorded
   * before it was made, a handoff posted to the wrong task. An entry that has
   * merely been overtaken is history, and history is the product: correct it
   * with another entry rather than removing this one.
   */
  deleteEntry: {
    entry_id: z.number().int(),
    model,
  },

  /**
   * Either half of the link. `task_id` is the common one; `context_id` makes a
   * standing rule about a file findable *from* that file, which is what
   * `get_file_context` reads back. The column, its unique index and the
   * ownership join all existed already -- no surface could reach them.
   */
  linkFiles: {
    task_id: z.number().int().optional(),
    context_id: z
      .number()
      .int()
      .optional()
      .describe("Attach the files to a context note instead of a task. Pass one or the other."),
    paths: z
      .array(
        z.object({
          path: z.string().min(1).max(MAX.path),
          note: z.string().max(MAX.line).optional(),
          hash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullish()
            .describe("sha256 of the file, computed by you. The server has no copy."),
        }),
      )
      .min(1)
      .max(MAX.files),
    model,
  },

  unlinkRef: {
    ref_id: z
      .number()
      .int()
      .describe("From the `refs` of get_context or get_task. Removes the link, not the file."),
    model,
  },

  /**
   * Closes a stale warning the agent has actually looked into. Nothing else
   * can: the server has no copy of the file, so `report_file_hashes` can only
   * ever tell it the two hashes differ, never that the difference is fine.
   */
  acceptRef: {
    ref_id: z.number().int(),
    model,
  },

  /**
   * Reports what the agent found on disk. The web UI has no filesystem, so
   * this is the only way it can ever show that a note has gone stale.
   */
  reportRefs: {
    refs: z
      .array(
        z.object({
          id: z.number().int(),
          hash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable()
            .describe("null when the file is gone"),
        }),
      )
      .min(1)
      .max(500),
    model,
  },

  /**
   * The read the briefing's ceiling made necessary.
   *
   * `get_context` carries every note's title and only the newest sixty
   * bodies, so past that a note is a title and an id. Without a way to spend
   * one call on the one that looks relevant, the cap would be a silent loss
   * rather than a budget -- and `search` cannot stand in for it: it matches a
   * literal substring and returns 240 characters of the body, which is a
   * snippet, not the note.
   */
  getContextNote: {
    context_id: z
      .number()
      .int()
      .describe(
        "From the `id` of a note in get_context's global_context or project_context, or from a search hit of type 'context'.",
      ),
    model,
  },

  /**
   * The path is folded to its repo-relative form before anything is matched,
   * so `cwd` or `project` is not optional decoration -- it is what says which
   * roots to fold against.
   */
  getFileContext: {
    path: z
      .string()
      .min(1)
      .max(MAX.path)
      .describe(
        "The file to ask about: an absolute path, or one relative to the repository root. Both resolve to the same answer on any machine.",
      ),
    project: ref.optional().describe("Slug, name, or a path inside the project"),
    cwd: ref.optional().describe("Absolute working directory, used if project is omitted"),
    model,
  },

  addContext: {
    project: ref.optional().describe("Omit to apply across every project in your account"),
    cwd: ref.optional().describe("Absolute working directory, used if project is omitted"),
    kind: z.enum(CONTEXT_KINDS),
    title: z.string().min(1).max(MAX.line),
    body: z.string().min(1).max(MAX.text),
    from_observation_id: fromObservation,
    model,
  },

  /**
   * The other half of `addContext`, and the reason it exists: a note that
   * cannot be corrected stops being worth trusting the moment it is wrong.
   */
  updateContext: {
    context_id: z.number().int(),
    kind: z.enum(CONTEXT_KINDS).optional(),
    title: z.string().min(1).max(MAX.line).optional(),
    body: z
      .string()
      .min(1)
      .max(MAX.text)
      .optional()
      .describe("Replaces the body outright. Send the whole note, not a diff."),
    model,
  },

  deleteContext: {
    context_id: z
      .number()
      .int()
      .describe("Prefer update_context when the note is merely out of date."),
    model,
  },

  search: {
    query: z.string().min(1).max(MAX.query),
    project: ref
      .optional()
      .describe(
        "Narrow to one project — a slug, a name, or any absolute path inside it. Leave it out to search everything, which is usually right: the answer to 'have I hit this before?' is often in a different repository. Account-wide notes come back either way, because a standing rule that applies to every project applies to this one.",
      ),
    kinds: z
      .array(z.enum([...new Set([...ENTRY_KINDS, ...CONTEXT_KINDS])] as [string, ...string[]]))
      .min(1)
      .optional()
      .describe(
        "Only these kinds of record: 'dead_end' for 'has this been tried?', 'decision' for 'why is it like this?', 'gotcha' for 'what will bite me?'. Tasks have no kind, so asking for any excludes them and leaves the log and the notes.",
      ),
    // Unbounded, this is three unindexed ILIKE scans with no ceiling.
    limit: z.number().int().min(1).max(100).optional(),
    model,
  },

  activityReport: {
    period: z
      .enum(["today", "yesterday", "week", "last_week", "month", "all"])
      .optional()
      .describe("Default 'today'. 'week' is the current Monday-based week."),
    from: datetime.optional(),
    to: datetime.optional(),
    project: ref.optional().describe("Slug, name or path. Omit to cover every project."),
    tz: z
      .string()
      .max(64)
      .optional()
      .describe(
        "IANA timezone the period is measured in, e.g. 'Europe/Istanbul'. Defaults to the account's. Send yours so 'today' means the developer's today.",
      ),
    model,
  },

  /**
   * Records the MCP client that just used this token. Server-side, not
   * agent-facing: the stdio server fires it once at startup with
   * TODOX_CLIENT_NAME, the HTTP route fires it on the first `initialize`
   * message, and `get_context` reads the result back so it can hand the
   * agent client-specific advice. There is no tool registration — calling
   * it as an agent would not help, because the agent is the thing it is
   * about to record.
   */
  recordClientInfo: {
    name: z
      .string()
      .min(1)
      .max(MAX.line)
      .describe("Client name from the MCP initialize message, e.g. 'claude-code'"),
    version: z
      .string()
      .max(MAX.line)
      .optional()
      .describe("Client version; defaults to 'unknown'"),
    model,
  },

  /**
   * What a session did to the tree, written by the process that can see it.
   *
   * Server-side and not agent-facing, for the same reason `recordClientInfo`
   * is not: the stdio process fires this for itself while the session runs,
   * and an observation an agent had to be asked for is not an observation. It
   * is also why there is no tool -- a model that could write these could write
   * a flattering one.
   *
   * Answers with the last `head_sha` this account recorded for the project, so
   * the next session can tell what the previous one never got round to
   * reporting. That is the whole of the crash-recovery story: work is picked
   * up at the *start* of the next session rather than flushed at the end of a
   * dying one, because a process being killed is exactly when a last write
   * does not happen.
   */
  recordObservation: {
    project: ref.optional(),
    cwd: ref
      .optional()
      .describe("Absolute working directory, used if project is omitted"),
    session_id: z
      .string()
      .min(1)
      .max(MAX.line)
      .describe("Stable id for this session. One row is kept per session per project."),
    client: z.string().max(MAX.line).optional(),
    branch: z.string().max(MAX.line).optional(),
    base_sha: z.string().max(MAX.line).optional().describe("HEAD when the session opened"),
    head_sha: z.string().max(MAX.line).optional().describe("HEAD now"),
    commits: z.number().int().min(0),
    files_changed: z.number().int().min(0),
    commit_subjects: z
      .string()
      .max(MAX.text)
      .optional()
      .describe("Subject lines, newest first, capped by the caller"),
    started_at: z.string().max(MAX.line).optional(),
    model,
  },
} satisfies Record<string, z.ZodRawShape>;

export type MethodName = keyof typeof SHAPES;

/**
 * `strict()` rather than the default strip: an unrecognised key is far more
 * likely to be a mistake worth reporting than something to quietly discard,
 * and silently ignoring input is how `update_task` came to accept a patch it
 * never applied.
 */
const OBJECTS: Record<string, z.ZodType> = {
  ...Object.fromEntries(
    Object.entries(SHAPES).map(([name, shape]) => [name, z.object(shape).strict()]),
  ),

  // A patch of nothing used to return the unchanged row, which reads to an
  // agent exactly like a successful write.
  updateTask: z
    .object(SHAPES.updateTask)
    .strict()
    .refine(
      (p) =>
        p.title !== undefined ||
        p.body !== undefined ||
        p.status !== undefined ||
        p.priority !== undefined,
      { message: "pass at least one of title, body, status or priority" },
    ),

  updateContext: z
    .object(SHAPES.updateContext)
    .strict()
    .refine(
      (p) => p.kind !== undefined || p.title !== undefined || p.body !== undefined,
      { message: "pass at least one of kind, title or body" },
    ),

  /**
   * One end or the other, never both and never neither.
   *
   * `refs` hangs off a task or a context, and the two partial unique indexes
   * that keep a path from being linked twice each lead on one of those
   * columns -- a row with both set would satisfy both indexes separately and
   * be de-duplicated against neither.
   */
  linkFiles: z
    .object(SHAPES.linkFiles)
    .strict()
    .refine((p) => (p.task_id === undefined) !== (p.context_id === undefined), {
      message: "pass exactly one of `task_id` or `context_id`",
    }),

  updateProject: z
    .object(SHAPES.updateProject)
    .strict()
    .refine(
      (p) =>
        p.name !== undefined ||
        p.root_path !== undefined ||
        p.repo_url !== undefined ||
        p.summary !== undefined,
      { message: "pass at least one of name, root_path, repo_url or summary" },
    ),

  // Both fields are optional and one of them is required, which the schema is
  // the right place to say. It used to be a runtime throw halfway through the
  // handler, so the tool advertised a call it would always refuse.
  ...Object.fromEntries(
    (["getContext", "listTasks", "getFileContext", "recordObservation"] as const).map((name) => [
      name,
      z
        .object(SHAPES[name])
        .strict()
        .refine((p) => p.project !== undefined || p.cwd !== undefined, {
          message: "pass either `project` or `cwd`",
        }),
    ]),
  ),
};

export const isMethod = (name: string): name is MethodName =>
  Object.hasOwn(SHAPES, name);

/** Throws with a message an agent can act on; the RPC route maps it to a 400. */
export function parseParams(method: MethodName, params: unknown): Record<string, unknown> {
  const result = OBJECTS[method].safeParse(params ?? {});
  if (result.success) return result.data as Record<string, unknown>;

  const detail = result.error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
  throw new BadRequest(`invalid params for ${method} — ${detail}`);
}
