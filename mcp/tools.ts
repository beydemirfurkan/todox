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
import { clientFamily, type ClientInfo } from "../lib/client-identity";
import { logError } from "../lib/server/log";
import { renderMarkdown } from "../lib/services/report-markdown";
import type { ActivityReport } from "../lib/services/reports";
import { SHAPES, type MethodName } from "../lib/services/rpc-schemas";
import { notesFor } from "./client-notes";
import type { Checked, RefLike } from "./workspace";

/** Whatever this side knows about the machine the developer is sitting at. */
export type Workspace = {
  /** The developer's timezone, or undefined when this side cannot know it. */
  tz(): string | undefined;
  /** The repository root containing `path`, or undefined. */
  repoRoot(path: string): string | undefined;
  /** The repo's remote — the identity that survives moving to another machine.
   *  undefined when this side has no disk, or the path is not a checkout. */
  repoUrl(path: string): string | undefined;
  /** sha256 of a file; null when it cannot be read — or when there is no disk. */
  hash(path: string): string | null;
  /** null means this side has no filesystem, so staleness cannot be judged here. */
  checkRefs(refs: RefLike[]): { checked: Checked[]; seen: { id: number; hash: string | null }[] } | null;
  /** Which MCP client opened this session, so the briefing can give
   *  client-specific advice. null when this side cannot tell.
   *
   *  A capability rather than the bearer token it used to hand over. The token
   *  was passed in so this module could do the database lookup itself, which
   *  meant the shared tool surface imported a Postgres driver — and the stdio
   *  process, which has no database, therefore never got the notes at all. It
   *  knows its own client from the environment that launched it; the hosted
   *  route reads the row. Same answer, each side asked the way it can. */
  clientInfo(): Promise<ClientInfo | null>;
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
  "Send `focus` with it whenever the developer has said what they want --",
  "'fix the login redirect loop', 'speed up search'. The briefing has a budget",
  "and without a focus it spends it on the newest notes, which is a guess; with",
  "one it spends it on the notes about what you are here to do. A standing rule",
  "written a year ago can be the one that matters, and recency will never find",
  "it. A focus that matches nothing changes nothing, so there is no cost to",
  "sending it and no reason to leave it out.",
  "",
  "LOOKING THINGS UP: search covers every project you have. Reach for it when",
  "the question is 'have I hit this before?' or 'where did we decide X?' --",
  "the answer is often in a project other than this one. Ask it in words: the",
  "query is parsed and ranked, so a whole question works and the record that",
  "answers most of it comes back first. Quote a phrase to require it exactly.",
  "",
  "BEFORE YOU EDIT A FILE: get_file_context takes a path and answers with the",
  "tasks that touched it, their dead ends, and any standing note attached to",
  "it. This is the cheapest call here and the one most worth making unasked --",
  "the whole cost of a dead end is paid by the session that does not read it.",
  "",
  "WHAT NOT TO READ: list_tasks with status:'all' and activity_report with",
  "period:'all' return everything there has ever been, bodies included. They",
  "will fill your context with a backlog instead of the work in front of you.",
  "Ask for the window you actually need.",
  "",
  "ANSWERING WHAT WAS ASKED: a briefing hands you open_questions with their",
  "ids. If you work one of them out -- or the developer tells you -- log the",
  "answer with answers_entry_id set to that question. Until something does,",
  "that question comes back in every briefing and every report for ever, and a",
  "list of questions nobody can close stops being read. This is the cheapest",
  "way to make the next session's briefing shorter and truer than yours was.",
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
  "ALWAYS pass `model` with your own model id on every method — write tools",
  "record it on the row, read tools use it as telemetry. The full client-side",
  "contract lives in docs/mcp.md; `pnpm install:mcp <client>` can paste it.",
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
  "- pass `repo_url` on get_context and create_task: run",
  "  `git remote get-url origin` and send it verbatim. A path is a different",
  "  string on every machine, so this is what stops the same repo opened on a",
  "  second computer registering as a second project and splitting the log;",
  "- pass `tz` (IANA, e.g. 'Europe/Istanbul') on reports. If you cannot",
  "  determine it, say in your answer that the window is measured in UTC",
  "  rather than letting the developer assume it is their day;",
  "- when a project is registered for the first time, follow up with",
  "  update_project: a one-paragraph summary, and repo_url set to the output",
  "  of `git remote get-url origin`. The path you sent is where the repo sits",
  "  on this machine and means nothing on the next one;",
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

/**
 * What both transports answer `initialize` with. Here rather than at each
 * `new McpServer(...)` for the same reason the tools are: there is one agent
 * surface, and a client that connects to the hosted endpoint and a client that
 * spawns the stdio process must not be told they reached different servers.
 *
 * The version is a literal and not `package.json`'s, because the stdio package
 * is a pruned tree whose require graph is walked by `scripts/pack-mcp.ts` --
 * that walk resolves `.js` and `index.js` only, so a `.json` require reads as a
 * missing file and fails the build. `server-json.test.ts` holds this literal
 * against `package.json` instead, next to the assertion that already holds
 * `server.json` there. Three files, one release, one test that fails when
 * somebody bumps only two of them.
 */
export const SERVER_INFO = { name: "todox", version: "0.1.1" } as const;

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
 * Adds the captured MCP client and a short list of client-specific notes to
 * a `get_context` result. The DB lookup is one extra round trip on the one
 * tool the agent is told to call first, which is the right place to pay it.
 *
 * Every step is best-effort: a failed lookup, an anonymous call, or any
 * exception must not cost the agent its briefing. The worst case is the
 * notes field not appearing.
 */
async function appendClientNotes(ws: Workspace, result: unknown): Promise<unknown> {
  if (!result || typeof result !== "object") return result;
  let info;
  try {
    info = await ws.clientInfo();
  } catch (e) {
    logError("mcp.clientInfoLookup", e);
    return result;
  }
  if (!info) return result;
  return {
    ...(result as Record<string, unknown>),
    client: info.name,
    notes: notesFor(clientFamily(info.name)),
  };
}

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
      /**
       * Shapes the result for the model. May be async — and the return type
       * says so, because `unknown` alone accepted an async function happily
       * and the call site did not await it: `get_context`'s transform is
       * async, so every briefing was serialised as a pending promise and every
       * agent received `{}`.
       */
      transform?: (
        result: unknown,
        args: Record<string, unknown>,
      ) => unknown | Promise<unknown>;
      /**
       * Fields only *this* tool fills in for itself locally.
       *
       * `LOCAL_INTERNAL` is account-wide, and `repo_url` cannot go in it:
       * `update_project` and `create_project` exist partly to set that field,
       * so hiding it there would leave a local agent no way to record a remote
       * -- and the injection below cannot refill it, because their reference is
       * a slug rather than a path.
       */
      localInternal?: string[];
    } = {},
  ) {
    const shape = SHAPES[method];
    const accepted = Object.keys(shape);
    const hidden = local ? [...internal, ...(opts.localInternal ?? [])] : [];

    const advertised = Object.fromEntries(
      Object.entries({ ...shape, ...opts.overrides, ...opts.presentation }).filter(
        ([k]) => !hidden.includes(k),
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
      // And the remote, which is the only identity that survives the developer
      // opening the same repo on a second machine. Absent, resolution falls
      // back to matching absolute paths -- which is what split projects in two.
      // `repo_root` first: it was just resolved above, so this skips walking up
      // for the .git a second time.
      if (accepted.includes("repo_url") && params.repo_url === undefined) {
        const ref = (params.repo_root ?? params.cwd ?? params.project) as string | undefined;
        if (typeof ref === "string") {
          const url = ws.repoUrl(ref);
          if (url) params.repo_url = url;
        }
      }
      if (opts.prepare) params = opts.prepare(params);

      try {
        const result = await invoke(method, params);
        const settled = opts.after ? await opts.after(result, invoke) : result;
        const shaped = opts.transform ? await opts.transform(settled, args) : settled;
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
      "Set the name, root_path, repo_url or summary. Worth calling right after a project is auto-created: a one-paragraph summary and the output of `git remote get-url origin` are what make it legible to a session on another machine, where the local path means nothing.",
  });

  tool("delete_project", "deleteProject", {
    title: "Delete a project",
    description:
      "Removes a project and everything under it — every task, every log entry, every note and file link. Not recoverable. `confirm` must be the project's slug. This exists because a mistyped `cwd` registers a project like any other path does; ask the human before calling it.",
  });

  tool("merge_projects", "mergeProjects", {
    title: "Merge one project into another",
    description:
      "Fold a duplicate project into the real one, keeping both sides' tasks, log entries, notes and paths. Use it when the same repository registered twice — usually because it was opened from two machines and the older resolver identified a project by its absolute path, so `todox` and `todox-2` are one repo. A project's slug cannot be renamed, so this moves the rows instead. `from` stops existing; `confirm` must be its slug. Not undoable: ask the human first, and set repo_url on the survivor afterwards so it cannot happen again.",
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
        "Read what previous sessions on this project already worked out, so you do not ask the developer to explain it again or repeat a mistake somebody already made. The session-start briefing: standing rules, decisions and why the alternatives lost, approaches that were tried and failed, open questions, in-flight tasks with their linked files, and the note the last session left behind. Also flags notes whose files have changed since they were written. Call this before planning any non-trivial work; pass your working directory as `cwd`. It is capped so it cannot grow without bound: fifty open tasks, three log entries per kind per task, and sixty context-note bodies per scope — twenty-five when you send a `focus`, because those twenty-five are the ones about what you asked. Every note's title comes back regardless — a `body` of null means that note was past the ceiling, not that it is empty, and `get_context_note` reads it. `open_tasks_omitted`, `log_omitted` and `context_omitted` say how much was left out. Pass `focus` — one sentence about what this session is for — and the notes that keep their bodies are the ones relevant to it rather than the ones written most recently; `context_ranked_by` tells you which of the two you got.",
      annotations: READ_ONLY,
    },
    {
      // A model cannot invent a sha256, and it cannot invent a git remote
      // either -- but unlike a hash, a plausible guess parses cleanly and
      // becomes this project's identity for good. So locally it is not asked.
      localInternal: ["repo_url"],
      after: checkLinkedFiles,
      transform: async (result, _args) => appendClientNotes(ws, result),
    },
  );

  tool("get_file_context", "getFileContext", {
    title: "What is known about one file",
    description:
      "Everything todox has recorded against a file: the tasks that touched it with their dead ends and decisions, and the context notes attached to it in full. Ask before editing a file you have not seen this session — a dead end costs nothing to read and an afternoon to rediscover. The path may be absolute or relative to the repository root; both fold to the same answer, so a note linked on one machine is found from another. Pass `cwd` or `project` to say which repository is being asked about.",
    annotations: READ_ONLY,
  });

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
          localInternal: ["repo_url"],
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
      "Append one entry. kinds: 'decision' (what was chosen and why), 'dead_end' (approach tried that did NOT work -- highest value, prevents repeats), 'question' (needs the human), 'note', 'handoff' (state at end of session: what is done, what is next, what to watch out for). When what you are writing settles a question an earlier session asked, pass its id as `answers_entry_id`: the question stops being open and stops arriving in every briefing, while both it and your answer stay readable through get_task. Nothing else closes a question.",
  });

  tool("delete_entry", "deleteEntry", {
    title: "Remove a log entry",
    description:
      "For an entry that was wrong when it was written: a decision recorded before it was actually made, a handoff posted against the wrong task, a dead end that turned out to be your own mistake rather than the approach's. An entry that has merely been overtaken by later work is not wrong, it is history — and the history is the product here, so leave it and append what you now know. Do not use this to tidy a log.",
  });

  tool(
    "link_files",
    "linkFiles",
    {
      title: "Link files to a task or a note",
      description:
        "Attach file paths to a task (`task_id`) or to a context note (`context_id`) — one or the other — and hash them now. Two things follow: todox can warn later that a note describes code which has since changed, and `get_file_context` can answer what is known about that file from the file's own name. Linking a standing rule to the files it governs is what makes it findable by the session that opens one of them.",
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

  tool("unlink_file", "unlinkRef", {
    title: "Remove a file link",
    description:
      "For a path that is no longer what the task is about — the file was deleted, renamed, or attached by mistake. It removes the link only; nothing on disk is touched. A link left behind produces a stale warning nobody can ever clear, in every briefing from now on.",
  });

  tool("accept_file_change", "acceptRef", {
    title: "Accept a changed file as still correct",
    description:
      "Clears the stale warning on a linked file once you have read the change and the note still holds. Nothing else can clear it: the server has no copy of the repository, so it can only ever see that the two hashes differ, never that the difference is fine. Report the file's current hash first — hosted, with report_file_hashes; locally that already happened when you read the briefing. If the note no longer holds, fix the note instead of accepting the file.",
  });

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

  tool("get_context_note", "getContextNote", {
    title: "Read one context note in full",
    description:
      "The whole body of a single context note. get_context carries every note's title but only the newest sixty bodies per scope, and reports the rest as `context_omitted`; this is how you read one of those, or how you read past the 240-character snippet a search hit gives you. A body of null in a briefing means the note was past that ceiling, never that it is empty.",
    annotations: READ_ONLY,
  });

  tool("add_context", "addContext", {
    title: "Record durable knowledge",
    description:
      "Knowledge that outlives any single task. Omit both `project` and `cwd` to make it apply across every one of your projects (use for standing preferences and cross-project decisions). kinds: decision, convention, gotcha, preference.",
  });

  tool("update_context", "updateContext", {
    title: "Correct a context note",
    description:
      "Rewrite a note you or an earlier session recorded, once you find it is wrong or has gone out of date. `body` replaces the old one outright, so send the whole note rather than a diff. Correcting a note is worth more than adding a second one beside it: get_context hands every note to the next session, and two notes that disagree cost that session the time it takes to work out which one to believe.",
  });

  tool("delete_context", "deleteContext", {
    title: "Remove a context note",
    description:
      "For a note that should never have been written — recorded against the wrong project, or superseded so completely that keeping it would mislead. If the note is merely out of date, use update_context: a corrected note still carries why the old answer looked right, and that is often the useful half.",
  });

  /* -------------------------------------------------------------- search */

  /**
   * The description says "literal substring" because that is what the code
   * does, and the old one said "full-text-ish", which is what an agent then
   * assumed. The two failures compound: a model reads "use it to answer 'have
   * I solved this before?'", sends that sentence, matches nothing, and
   * concludes todox is empty -- the shape gotcha #13 is about, except here the
   * tool is not broken, its own description asked for the query that fails.
   *
   * `README.md` has said "Search is `ILIKE`, not full-text" in its known-gaps
   * list the whole time. Honest to the human, overselling to the agent, and
   * the agent is the one making the call.
   */
  tool("search", "search", {
    title: "Search across every project",
    description:
      "Full-text search over task titles and bodies, log entry bodies, and context note titles and bodies, across ALL of your projects, ranked by relevance. Ask it the question in words -- 'why did we choose scrypt over bcrypt' -- and it will find the note that answers it; the terms are matched independently and a record matching more of them ranks higher, so a whole sentence works and does not need narrowing. Quote a phrase to require it exactly. Stemming is applied in English and in Turkish, and a literal substring match runs underneath, so the middle of an identifier ('FileSync' inside readFileSync) is found too. Each hit carries a snippet taken from the part that matched, not from the top of the body. Not searched: entry and note kinds, file paths, project names. Returns at most `limit` hits in total (default 30).",
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
