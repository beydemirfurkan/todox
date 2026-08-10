/**
 * The agent-facing surface, defined once for both ways in.
 *
 * todox reaches agents over two transports: a stdio process on the developer's
 * own machine, and an HTTP endpoint on the server. One definition serves both,
 * so a tool cannot exist on one and not the other by accident.
 *
 * They are not byte-identical, and pretending otherwise would be the lie worth
 * avoiding: what differs is whether this side has a filesystem. That is the
 * `Workspace` below. Locally the process hashes files itself and fills in the
 * repository root and timezone, so those arguments are hidden from the model.
 * Remotely there is no disk here — but there is one where the agent runs, so
 * the same jobs are asked of it instead, and `report_file_hashes` exists only
 * on that side. Nothing branches on "stdio" or "http"; it branches on `local`.
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
  "WHAT IT IS FOR: you start every session knowing nothing about the last one.",
  "The developer pays for that twice -- once explaining the project again, and",
  "once when you walk into a wall a previous session already found. todox is",
  "where that knowledge is kept between sessions: what was decided and why,",
  "which approaches were tried and failed, what is still open, and what state",
  "the last session left things in. It is not a task tracker for humans to",
  "groom; it is written agent-to-agent, with a human reading over the shoulder.",
  "",
  "WHEN NOT TO USE IT: not everything is worth keeping. Do not open a task for",
  "something you are finishing right now, and do not log an entry that only",
  "restates what the diff already shows. The test is whether a session two",
  "weeks from now would be worse off without it. A log nobody trusts because",
  "it is full of noise is the failure mode to avoid.",
  "",
  "START OF SESSION: call get_context with `cwd` set to the absolute path of",
  "the directory you are working in. It resolves the project from that path --",
  "registering one for the repo if todox has never seen it -- and returns the",
  "standing rules, prior decisions, known dead ends and in-flight tasks. Do",
  "this before planning any non-trivial work. Prefer it to list_tasks: it is",
  "one call and it carries the reasoning as well as the list.",
  "",
  "LOOKING THINGS UP: search covers every project you have. Reach for it when",
  "the question is 'have I hit this before?' or 'where did we decide X?' --",
  "the answer is often in a project other than this one.",
  "",
  "WHAT NOT TO READ: list_tasks with status:'all' and activity_report with",
  "period:'all' return everything there has ever been, bodies included. They",
  "will fill your context with a backlog instead of the work in front of you.",
  "Ask for the window you actually need.",
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
  "WHAT OUTLIVES A TASK: add_context, for the things that constrain everything",
  "else -- a convention the codebase follows, a gotcha that will bite the next",
  "session, a standing preference. These lead the briefing, so a rule recorded",
  "here is read before any task is. Omit both `project` and `cwd` to make one",
  "apply across every project. Do not park these as notes on whichever task",
  "happened to be open.",
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
  "THIS SERVER HAS NO FILESYSTEM, BUT YOU DO. It cannot see the developer's",
  "code; you are running on the machine that holds it. So the parts that need",
  "a disk are yours to do:",
  "- pass `cwd` as an absolute path, and `repo_root` as the directory holding",
  "  the .git you are working under; without it a project can end up",
  "  registered against a subfolder;",
  "- pass `tz` (IANA, e.g. 'Europe/Istanbul') on reports. If you cannot",
  "  determine it, say in your answer that the window is measured in UTC",
  "  rather than letting the developer assume it is their day;",
  "- when you link a file, send its `hash`: the sha256 of the file's bytes.",
  "  That hash is the only thing that lets todox tell you later that a note",
  "  describes code which has since changed. Omit it and the note is recorded",
  "  as never checked -- honest, but useless;",
  "- after get_context or get_task hands you linked files, re-hash the ones",
  "  you can read and send them to report_file_hashes with the ids you were",
  "  given. That is what turns a stale note into a warning.",
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
  config: {
    title: string;
    description: string;
    inputSchema: z.ZodRawShape;
    annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
  },
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
) => void;

/**
 * Marks a tool as reading nothing but state it does not change.
 *
 * Clients use this to decide what can run without asking. Without it, the very
 * first instruction this server gives -- call get_context before planning
 * anything -- lands on a permission prompt at the start of every session, which
 * is exactly the friction that gets a habit dropped.
 */
const READ_ONLY = { readOnlyHint: true, idempotentHint: true } as const;

/**
 * Parameters a local process fills in from its own environment rather than
 * asking the model for. Remote, the agent is the only one who knows them, so
 * the list is empty and the schema's own descriptions tell it what to send.
 */
const LOCAL_INTERNAL: string[] = ["repo_root", "tz"];

/**
 * The three moments todox is for, offered as prompts.
 *
 * Instructions are only read by an agent that is already connected and paying
 * attention; prompts show up in the client's own menu, so somebody who has just
 * installed this can see what it is for without reading anything. They are also
 * the honest answer to "when should I use this" — these are the three times.
 */
