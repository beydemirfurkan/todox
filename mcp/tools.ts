/**
 * The agent-facing surface, defined once for both ways in.
 *
 * todox reaches agents over two transports: a stdio process on the developer's
 * own machine, and an HTTP endpoint on the server. The tools, their
 * descriptions and the session instructions must be identical across the two —
 * so they live here, and each transport supplies what only it can.
 *
 * What differs is not the transport but whether there is a filesystem to read.
 * That is the `Workspace` below: the local process can hash a file and find a
 * repository root, the server cannot and says so by returning null. Nothing
 * here branches on "stdio" or "http".
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { translator, type Lang } from "../lib/i18n";
import { renderMarkdown } from "../lib/services/report-markdown";
import type { ActivityReport } from "../lib/services/reports";
import { SHAPES, type MethodName } from "../lib/services/rpc-schemas";
import type { Checked, RefLike } from "./workspace";

/** Whatever this side knows about the machine the developer is sitting at. */
export type Workspace = {
  /** The developer's timezone, or undefined when this side cannot know it. */
  tz(): string | undefined;
  /** The repository root containing `path`, or undefined. */
  repoRoot(path: string): string | undefined;
  /** sha256 of a file; null when it cannot be read — or when there is no disk. */
  hash(path: string): string | null;
  /** null means this side has no filesystem, so staleness cannot be judged here. */
  checkRefs(refs: RefLike[]): { checked: Checked[]; seen: { id: number; hash: string | null }[] } | null;
};

/** Calls a todox RPC method: over HTTP from the laptop, in-process on the server. */
export type Invoker = (method: MethodName, params: Record<string, unknown>) => Promise<unknown>;

const BASE = [
  "todox is the persistent working memory for this developer's projects.",
  "",
  "START OF SESSION: call get_context with the absolute path of the directory",
  "you are working in (cwd). It resolves the project from that path and",
  "returns the standing rules, prior decisions, known dead ends and in-flight",
  "tasks. Do this before planning any non-trivial work.",
  "",
  "CAPTURING WORK: whenever the developer mentions something that will not be",
  "finished in this session -- a follow-up, a deferred fix, a known rough",
  "edge -- call create_task. Pass `cwd` and todox will find the right project,",
  "or register a new one for that repo automatically. You do not need to ask",
  "which project: the path decides. Only ask the human if the work clearly",
  "belongs somewhere other than the current repo.",
  "",
  "WHILE WORKING: update_task to move status (set it to 'doing' when you",
  "actually start -- that is what makes the time reports real); log_entry to",
  "record decisions ('decision'), approaches that failed ('dead_end'), and",
  "things only the human can answer ('question').",
  "",
  "ALWAYS pass `model` with your own model id on create_task, update_task and",
  "log_entry. It costs you nothing and it is how the developer can later show",
  "which work was done by which model.",
  "",
  "BEFORE YOU FINISH: call log_entry(kind:'handoff') on every task you touched,",
  "detailed enough that a fresh session could continue without asking the",
  "human anything. Dead ends are the highest-value entries: they are what",
  "stops the next session burning tokens on the same wall.",
  "",
  "REPORTING: activity_report answers 'what did I get done today / this week'",
  "from the log itself, including how long each task took, which model worked",
  "on it and how important it was. Use format:'markdown' when the developer",
  "wants something to hand to a manager.",
];

const LOCAL_NOTE = [
  "",
  "FILES: link_files and create_task's `files` take plain paths. This process",
  "hashes them for you, so todox can later warn that a note describes code",
  "that has since changed.",
];

const REMOTE_NOTE = [
  "",
  "THIS SERVER HAS NO FILESYSTEM. It cannot see the developer's code, so:",
  "- pass `cwd` as an absolute path, and `repo_root` as the directory holding",
  "  the .git you are working under; without it a project can end up",
  "  registered against a subfolder;",
  "- pass `tz` (IANA, e.g. 'Europe/Istanbul') on reports, or 'today' is",
  "  measured in UTC;",
  "- link_files records the paths, but a note whose file you cannot hash is",
  "  marked as never checked rather than claimed to be fresh.",
];

