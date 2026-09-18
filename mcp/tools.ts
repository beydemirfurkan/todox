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
  "todox is the persistent working memory for this developer's projects: what",
  "was decided and why, what was tried and failed, what is still open, and where",
  "the last session stopped. Written agent-to-agent, read by a human over the",
  "shoulder. Not everything is worth keeping: an entry that restates the diff,",
  "or a task for something you are finishing now, is noise the next session",
  "reads past.",
  "",
  "START: call get_context with `cwd` (absolute path). It resolves the project,",
  "registers a new repo, and returns the standing rules, decisions, dead ends",
  "and open tasks. Send `focus` -- one sentence on what this session is for --",
  "so the budget is spent on relevant notes rather than the newest; a focus that",
  "matches nothing changes nothing.",
  "",
  "LOOK UP: search covers every project. Ask it in words -- the query is",
  "parsed and ranked -- and quote a phrase to require it. kinds:['dead_end'] answers",
  "'has this been tried?', kinds:['decision'] 'why is it like this?'.",
  "BEFORE YOU EDIT A FILE: get_file_context(path) gives the tasks, dead ends and",
  "notes attached to it -- the cheapest call here and the one most worth making.",
  "DO NOT READ list_tasks status:'all' or activity_report period:'all': they",
  "return everything ever, bodies included.",
  "",
  "CAPTURE: create_task (pass `cwd`) for anything the developer mentions that",
  "will not finish this session. Registering a NEW project needs `repo_root` or",
  "`repo_url` -- a bare cwd is a directory, not a repository; the refusal names",
  "what to send. Put the plan a task follows in `files`, wherever it lives;",
  "todox warns when it moves on.",
  "",
  "WHILE WORKING: update_task to move status -- 'doing' when you actually start,",
  "that is what makes time reports real. log_entry for 'decision' (what and why",
  "it beat the alternative), 'dead_end' (what failed and how -- the highest-value",
  "entry there is), 'question' (something only the developer can settle that",
  "you must leave open; say what you would do unanswered; never for what search",
  "or the diff would answer). When you settle a question, log the answer with",
  "answers_entry_id -- nothing else closes one. add_context for what outlives a",
  "task: a convention, a gotcha, a standing preference; omit project and cwd to",
  "make it account-wide.",
  "",
  "WRITE SHORT. One entry says one thing. The briefing shows every entry's",
  "FIRST LINE and pays for whole bodies only while a byte budget lasts, so the",
  "first line is a headline and the body is a screen at most. Measurements,",
  "listings and options nobody chose go in the task body or a note, not the",
  "log. A handoff nobody finishes reading is the failure mode, not a short one.",
  "",
  "OBSERVATIONS: a briefing MAY carry `observations` -- what a process saw git",
  "do while an earlier session ran. Evidence, never intent: do not repeat one",
  "to the developer as a recorded decision. Worth keeping? Write the real",
  "record with from_observation_id; otherwise it expires. `handoff_missing`",
  "names tasks that session set 'doing' and never wrote up: continue or reset",
  "them.",
  "",
  "Pass `model` (your model id) on create_task, update_task, log_entry; it is",
  "stored on the row so reports can say which model did what.",
  "",
  "BEFORE YOU FINISH: call session_status(cwd). It names the tasks you touched",
  "this session and what each still lacks; work through it, in this order:",
  "1. update_task: every task you touched shows its true status. One set to",
  "   'doing' and not finished goes back to 'todo' or 'blocked' -- a task left",
  "   'doing' by a session that ended is the log going stale.",
  "2. log_entry(kind:'dead_end') for each approach that failed, if not logged",
  "   yet.",
  "3. log_entry(kind:'handoff') on every task you touched -- state, next step,",
  "   what to watch -- enough for a fresh session to continue without asking.",
  "Not finished until all three are done.",
  "",
  "A REFUSED WRITE names what is missing: send it and retry once. Refused twice",
  "with the same message, stop -- do not reword the call -- and tell the",
  "developer what was refused and why.",
  "",
  "REPORTING: activity_report answers 'what got done today / this week' from the",
  "log, with durations and models; format:'markdown' for something to hand on.",
];

const LOCAL_NOTE = [
  "",
  "FILES: link_files and create_task's `files` take plain paths; this process",
  "hashes them, so todox can later warn that a note describes changed code.",
  "OBSERVATIONS: this process is the one that writes them -- it watches the",
  "checkout it was started in while you work. Over the hosted endpoint that",
  "section is always empty, which is why the two notes differ.",
];

