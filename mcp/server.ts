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

import { translator, type Lang } from "../lib/i18n";
import { renderMarkdown } from "../lib/services/report-markdown";
import type { ActivityReport } from "../lib/services/reports";
import { SHAPES, type MethodName } from "../lib/services/rpc-schemas";
import { createClient, readConfig, type RpcClient } from "./rpc-client";
import { checkRefs, findProjectRoot, hashFile } from "./workspace";

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

/** Parameters this process supplies from its own environment, never the model. */
const INTERNAL: string[] = ["repo_root", "tz"];

/**
 * Every tool is the same shape: forward to the server, or report why not.
 *
 * The input schema is not written here — it comes from `SHAPES`, the same
 * definition the server validates against. Declaring it twice is how a tool
 * starts advertising an argument the server rejects.
 */
function tool(
  call: RpcClient,
  name: string,
  method: MethodName,
  config: { title: string; description: string },
  opts: {
    /** Arguments this side consumes itself; added to the schema, never sent. */
    presentation?: z.ZodRawShape;
    /**
     * Fields advertised to the model instead of the server's version, for the
     * few the model should not have to fill in itself. `create_task` takes
     * plain paths here and this process attaches the hashes.
     */
    overrides?: z.ZodRawShape;
    /** Last chance to add what only this side knows, before the call goes out. */
    prepare?: (params: Record<string, unknown>) => Record<string, unknown>;
    /** Runs on the result, and may call back to the server. */
    after?: (result: unknown, call: RpcClient) => Promise<unknown>;
    transform?: (result: unknown, args: Record<string, unknown>) => unknown;
  } = {},
) {
  const shape = SHAPES[method];
  const accepted = Object.keys(shape);

  // Advertised to the model minus the fields this process fills in itself.
  // `repo_root` is not something a model should be inventing; leaving it in the
  // schema is an invitation to guess at a path it cannot see.
  const advertised = Object.fromEntries(
    Object.entries({ ...shape, ...opts.overrides, ...opts.presentation }).filter(
      ([k]) => !INTERNAL.includes(k),
    ),
  ) as z.ZodRawShape;

  register(
    name,
    { ...config, inputSchema: advertised },
    async (raw) => {
      const args = raw ?? {};
      // Forward only what the server's schema declares. It rejects unknown
      // keys, and it should: presentation options and any metadata the SDK
      // adds are ours to deal with, not something to make the server tolerate.
      let params = Object.fromEntries(
        Object.entries(args).filter(([k]) => accepted.includes(k)),
      );
      // This process runs where the developer is, so it is the only side that
      // knows their timezone. Without it the server measures "today" in UTC.
      if (accepted.includes("tz") && params.tz === undefined)
        params.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // Same reasoning for the repository root: the web host has no checkout,
      // so it cannot walk up looking for a .git.
      if (accepted.includes("repo_root") && params.repo_root === undefined) {
        const ref = (params.cwd ?? params.project) as string | undefined;
        if (typeof ref === "string" && ref.startsWith("/"))
          params.repo_root = findProjectRoot(ref);
      }
      if (opts.prepare) params = opts.prepare(params);

      try {
        const result = await call(method, params);
        const settled = opts.after ? await opts.after(result, call) : result;
        const shaped = opts.transform ? opts.transform(settled, args) : settled;
        return typeof shaped === "string" ? plain(shaped) : ok(shaped);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}

/**
 * Hashes every linked file the payload mentions, rewrites its `status`, and
 * tells the server what it found.
 *
 * The server stores hashes and compares them; it never opens a file, because
 * it does not have one. So the answer to "has this note gone stale" can only
 * come from here, and the web UI only knows what we last reported.
 */
async function checkLinkedFiles(result: unknown, call: RpcClient) {
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

  const { checked, seen } = checkRefs(refs);
  const byId = new Map(checked.map((c) => [c.id, c]));
  for (const f of buckets) {
    const hit = byId.get(f.id as number);
    if (hit) f.status = hit.status;
  }

  // Best effort: a failed write-back must not cost the agent its briefing.
  try {
    await call("reportRefs", { refs: seen });
  } catch {
    /* the status above is still correct for this call */
  }

  // The briefing's own summary was built from what the server had on file.
  const stale = checked.filter((c) => c.status === "changed" || c.status === "missing");
  if (Array.isArray((result as { stale_refs?: unknown }).stale_refs))
    (result as { stale_refs: string[] }).stale_refs = stale.map(
      (c) => `${c.path} (${c.status})`,
    );

  return result;
}

/**
 * `readConfig` throws synchronously on a missing token, so this must be async:
 * a sync throw from `main()` means it never returns a promise, `.catch()` below
 * never attaches, and the helpful "create a token on the Account page" message
 * comes out as an uncaught stack trace instead.
 */
async function main() {
  const { token, url } = readConfig();
  const call = createClient(url, token);

  /* ------------------------------------------------------------ projects */

  tool(call, "list_projects", "listProjects", {
    title: "List projects",
    description:
      "Every project in your todox account, with open/done counts and root paths. Cheap; call it when unsure which slug to use.",
  });

  tool(call, "create_project", "createProject", {
    title: "Create project",
    description:
      "Register a project explicitly. Usually unnecessary — create_task with `cwd` registers one for you. root_path is what lets any file path inside the repo resolve to this project later.",
  });

  tool(call, "update_project", "updateProject", {
    title: "Update project",
    description:
      "Set the name, root_path or summary. Worth calling right after a project is auto-created, to give it a summary a cold agent can use.",
  });

  /* ------------------------------------------------------- the briefing */

  tool(
    call,
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

  tool(call, "list_tasks", "listTasks", {
    title: "List tasks",
    description: "Tasks in a project, filtered by status.",
  });

  tool(
    call,
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
    call,
    "create_task",
    "createTask",
    {
      title: "Create task",
      description:
        "Capture work that will not finish in this session. Pass `cwd` (your absolute working directory) and todox picks the right project — registering one for that repo if it has never seen it. Put the goal and the definition of done in `body`, not just a title.",
    },
    {
      // The model names files; this side hashes them. Asking a model for a
      // sha256 would be asking it to invent one.
      overrides: {
        files: z
          .array(z.string())
          .optional()
          .describe("Absolute paths of files in play; hashed here for staleness"),
      },
      prepare: (p) => ({
        ...p,
        files: Array.isArray(p.files)
          ? (p.files as string[]).map((path) => ({ path, hash: hashFile(path) }))
          : undefined,
      }),
    },
  );

  tool(call, "update_task", "updateTask", {
    title: "Update task",
    description:
      "Change title, body, status or priority. Moving status to 'doing' starts the clock and moving it to 'done' stops it — that is where the duration in reports comes from, so keep it honest.",
  });

  /* ----------------------------------------------------------- the log */

  tool(call, "log_entry", "logEntry", {
    title: "Append to a task's log",
    description:
      "Append one entry. kinds: 'decision' (what was chosen and why), 'dead_end' (approach tried that did NOT work -- highest value, prevents repeats), 'question' (needs the human), 'note', 'handoff' (state at end of session: what is done, what is next, what to watch out for).",
  });

  tool(
    call,
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
              hash: hashFile(x.path),
            }))
          : p.paths,
      }),
    },
  );

  /* -------------------------------------------------- durable knowledge */

  tool(call, "add_context", "addContext", {
    title: "Record durable knowledge",
    description:
      "Knowledge that outlives any single task. Omit both `project` and `cwd` to make it apply across every one of your projects (use for standing preferences and cross-project decisions). kinds: decision, convention, gotcha, preference.",
  });

  /* -------------------------------------------------------------- search */

  tool(call, "search", "search", {
    title: "Search across every project",
    description:
      "Full-text-ish search over task titles/bodies, log entries and context notes, across ALL of your projects. Use it to answer 'have I solved this before?' and 'where did I decide X?'.",
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

  return server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
