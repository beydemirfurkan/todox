import { z } from "zod";

import { CONTEXT_KINDS, ENTRY_KINDS, STATUSES } from "../constants";
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
 * Filled in by the MCP server, not by the model. The web host has no checkout,
 * so it cannot find a repository root on its own.
 */
const repoRoot = z
  .string()
  .max(MAX.path)
  .optional()
  .describe("Absolute path of the repository root containing `cwd`.");

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
  listProjects: {},

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
    summary: z
      .string()
      .max(MAX.text)
      .optional()
      .describe("What this project is, in 1-3 sentences, for a cold agent"),
    parent_project: projectRef
      .optional()
      .describe(
        "Slug or name of an existing project this one hangs under. Same account; sub-projects share the owner and live under a parent path the agent moved into.",
      ),
  },

  updateProject: {
    project: projectRef,
    name: z.string().min(1).max(MAX.line).optional(),
    root_path: ref.optional(),
    repo_url: repoUrl,
    summary: z.string().max(MAX.text).optional(),
    parent_project: projectRef
      .nullish()
      .describe(
        "Re-parent this project under a different one. Pass null to make it a top-level project again.",
      ),
    archived: z.boolean().optional(),
  },

  /**
   * Lists the direct sub-projects of a project, with task counts. The /p/[slug]
   * panel renders this as a flow and the agent uses it to know which sibling
   * workspaces the user has on the same account.
   */
  listSubProjects: {
    project: projectRef,
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
        "Register a project for this repo if the path matches none. Defaults to true when what you passed is an absolute path, so a first session in a new repo works without a second call.",
      ),
    repo_root: repoRoot,
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
  },

  getTask: { task_id: z.number().int() },

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
      .min(1)
      .max(3)
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
    model,
  },

  updateTask: {
    task_id: z.number().int(),
    title: z.string().min(1).max(MAX.line).optional(),
    body: z.string().max(MAX.text).optional(),
    status: z.enum(STATUSES).optional(),
    priority: z.number().int().min(1).max(3).optional(),
    model,
  },

  logEntry: {
    task_id: z.number().int(),
    kind: z.enum(ENTRY_KINDS),
    body: z
      .string()
      .min(1)
      .max(MAX.text)
      .describe("Write for a stranger, not for yourself"),
    author: z.enum(["agent", "human"]).optional(),
    model,
  },

  linkFiles: {
    task_id: z.number().int(),
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
  },

  addContext: {
    project: ref.optional().describe("Omit to apply across every project in your account"),
    cwd: ref.optional().describe("Absolute working directory, used if project is omitted"),
    kind: z.enum(CONTEXT_KINDS),
    title: z.string().min(1).max(MAX.line),
    body: z.string().min(1).max(MAX.text),
  },

  search: {
    query: z.string().min(1).max(MAX.query),
    // Unbounded, this is three unindexed ILIKE scans with no ceiling.
    limit: z.number().int().min(1).max(100).optional(),
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

  updateProject: z
    .object(SHAPES.updateProject)
    .strict()
    .refine(
      (p) =>
        p.name !== undefined ||
        p.root_path !== undefined ||
        p.repo_url !== undefined ||
        p.summary !== undefined ||
        p.parent_project !== undefined ||
        p.archived !== undefined,
      { message: "pass at least one of name, root_path, repo_url, summary, parent_project or archived" },
    ),

  // Both fields are optional and one of them is required, which the schema is
  // the right place to say. It used to be a runtime throw halfway through the
  // handler, so the tool advertised a call it would always refuse.
  ...Object.fromEntries(
    (["getContext", "listTasks"] as const).map((name) => [
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