const REMOTE_NOTE = [
  "",
  "THIS SERVER HAS NO FILESYSTEM, BUT YOU DO. The parts that need a disk are",
  "yours:",
  "- `cwd` absolute, plus `repo_root` (the directory holding .git) or",
  "  `repo_url` (`git remote get-url origin`, verbatim) on get_context and",
  "  create_task. Registering a new project refuses without one of them; the",
  "  remote is what keeps the same repo on a second machine from becoming a",
  "  second project. A checkout with no remote is still a repository: send",
  "  repo_root.",
  "- `tz` (IANA, e.g. 'Europe/Istanbul') on reports, or say the window is UTC.",
  "- on first registration, update_project with a one-paragraph summary and",
  "  repo_url.",
  "- when you link a file, send its sha256 `hash`; after get_context or",
  "  get_task hands you linked files, re-hash the ones you can read and send",
  "  them to report_file_hashes with their ids. That is what turns a stale note",
  "  into a warning.",
  "",
  "`observations` is always empty on this transport: only a process on the",
  "developer's machine can watch git. Nothing is wrong when it is empty and no",
  "call fills it; the stdio server (todox-mcp) is the one that captures.",
];

/**
 * The session instructions, with the one sentence that is about THIS account
 * in front of them when there is one.
 *
 * `nudge` is what `lib/services/nudge.ts` has to say to an account that has
 * been connecting and never calling -- measured from tool_usage, null for
 * everyone else. First rather than last, because it is the one paragraph a
 * silent account has to act on before it reads anything else, and because
 * an agent that has been ignoring this server has been ignoring the end of
 * these instructions in particular.
 */
export function instructions(ws: { local: boolean }, nudge: string | null = null) {
  const body = [...BASE, ...(ws.local ? LOCAL_NOTE : REMOTE_NOTE)].join("\n");
  return nudge ? `${nudge}\n\n${body}` : body;
}

/**
 * The same text as a skill file, for a client that loads skills by
 * description.
 *
 * The body is `BASE` verbatim -- not a paraphrase, not a summary -- because a
 * skill and the server's `instructions` describe the same protocol to the
 * same agent, and two wordings of one protocol is how the config snippets
 * drifted before `lib/mcp-clients.ts` existed. Transport-neutral: neither
 * LOCAL_NOTE nor REMOTE_NOTE, since a skill file cannot know which transport
 * the client's config names, and the server says that half at `initialize`.
 *
 * Frontmatter is `name` and `description` and nothing else: the two fields
 * all five clients require, and the only two they all understand. The
 * description is written to match the moments this text is for -- a session
 * starting, work being captured, a session ending -- because the description
 * is what a client reads to decide whether to load the rest. One line, not a
 * folded scalar: five parsers read this, and `key: value` is the one shape
 * none of them can get wrong.
 */