export function instructions(ws: { local: boolean }) {
  return [...BASE, ...(ws.local ? LOCAL_NOTE : REMOTE_NOTE)].join("\n");
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const plain = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (msg: string) => ({
  content: [{ type: "text" as const, text: `error: ${msg}` }],
  isError: true,
});

/**
 * registerTool infers its callback signature from the schema generic, which
 * collapses to `never` once the shape is itself generic. Every tool here has
 * the same body, so the registration is funnelled through one loosely typed
 * binding; the call sites stay type-checked via `config`.
 */
type RegisterTool = (
  name: string,
  config: { title: string; description: string; inputSchema: z.ZodRawShape },
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
) => void;

/**
 * Parameters a local process fills in from its own environment rather than
 * asking the model for. Remote, the agent is the only one who knows them, so
 * the list is empty and the schema's own descriptions tell it what to send.
 */
const LOCAL_INTERNAL: string[] = ["repo_root", "tz"];

export function registerTools(server: McpServer, invoke: Invoker, ws: Workspace) {
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  const local = ws.checkRefs([]) !== null;
  const internal = local ? LOCAL_INTERNAL : [];

  /**
   * Every tool is the same shape: forward to the server, or report why not.
   *
   * The input schema is not written here — it comes from `SHAPES`, the same
   * definition the server validates against. Declaring it twice is how a tool
   * starts advertising an argument the server rejects.
   */
  function tool(
    name: string,
    method: MethodName,
    config: { title: string; description: string },
    opts: {
      /** Arguments this side consumes itself; added to the schema, never sent. */
      presentation?: z.ZodRawShape;
      /**
       * Fields advertised to the model instead of the server's version, for the
       * few the model should not have to fill in itself. `create_task` takes
       * plain paths here and a local process attaches the hashes.
       */
      overrides?: z.ZodRawShape;
      /** Last chance to add what only this side knows, before the call goes out. */
      prepare?: (params: Record<string, unknown>) => Record<string, unknown>;
      /** Runs on the result, and may call back to the server. */
      after?: (result: unknown, invoke: Invoker) => Promise<unknown>;
      transform?: (result: unknown, args: Record<string, unknown>) => unknown;
    } = {},
  ) {
    const shape = SHAPES[method];
    const accepted = Object.keys(shape);

    const advertised = Object.fromEntries(
      Object.entries({ ...shape, ...opts.overrides, ...opts.presentation }).filter(
        ([k]) => !internal.includes(k),
      ),
    ) as z.ZodRawShape;

    register(name, { ...config, inputSchema: advertised }, async (raw) => {
      const args = raw ?? {};
      // Forward only what the server's schema declares. It rejects unknown
      // keys, and it should: presentation options and any metadata the client
      // adds are ours to deal with, not something to make the server tolerate.
      let params = Object.fromEntries(
        Object.entries(args).filter(([k]) => accepted.includes(k)),
      );
      // Only a process running beside the developer knows their timezone.
      // Without it the server measures "today" in UTC.
      if (accepted.includes("tz") && params.tz === undefined) {
        const tz = ws.tz();
        if (tz) params.tz = tz;
      }
      // Same reasoning for the repository root: a host with no checkout cannot
      // walk up looking for a .git.
      if (accepted.includes("repo_root") && params.repo_root === undefined) {
        const ref = (params.cwd ?? params.project) as string | undefined;
        if (typeof ref === "string") {
          const root = ws.repoRoot(ref);
          if (root) params.repo_root = root;
        }
      }
      if (opts.prepare) params = opts.prepare(params);

      try {
        const result = await invoke(method, params);
        const settled = opts.after ? await opts.after(result, invoke) : result;
        const shaped = opts.transform ? opts.transform(settled, args) : settled;
        return typeof shaped === "string" ? plain(shaped) : ok(shaped);
      } catch (e) {
        return fail((e as Error).message);
      }
    });
  }

  /**
   * Hashes every linked file the payload mentions, rewrites its `status`, and
   * tells the server what it found.
   *
   * The server stores hashes and compares them; it never opens a file, because
   * it does not have one. So the answer to "has this note gone stale" can only
   * come from a process that can see the code, and the web UI only knows what
   * was last reported. With no filesystem this is a no-op and the statuses
   * stay as the server recorded them.
   */
  async function checkLinkedFiles(result: unknown, call: Invoker) {
    if (!result || typeof result !== "object") return result;

    const buckets: { path?: unknown; id?: unknown; hash?: unknown; status?: unknown }[] = [];
    const collect = (files: unknown) => {
      if (Array.isArray(files))
        for (const f of files) if (f && typeof f === "object") buckets.push(f);
    };

    const r = result as { files?: unknown; open_tasks?: unknown };
    collect(r.files);
    if (Array.isArray(r.open_tasks))
      for (const t of r.open_tasks) collect((t as { files?: unknown })?.files);

    const refs = buckets
      .filter((f) => typeof f.id === "number" && typeof f.path === "string")
      .map((f) => ({ id: f.id as number, path: f.path as string, hash: (f.hash ?? null) as string | null }));
    if (!refs.length) return result;

    const seen = ws.checkRefs(refs);
    if (!seen) return result;

    const byId = new Map(seen.checked.map((c) => [c.id, c]));
    for (const f of buckets) {
      const hit = byId.get(f.id as number);
      if (hit) f.status = hit.status;
    }

    // Best effort: a failed write-back must not cost the agent its briefing.
    try {
      await call("reportRefs", { refs: seen.seen });
    } catch {
      /* the status above is still correct for this call */
    }

    // The briefing's own summary was built from what the server had on file.
    const stale = seen.checked.filter((c) => c.status === "changed" || c.status === "missing");
    if (Array.isArray((result as { stale_refs?: unknown }).stale_refs))
      (result as { stale_refs: string[] }).stale_refs = stale.map(
        (c) => `${c.path} (${c.status})`,
      );

    return result;
  }

  /* ------------------------------------------------------------ projects */

  tool("list_projects", "listProjects", {
    title: "List projects",
    description:
      "Every project in your todox account, with open/done counts and root paths. Cheap; call it when unsure which slug to use.",
  });

  tool("create_project", "createProject", {
    title: "Create project",
    description:
      "Register a project explicitly. Usually unnecessary — create_task with `cwd` registers one for you. root_path is what lets any file path inside the repo resolve to this project later.",
  });

  tool("update_project", "updateProject", {
    title: "Update project",
    description:
      "Set the name, root_path or summary. Worth calling right after a project is auto-created, to give it a summary a cold agent can use.",
  });

  /* ------------------------------------------------------- the briefing */

  tool(
    "get_context",
    "getContext",
    {
      title: "Get project context (call this first)",
      description:
        "The session-start briefing: global rules, project decisions/conventions/gotchas, every open task with its decisions, dead ends, open questions, linked files and last handoff note. Also flags notes whose linked files have changed since they were written. Pass your working directory as `project`.",
    },
    { after: checkLinkedFiles },
  );

  /* --------------------------------------------------------------- tasks */

  tool("list_tasks", "listTasks", {
    title: "List tasks",
    description: "Tasks in a project, filtered by status.",
  });

  tool(
    "get_task",
    "getTask",
    {
      title: "Get task with full log",
      description:
        "One task with its complete entry log and linked files (each marked fresh/changed/missing).",
    },
    { after: checkLinkedFiles },
  );

  tool(
    "create_task",
    "createTask",
    {
      title: "Create task",
      description:
        "Capture work that will not finish in this session. Pass `cwd` (your absolute working directory) and todox picks the right project — registering one for that repo if it has never seen it. Put the goal and the definition of done in `body`, not just a title.",
    },
    {
      // The model names files; this side hashes them where it can. Asking a
      // model for a sha256 would be asking it to invent one.
      overrides: {
        files: z
          .array(z.string())
          .optional()
          .describe("Absolute paths of files in play; hashed here for staleness"),
      },
      prepare: (p) => ({
        ...p,
        files: Array.isArray(p.files)
          ? (p.files as string[]).map((path) => ({ path, hash: ws.hash(path) }))
          : undefined,
      }),
    },
  );

  tool("update_task", "updateTask", {
    title: "Update task",
    description:
      "Change title, body, status or priority. Moving status to 'doing' starts the clock and moving it to 'done' stops it — that is where the duration in reports comes from, so keep it honest.",
  });

  /* ----------------------------------------------------------- the log */

  tool("log_entry", "logEntry", {
    title: "Append to a task's log",
    description:
      "Append one entry. kinds: 'decision' (what was chosen and why), 'dead_end' (approach tried that did NOT work -- highest value, prevents repeats), 'question' (needs the human), 'note', 'handoff' (state at end of session: what is done, what is next, what to watch out for).",
  });

  tool(
    "link_files",
    "linkFiles",
    {
      title: "Link files to a task",
      description:
        "Attach file paths to a task and hash them now, so todox can later warn that a note describes code that has since changed.",
    },
    {
      overrides: {
        paths: z
          .array(z.object({ path: z.string().min(1), note: z.string().optional() }))
          .min(1),
      },
      prepare: (p) => ({
        ...p,
        paths: Array.isArray(p.paths)
          ? (p.paths as { path: string; note?: string }[]).map((x) => ({
              ...x,
              hash: ws.hash(x.path),
            }))
          : p.paths,
      }),
    },
  );

  /* -------------------------------------------------- durable knowledge */

  tool("add_context", "addContext", {
    title: "Record durable knowledge",
    description:
      "Knowledge that outlives any single task. Omit both `project` and `cwd` to make it apply across every one of your projects (use for standing preferences and cross-project decisions). kinds: decision, convention, gotcha, preference.",
  });

  /* -------------------------------------------------------------- search */

  tool("search", "search", {
    title: "Search across every project",
    description:
      "Full-text-ish search over task titles/bodies, log entries and context notes, across ALL of your projects. Use it to answer 'have I solved this before?' and 'where did I decide X?'.",
  });

  /* ------------------------------------------------------------- reports */

  tool(
    "activity_report",
    "activityReport",
    {
      title: "What got done (today / this week / any window)",
      description:
        "A summary built from the log, not reconstructed from commits: tasks completed and opened, how long each took (time actually spent in 'doing', plus start-to-finish lead time), which models worked on them, their importance, the decisions made, the dead ends hit and the questions still open. Use format:'markdown' for something the developer can hand straight to a manager; 'json' when you need to reason over the numbers.",
    },
    {
      presentation: {
        format: z.enum(["json", "markdown"]).optional().describe("Default 'json'"),
        lang: z.enum(["tr", "en"]).optional().describe("Markdown language. Default 'tr'."),
      },
      // Rendering stays on this side: it is presentation, and it keeps the
      // report payload the server returns purely structural.
      transform: (result, args) =>
        args.format === "markdown"
          ? renderMarkdown(result as ActivityReport, translator((args.lang as Lang) ?? "tr"))
          : result,
    },
  );
}
