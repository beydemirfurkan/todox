#!/usr/bin/env -S npx tsx
/**
 * todox MCP server (stdio).
 *
 * The web UI is a viewer. This is the write path: the agent is the primary
 * author of the log, the human curates it afterwards.
 *
 * Since todox grew accounts, this process no longer touches the database. It
 * authenticates with the user's API token and calls the server over HTTP, so
 * an agent on a laptop and a database on a host stay in step.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { CONTEXT_KINDS, ENTRY_KINDS, STATUSES } from "../lib/constants";
import { translator, type Lang } from "../lib/i18n";
import { renderMarkdown } from "../lib/services/report-markdown";
import type { ActivityReport } from "../lib/services/reports";
import { createClient, readConfig, type RpcClient } from "./rpc-client";

const INSTRUCTIONS = [
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
].join("\n");

const server = new McpServer(
  { name: "todox", version: "1.0.0" },
  { instructions: INSTRUCTIONS },
);

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const plain = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (msg: string) => ({
  content: [{ type: "text" as const, text: `error: ${msg}` }],
  isError: true,
});

const modelArg = z
  .string()
  .optional()
  .describe("Your own model id, e.g. 'claude-opus-5'. Always pass this.");

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

const register = server.registerTool.bind(server) as unknown as RegisterTool;

/** Every tool is the same shape: forward to the server, or report why not. */
function tool<S extends z.ZodRawShape>(
  call: RpcClient,
  name: string,
  method: string,
  config: { title: string; description: string; inputSchema: S },
  transform?: (result: unknown, args: Record<string, unknown>) => unknown,
) {
  register(name, config, async (raw) => {
    const args = raw ?? {};
    try {
      const result = await call(method, args);
      const shaped = transform ? transform(result, args) : result;
      return typeof shaped === "string" ? plain(shaped) : ok(shaped);
    } catch (e) {
      return fail((e as Error).message);
    }
  });
}