function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "start_session",
    {
      title: "Start a session on this project",
      description:
        "Read what previous sessions established before doing anything else — decisions, dead ends, open questions and the last handoff.",
      argsSchema: { cwd: z.string().describe("Absolute path of the directory you are working in") },
    },
    ({ cwd }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Call get_context with cwd "${cwd}" before planning anything.`,
              "",
              "Then tell me, briefly: what is already decided, what has been tried",
              "and failed, what is still open, and where the last session stopped.",
              "",
              "If it hands back linked files, hash the ones you can read and send",
              "them to report_file_hashes — that is what lets todox tell us a note",
              "describes code that has since changed. Say which notes are affected.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "wrap_up",
    {
      title: "Leave a handoff for the next session",
      description:
        "Write down what a fresh session would need to continue: state, decisions, dead ends, and what to watch out for.",
      argsSchema: { cwd: z.string().describe("Absolute path of the directory you are working in") },
    },
    ({ cwd }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `We are finishing. For every task you touched in "${cwd}":`,
              "",
              "- move its status if it changed (update_task)",
              "- log any decision worth keeping and why the alternatives lost",
              "- log every approach that did NOT work as a dead_end; that is the",
              "  entry that saves the most time later",
              "- log anything only I can answer as a question",
              "- finish with log_entry(kind:'handoff') written for someone who was",
              "  not here: what is done, what is next, what to watch out for",
              "",
              "Skip anything a diff would already show. Pass your own model id.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "standup",
    {
      title: "What got done",
      description:
        "A report built from the log rather than from commits: durations, decisions, dead ends and open questions.",
      argsSchema: {
        // The same enum the tool validates against. As a free-form string this
        // offered no completion in the client and turned a typo into a schema
        // error one call later.
        period: z
          .enum(["today", "yesterday", "week", "last_week", "month"])
          .optional()
          .describe("Default: today"),
      },
    },
    ({ period }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Call activity_report for "${period || "today"}" with format:"markdown"`,
              "and show me the result. Pass `tz` with my timezone and `lang` with",
              "the language I have been writing to you in. Then call out anything",
              "still open that I should decide on.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

/**
 * Registers the whole agent surface: the tools, and the prompts that tell a
 * client what this server is for.
 */
export function registerTools(server: McpServer, invoke: Invoker, ws: Workspace) {
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  const local = ws.checkRefs([]) !== null;
  const internal = local ? LOCAL_INTERNAL : [];

  registerPrompts(server);

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
    config: {
      title: string;
      description: string;
      annotations?: { readOnlyHint?: boolean; idempotentHint?: boolean };
    },
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
    annotations: READ_ONLY,
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
      // Repeats what the server instructions say, because not every client
      // shows them -- a tool description is the one place an agent always
      // looks.
      description:
        "Read what previous sessions on this project already worked out, so you do not ask the developer to explain it again or repeat a mistake somebody already made. The session-start briefing: standing rules, decisions and why the alternatives lost, approaches that were tried and failed, open questions, in-flight tasks with their linked files, and the note the last session left behind. Also flags notes whose files have changed since they were written. Call this before planning any non-trivial work; pass your working directory as `cwd`.",
      annotations: READ_ONLY,
    },
    { after: checkLinkedFiles },
  );

  /* --------------------------------------------------------------- tasks */

  tool("list_tasks", "listTasks", {
    title: "List tasks",
    description: "Tasks in a project, filtered by status.",
    annotations: READ_ONLY,
  });

  tool(
    "get_task",
    "getTask",
    {
      title: "Get task with full log",
      description:
        "One task with its entry log (most recent 200; `entries_omitted` says if there were more) and its linked files, each marked fresh/changed/missing.",
      annotations: READ_ONLY,
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
    // Local only. A process sitting next to the code can hash it, so the model
    // is asked for paths and nothing else -- asking it for a sha256 would be
    // asking it to invent one. Remote, the schema's own `{path, hash}` stands,
    // because there the agent is the one with the file.
    local
      ? {
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
        }
      : {},
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
    local
      ? {
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
        }
      : {},
  );

  /**
   * The remote half of staleness.
   *
   * Locally this happens by itself: `checkLinkedFiles` hashes what the briefing
   * mentions and posts the result back. Hosted, the server has no filesystem —
   * but the agent calling it does, and that is the whole point. Without this
   * tool the hosted transport could never record a single hash, so every ref
   * read "not checked" for ever and the feature the product leads with was
   * dead on the way in most people use.
   */
  if (!local)
    tool("report_file_hashes", "reportRefs", {
      title: "Report what linked files look like now",
      description:
        "After get_context or get_task, hash each linked file you can read (sha256 of its bytes; null if it is gone) and send the results back with the ids you were given. This is how todox learns that a note describes code that has since changed — the server has no copy of the repository and cannot work it out on its own.",
    });

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
      "Full-text-ish search over task titles/bodies, log entries and context notes, across ALL of your projects. Use it to answer 'have I solved this before?' and 'where did I decide X?'. Returns at most `limit` hits in total (default 30).",
    annotations: READ_ONLY,
  });

  /* ------------------------------------------------------------- reports */

  tool(
    "activity_report",
    "activityReport",
    {
      title: "What got done (today / this week / any window)",
      description:
        "A summary built from the log, not reconstructed from commits: tasks completed and opened, how long each took (time actually spent in 'doing', plus start-to-finish lead time), which models worked on them, their importance, the decisions made, the dead ends hit and the questions still open. Use format:'markdown' for something the developer can hand straight to a manager; 'json' when you need to reason over the numbers. Prefer a named period over 'all', which returns the whole account's history in one result.",
      annotations: READ_ONLY,
    },
    {
      presentation: {
        format: z.enum(["json", "markdown"]).optional().describe("Default 'json'"),
        lang: z
          .enum(["tr", "en"])
          .optional()
          .describe("Markdown language. Default 'en'; pass 'tr' if the developer writes Turkish."),
      },
      // Rendering stays on this side: it is presentation, and it keeps the
      // report payload the server returns purely structural.
      //
      // English by default because every other word on this surface is English.
      // It used to default to Turkish, so the `standup` prompt -- which passes
      // no language at all -- handed back a Turkish document to an agent that
      // had been briefed entirely in English.
      transform: (result, args) =>
        args.format === "markdown"
          ? renderMarkdown(result as ActivityReport, translator((args.lang as Lang) ?? "en"))
          : result,
    },
  );
}