export function skillDocument(): string {
  return [
    "---",
    "name: todox",
    "description: Persistent working memory for this developer's projects over the todox MCP server. " +
      "Use at the start of a session (get_context), whenever a decision, dead end, question or task " +
      "worth keeping comes up, and before finishing (handoff). Says which tool to call when, and what to write.",
    "---",
    "",
    "<!-- Written by `pnpm install:mcp --write-skill`. The same text the todox",
    "MCP server sends at initialize; re-run after upgrading. -->",
    "",
    ...BASE,
    "",
  ].join("\n");
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
export const SERVER_INFO = { name: "todox", version: "0.1.3" } as const;

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
    inputSchema: z.ZodRawShape | z.ZodType;
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
 * Make the alternative project references visible in the MCP JSON schema.
 *
 * A Zod `refine` enforces this on the server but disappears when Zod converts
 * it to JSON Schema. The model then sees two optional fields and can produce a
 * call the server will always reject. Zod metadata adds the missing `anyOf`
 * while keeping an object at the root, as required by the MCP SDK.
 */
function schemaWithProjectReference(shape: z.ZodRawShape): z.ZodType {
  const project = shape.project;
  const cwd = shape.cwd;
  if (!(project instanceof z.ZodOptional) || !(cwd instanceof z.ZodOptional))
    throw new Error("project and cwd must be optional fields");

  return z
    .object(shape)
    .strict()
    .refine((value) => value.project || value.cwd, {
      message: "pass either `project` or `cwd`",
    })
    .meta({
      anyOf: [{ required: ["project"] }, { required: ["cwd"] }],
    });
}

/**
 * Adds the captured MCP client and a short list of client-specific notes to
 * a `get_context` result. The DB lookup is one extra round trip on the one
 * tool the agent is told to call first, which is the right place to pay it.
 *
 * The notes are setup advice, and the workspace decides whether it is still
 * setup: the hosted side answers null once the token is a week old, so the
 * paragraph that names the memory file is read while it is news and not at
 * the top of every session for a month, which is what two accounts in
 * production did before this was measured.
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Keep the receipt useful without echoing the body the caller just sent. */
function compactTaskCreation(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.task) || !isRecord(result.project)) return result;

  const { body, ...task } = result.task;
  const id = task.id;
  const slug = result.project.slug;
  if (typeof id !== "number" || typeof slug !== "string") return result;

  return {
    ...result,
    task: { ...task, body_characters: typeof body === "string" ? body.length : 0 },
    task_path: `/p/${slug}/t/${id}`,
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
              `We are finishing. Call session_status with cwd "${cwd}" first: it lists`,
              "the tasks you touched and what each still lacks. Then, for every task",
              "it names or you touched, in this order:",
              "",
              "1. update_task to its true status: 'done', or back to 'todo'/'blocked'",
              "   if you set it 'doing' and did not finish.",
              "2. log_entry(kind:'dead_end') for every approach that did NOT work --",
              "   the entry that saves the most time later.",
              "3. log_entry(kind:'decision') for what is worth keeping and why the",
              "   alternatives lost; kind:'question' for anything only I can answer.",
              "4. log_entry(kind:'handoff'), for someone who was not here: done, next,",
              "   what to watch out for.",
              "",
              "Skip anything a diff would already show. Pass your own model id. A write",
              "refused twice with the same message: stop and tell me what was refused.",
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
   * What `ws.repoUrl` answered for a reference, kept for the process.
   *
   * The remote is asked for on every local get_context, get_file_context and
   * create_task, and each ask is a `git remote get-url` spawn -- for a value
   * that only matters the first time a project is registered and does not
   * change while a session runs. Per process, not per module: the hosted
   * route builds a fresh workspace per request and answers undefined anyway.
   * A remote added mid-session is seen when the process restarts.
   */
  const remotes = new Map<string, string | undefined>();
  const repoUrl = (ref: string): string | undefined => {
    // Keyed on the repository, not the reference: get_context asks with the
    // root it just found and get_file_context with the working directory,
    // and those are one checkout. The walk up to `.git` is a few stats.
    const key = ws.repoRoot(ref) ?? ref;
    if (!remotes.has(key)) remotes.set(key, ws.repoUrl(key));
    return remotes.get(key);
  };

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
      /** A project-resolved call must name a project or the working directory. */
      referenceRequirement?: "project-or-cwd";
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

    const inputSchema =
      opts.referenceRequirement === "project-or-cwd"
        ? schemaWithProjectReference(advertised)
        : advertised;

    register(name, { ...config, inputSchema }, async (raw) => {
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
          const url = repoUrl(ref);
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
   * What this process last told the server about each linked file, so the
   * same answer is not posted again on every briefing.
   *
   * `checkLinkedFiles` runs on every get_context and get_task, and the report
   * it sends is a second HTTP round trip -- with the four authentication
   * statements behind it -- that used to go out whenever the payload carried
   * any linked file at all, changed or not. The hashes are still computed
   * every call, because that is how the statuses in the payload are made true
   * and a sha256 of a source file costs nothing; the round trip is what is
   * spared. The first sight of a file in a session is always reported, so
   * `checked_at` moves once per session even for a file nothing touched.
   */
  const reported = new Map<number, string | null>();

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

    // Only what the server has not heard from this process yet. Recorded
    // after the post, not before: a report that failed is one to make again.
    const unreported = seen.seen.filter((r) => !reported.has(r.id) || reported.get(r.id) !== r.hash);
    if (unreported.length) {
      // Best effort: a failed write-back must not cost the agent its briefing.
      try {
        await call("reportRefs", { refs: unreported });
        for (const r of unreported) reported.set(r.id, r.hash);
      } catch {
        /* the status above is still correct for this call */
      }
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
      "Projects that hold a task or a note, newest activity first, with counts and paths. Empty ones are left out (`empty_projects_omitted`) but still resolve by slug or path.",
    annotations: READ_ONLY,
  });

  tool("create_project", "createProject", {
    title: "Create project",
    description:
      "Register a project by name. Usually unnecessary: get_context and create_task register one from `cwd`.",
  });

  tool("update_project", "updateProject", {
    title: "Update project",
    description:
      "Set name, root_path, repo_url or summary. Right after a project is registered, a one-paragraph summary and repo_url are what make it legible from another machine.",
  });

  tool("delete_project", "deleteProject", {
    title: "Delete a project",
    description:
      "Removes a project and everything under it. Not recoverable; `confirm` must be its slug. Ask the human first.",
  });

  tool("merge_projects", "mergeProjects", {
    title: "Merge one project into another",
    description:
      "Fold a duplicate project into the real one, keeping both sides' tasks, entries, notes and paths -- for the same repository registered twice (`todox` and `todox-2`). `from` stops existing; `confirm` must be its slug. Not undoable: ask the human first, then set repo_url on the survivor.",
  });

  /* ------------------------------------------------------- the briefing */

  tool(
    "get_context",
    "getContext",
    {
      title: "Get project context (call this first)",
      // Overlaps with the server instructions on purpose: not every client
      // shows them, and a tool description is the one place an agent always
      // looks. What is here is what changes how the payload is read -- the
      // caps, what null means, which counts mean what -- not the pitch.
      description:
        "The session-start briefing: standing rules, decisions, dead ends, open questions, open tasks with their linked files and the last handoff. Call it first, with `cwd`. Capped: fifty open tasks, three entries per kind per task (one handoff), and a byte budget on every body -- notes, task bodies and log entries -- smaller with a `focus`. Nothing is truncated: every record keeps its `id` and `head` (first line), and a `body` of null means the budget was already spent, never that the record is empty -- `get_task` and `get_context_note` read the rest. `open_tasks_omitted`/`log_omitted` count records NOT here; `context_omitted`/`task_bodies_omitted`/`log_bodies_omitted` count records here without a body. `focus` (one sentence on what this session is for) spends the budget on what is relevant instead of what is newest; `context_ranked_by`/`log_ranked_by` say which you got. Open tasks untouched for 14+ days come back head-only in `idle_tasks` -- title, status, days idle, last handoff head -- and cost no budget.",
      annotations: READ_ONLY,
    },
    {
      // A model cannot invent a sha256, and it cannot invent a git remote
      // either -- but unlike a hash, a plausible guess parses cleanly and
      // becomes this project's identity for good. So locally it is not asked.
      localInternal: ["repo_url"],
      after: checkLinkedFiles,
      transform: async (result, _args) => appendClientNotes(ws, result),
      referenceRequirement: "project-or-cwd",
    },
  );

  tool(
    "get_file_context",
    "getFileContext",
    {
      title: "What is known about one file",
      description:
        "Everything todox has recorded against a file: the tasks that touched it with their dead ends and decisions, and the context notes attached to it in full. Ask before editing a file you have not seen this session — a dead end costs nothing to read and an afternoon to rediscover. The path may be absolute or relative to the repository root; both fold to the same answer, so a note linked on one machine is found from another. Pass `cwd` or `project` to say which repository is being asked about.",
      annotations: READ_ONLY,
    },
    // Same as get_context: locally the process reads the remote off the
    // checkout, so asking the model for it would be asking it to shell out to
    // git for something already on disk.
    { referenceRequirement: "project-or-cwd", localInternal: ["repo_url"] },
  );

  tool(
    "session_status",
    "sessionStatus",
    {
      title: "What this session still owes",
      description:
        "Call before finishing. `yours`: the tasks you changed or wrote on in this project within `hours` (default 12), any status, each with whether a handoff was written since the last thing you did there. `stale`: tasks 'doing' for 7+ days with nothing logged, by anyone. Ids, titles, dates and one boolean -- small on purpose. Empty lists mean nothing is owed. `hint` says what to do about each list.",
      annotations: READ_ONLY,
    },
    { referenceRequirement: "project-or-cwd", localInternal: ["repo_url"] },
  );

  /* --------------------------------------------------------------- tasks */

  tool(
    "list_tasks",
    "listTasks",
    {
      title: "List tasks",
      description: "Tasks in a project, filtered by status.",
      annotations: READ_ONLY,
    },
    { referenceRequirement: "project-or-cwd" },
  );

  tool(
    "get_task",
    "getTask",
    {
      title: "Get task with full log",
      description:
        "One task, its whole log (newest 200; `entries_omitted` if more) and its linked files marked fresh/changed/missing.",
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
        "Capture work that will not finish this session. Pass `cwd` and todox picks the project; registering a new one needs `repo_root` or `repo_url` too. Put the goal and the definition of done in `body`.",
    },
    // Local only. A process sitting next to the code can hash it, so the model
    // is asked for paths and nothing else -- asking it for a sha256 would be
    // asking it to invent one. Remote, the schema's own `{path, hash}` stands,
    // because there the agent is the one with the file.
    {
      referenceRequirement: "project-or-cwd",
      transform: compactTaskCreation,
      ...(local
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
        : {}),
    },
  );

  tool("update_task", "updateTask", {
    title: "Update task",
    description:
      "Change title, body, status or priority. 'doing' starts the clock, 'done' stops it; that is where report durations come from.",
  });

  /* ----------------------------------------------------------- the log */

  tool("log_entry", "logEntry", {
    title: "Append to a task's log",
    description:
      "Append one entry: 'decision', 'dead_end', 'question', 'note' or 'handoff'. First line is the headline the briefing shows; keep the body to a screen. Settling an earlier question? Pass its id as `answers_entry_id` -- nothing else closes one.",
  });

  tool("delete_entry", "deleteEntry", {
    title: "Remove a log entry",
    description:
      "For an entry that was wrong when written (wrong task, a decision never made). An entry overtaken by later work is history, not wrong: append instead. Not for tidying.",
  });

  tool(
    "link_files",
    "linkFiles",
    {
      title: "Link files to a task or a note",
      description:
        "Attach file paths to a task (`task_id`) or a note (`context_id`), one or the other -- the files the work touches, and the plan it follows, wherever that lives: a path outside the repository is fine and a URL (a claude.ai artifact, say) is kept as written. todox can then warn when a linked file changes, and get_file_context can find the task or note from the path.",
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
      "Remove a link whose file was deleted, renamed or attached by mistake. Nothing on disk is touched.",
  });

  tool("accept_file_change", "acceptRef", {
    title: "Accept a changed file as still correct",
    description:
      "Clear the stale warning on a linked file once you have read the change and the note still holds (report its current hash first; hosted, via report_file_hashes). If the note no longer holds, fix the note instead.",
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
        "After get_context or get_task: sha256 each linked file you can read (null if gone) and send them back with their ids. The server has no copy of the code; this is how it learns a note went stale.",
    });

  /* -------------------------------------------------- durable knowledge */

  tool("get_context_note", "getContextNote", {
    title: "Read one context note in full",
    description:
      "The whole body of one context note -- for a note the briefing's budget did not reach (body null, never empty) or a search snippet you need the rest of. Entries are read with get_task.",
    annotations: READ_ONLY,
  });

  tool("add_context", "addContext", {
    title: "Record durable knowledge",
    description:
      "Knowledge that outlives a task: decision, convention, gotcha, preference. Omit `project` and `cwd` to make it account-wide.",
  });

  tool("update_context", "updateContext", {
    title: "Correct a context note",
    description:
      "Rewrite a note that is wrong or out of date; `body` replaces the whole thing. Correct rather than add a second note that disagrees.",
  });

  tool("delete_context", "deleteContext", {
    title: "Remove a context note",
    description:
      "For a note that should never have been written (wrong project, or so superseded it misleads). Merely out of date: update_context.",
  });

  /* -------------------------------------------------------------- search */

  /**
   * The description says what the query does with a sentence, because an
   * agent decides how to phrase the query from this text and nothing else.
   * When search was a substring match its description said "full-text-ish",
   * a model sent a whole question, matched nothing, and concluded todox was
   * empty -- the shape gotcha #13 is about, except the tool was not broken,
   * its own description had asked for the query that fails. Search has been
   * full-text since PR #61; `tools.test.ts` holds the description to it.
   */
  tool("search", "search", {
    title: "Search across every project",
    description:
      "Full-text search over tasks, log entries and notes across ALL your projects, ranked by relevance. Ask in words -- 'why did we choose scrypt over bcrypt' -- terms match independently and more matches rank higher; quote a phrase to require it. Stemmed in English and Turkish, with a substring match underneath so 'FileSync' finds readFileSync. Each hit carries a snippet from the matching part. Filters narrow, never search: `kinds` (['dead_end'] = has this been tried?, ['decision'] = why is it like this?; tasks have no kind), `project` (account-wide notes still come back). Leave both out unless the question has a shape. Not searched: file paths, project names. At most `limit` hits (default 30).",
    annotations: READ_ONLY,
  });

  /* ------------------------------------------------------------- reports */

  tool(
    "activity_report",
    "activityReport",
    {
      title: "What got done (today / this week / any window)",
      description:
        "What got done in a window, from the log: tasks completed and opened, time in 'doing' and lead time, models, decisions, dead ends, open questions. format:'markdown' to hand on, 'json' to reason over. Prefer a named period to 'all'.",
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