function main() {
  const { token, url } = readConfig();
  const call = createClient(url, token);

  /* ------------------------------------------------------------ projects */

  tool(call, "list_projects", "listProjects", {
    title: "List projects",
    description:
      "Every project in your todox account, with open/done counts and root paths. Cheap; call it when unsure which slug to use.",
    inputSchema: {},
  });

  tool(call, "create_project", "createProject", {
    title: "Create project",
    description:
      "Register a project explicitly. Usually unnecessary — create_task with `cwd` registers one for you. root_path is what lets any file path inside the repo resolve to this project later.",
    inputSchema: {
      name: z.string().describe("Human name, e.g. 'GameTable 3D'"),
      slug: z.string().optional().describe("Defaults to a slug of the name"),
      root_path: z.string().optional().describe("Absolute path of the repo/working dir"),
      summary: z
        .string()
        .optional()
        .describe("What this project is, in 1-3 sentences, for a cold agent"),
    },
  });

  tool(call, "update_project", "updateProject", {
    title: "Update project",
    description:
      "Set the name, root_path or summary. Worth calling right after a project is auto-created, to give it a summary a cold agent can use.",
    inputSchema: {
      project: z.string().describe("Slug, name, or a path inside the project"),
      name: z.string().optional(),
      root_path: z.string().optional(),
      summary: z.string().optional(),
    },
  });

  /* ------------------------------------------------------- the briefing */

  tool(call, "get_context", "getContext", {
    title: "Get project context (call this first)",
    description:
      "The session-start briefing: global rules, project decisions/conventions/gotchas, every open task with its decisions, dead ends, open questions, linked files and last handoff note. Also flags notes whose linked files have changed since they were written. Pass your working directory as `project`.",
    inputSchema: {
      project: z
        .string()
        .describe("Project slug, name, or any absolute path inside the project"),
      create_if_missing: z
        .boolean()
        .optional()
        .describe(
          "When `project` is an absolute path that matches nothing, register a project for that repo instead of erroring. Default false.",
        ),
    },
  });

  /* --------------------------------------------------------------- tasks */

  tool(call, "list_tasks", "listTasks", {
    title: "List tasks",
    description: "Tasks in a project, filtered by status.",
    inputSchema: {
      project: z.string().optional(),
      cwd: z
        .string()
        .optional()
        .describe("Absolute working directory, used if project is omitted"),
      status: z
        .enum([...STATUSES, "open", "all"])
        .optional()
        .describe("Default 'open' (todo + doing + blocked)"),
    },
  });

  tool(call, "get_task", "getTask", {
    title: "Get task with full log",
    description:
      "One task with its complete entry log and linked files (each marked fresh/changed/missing).",
    inputSchema: { task_id: z.number().int() },
  });

  tool(call, "create_task", "createTask", {
    title: "Create task",
    description:
      "Capture work that will not finish in this session. Pass `cwd` (your absolute working directory) and todox picks the right project — registering one for that repo if it has never seen it. Put the goal and the definition of done in `body`, not just a title.",
    inputSchema: {
      cwd: z
        .string()
        .optional()
        .describe(
          "Absolute working directory. Resolves — and if needed creates — the project.",
        ),
      project: z
        .string()
        .optional()
        .describe("Explicit slug or name. Use when the task does not belong to `cwd`."),
      title: z.string(),
      body: z.string().optional().describe("Goal, constraints, acceptance"),
      status: z.enum(STATUSES).optional(),
      priority: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe(
          "1 high, 2 normal (default), 3 low. This is what reports call importance.",
        ),
      files: z
        .array(z.string())
        .optional()
        .describe("Absolute paths of files in play; hashed for staleness"),
      model: modelArg,
    },
  });

  tool(call, "update_task", "updateTask", {
    title: "Update task",
    description:
      "Change title, body, status or priority. Moving status to 'doing' starts the clock and moving it to 'done' stops it — that is where the duration in reports comes from, so keep it honest.",
    inputSchema: {
      task_id: z.number().int(),
      title: z.string().optional(),
      body: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      priority: z.number().int().min(1).max(3).optional(),
      model: modelArg,
    },
  });

  /* ----------------------------------------------------------- the log */

  tool(call, "log_entry", "logEntry", {
    title: "Append to a task's log",
    description:
      "Append one entry. kinds: 'decision' (what was chosen and why), 'dead_end' (approach tried that did NOT work -- highest value, prevents repeats), 'question' (needs the human), 'note', 'handoff' (state at end of session: what is done, what is next, what to watch out for).",
    inputSchema: {
      task_id: z.number().int(),
      kind: z.enum(ENTRY_KINDS),
      body: z.string().describe("Write for a stranger, not for yourself"),
      author: z.enum(["agent", "human"]).optional(),
      model: modelArg,
    },
  });

  tool(call, "link_files", "linkFiles", {
    title: "Link files to a task",
    description:
      "Attach file paths to a task and hash them now, so todox can later warn that a note describes code that has since changed.",
    inputSchema: {
      task_id: z.number().int(),
      paths: z.array(z.object({ path: z.string(), note: z.string().optional() })),
    },
  });

  /* -------------------------------------------------- durable knowledge */

  tool(call, "add_context", "addContext", {
    title: "Record durable knowledge",
    description:
      "Knowledge that outlives any single task. Omit both `project` and `cwd` to make it apply across every one of your projects (use for standing preferences and cross-project decisions). kinds: decision, convention, gotcha, preference.",
    inputSchema: {
      project: z
        .string()
        .optional()
        .describe("Omit to apply across every project in your account"),
      cwd: z
        .string()
        .optional()
        .describe("Absolute working directory, used if project is omitted"),
      kind: z.enum(CONTEXT_KINDS),
      title: z.string(),
      body: z.string(),
    },
  });

  /* -------------------------------------------------------------- search */

  tool(call, "search", "search", {
    title: "Search across every project",
    description:
      "Full-text-ish search over task titles/bodies, log entries and context notes, across ALL of your projects. Use it to answer 'have I solved this before?' and 'where did I decide X?'.",
    inputSchema: { query: z.string(), limit: z.number().int().optional() },
  });

  /* ------------------------------------------------------------- reports */

  tool(
    call,
    "activity_report",
    "activityReport",
    {
      title: "What got done (today / this week / any window)",
      description:
        "A summary built from the log, not reconstructed from commits: tasks completed and opened, how long each took (time actually spent in 'doing', plus start-to-finish lead time), which models worked on them, their importance, the decisions made, the dead ends hit and the questions still open. Use format:'markdown' for something the developer can hand straight to a manager; 'json' when you need to reason over the numbers.",
      inputSchema: {
        period: z
          .enum(["today", "yesterday", "week", "last_week", "month", "all"])
          .optional()
          .describe("Default 'today'. 'week' is the current Monday-based week."),
        from: z.string().optional().describe("ISO datetime; overrides `period`"),
        to: z.string().optional().describe("ISO datetime; overrides `period`"),
        project: z
          .string()
          .optional()
          .describe("Slug, name or path. Omit to cover every project."),
        format: z.enum(["json", "markdown"]).optional().describe("Default 'json'"),
        lang: z.enum(["tr", "en"]).optional().describe("Markdown language. Default 'tr'."),
      },
    },
    // Rendering stays on this side: it is presentation, and it keeps the
    // report payload the server returns purely structural.
    (result, args) =>
      args.format === "markdown"
        ? renderMarkdown(result as ActivityReport, translator((args.lang as Lang) ?? "tr"))
        : result,
  );

  return server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
