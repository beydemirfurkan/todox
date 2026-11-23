#!/usr/bin/env -S npx tsx
/**
 * todox MCP server (stdio) — the optional local mode.
 *
 * The hosted server at /api/mcp is the way in for most people: nothing to
 * install, one URL and a token. This process exists for the one thing a remote
 * server cannot do, which is read the developer's disk — so a note can be
 * flagged when the file it describes has moved on.
 *
 * It does not touch the database either. It authenticates with the user's API
 * token and calls the HTTP API, so an agent on a laptop and a database on a
 * host stay in step.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { normalise, type ClientInfo } from "../lib/client-identity";
import type { MethodName } from "../lib/services/rpc-schemas";
import { isAbsolutePath } from "../lib/util/paths";
import { runInstallDoctor } from "./doctor";
import { runHookCommand } from "./git-hook/cli";
import { runLogin } from "./login";
import { memoryFileFor } from "../scripts/install-mcp/clients/contract";
import { hasMemoryBlock } from "../scripts/install-mcp/memory";
import { createObserver } from "./observer";
import { createClient, readConfig } from "./rpc-client";
import { instructions, registerTools, SERVER_INFO, type Workspace } from "./tools";
import {
  checkRefs,
  findProjectRoot,
  projectRootOf,
  gitBranch,
  gitCommitsSince,
  gitDirtyCount,
  gitHead,
  gitRemote,
  hashFile,
} from "./workspace";

/**
 * The client that launched this process, read from its environment.
 *
 * This side used to hand `tools.ts` the bearer token so it could look the same
 * thing up in Postgres — which this process cannot reach, so the lookup threw
 * on every call and the client-specific notes never appeared locally at all.
 * They are the notes that exist because connecting a server is not the same as
 * using it, so losing them on the local transport was losing the fix.
 *
 * The value was here the whole time: the parent sets TODOX_CLIENT_NAME when it
 * launches us, and `main` already sends it to the server. It is read back from
 * the environment rather than from the write.
 *
 * Declared above `localWorkspace` rather than at the foot of the file: `main()`
 * is called on the last line, so a `let` below that call is still in its
 * temporal dead zone when the assignment runs. Every stdio session once died on
 * startup with "Cannot access 'currentToken' before initialization" -- the
 * hosted transport was unaffected, which is why it survived.
 */
function envClient(): ClientInfo | null {
  return normalise({
    name: process.env.TODOX_CLIENT_NAME,
    version: process.env.TODOX_CLIENT_VERSION,
  });
}

/** The half of todox that has a filesystem, because it runs where the code is. */
const localWorkspace: Workspace = {
  tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  // `isAbsolutePath` rather than a leading slash: this process runs where the
  // developer is, and on Windows every path they hand us starts `C:\`.
  // `projectRootOf`, not `findProjectRoot`: this answer decides whether a
  // directory may become a project, and the fallback would say yes to every
  // directory on the disk -- including the per-prompt scratch folders some
  // clients open, which is how twelve of one account's twenty-one projects
  // came to be dated prompt titles.
  repoRoot: (path) => (isAbsolutePath(path) ? projectRootOf(path) : undefined),
  // From the root rather than the path itself: an agent hands over the file it
  // is editing as often as the directory, and `.git` only sits at the top.
  repoUrl: (path) => (isAbsolutePath(path) ? gitRemote(findProjectRoot(path)) : undefined),
  hash: hashFile,
  checkRefs,
  clientInfo: async () => envClient(),
  launchDir: () => process.cwd(),
  hasHabit: async (client) => {
    try {
      return hasMemoryBlock(await readFile(memoryFileFor(client), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  },
};

/**
 * `readConfig` throws synchronously on a missing token, so this must be async:
 * a sync throw from `main()` means it never returns a promise, `.catch()` below
 * never attaches, and the helpful "create a token on the Account page" message
 * comes out as an uncaught stack trace instead.
 */
/**
 * Past this, a tool call fails instead of hanging the agent's turn on a server
 * that stopped answering. Well above the server's own 25-second statement
 * timeout, so a slow but working call still comes back with its real answer.
 */
const TOOL_CALL_TIMEOUT_MS = 60_000;

async function main() {
  const { token, url } = readConfig();
  const call = createClient(url, token, { timeoutMs: TOOL_CALL_TIMEOUT_MS });

  // The MCP SDK consumes `initialize` before any tool callback runs, so we
  // cannot capture clientInfo from there. Instead, the parent process sets
  // TODOX_CLIENT_NAME / TODOX_CLIENT_VERSION when it launches us, and we
  // record once on startup. Best-effort: a failed record must not break the
  // connection, because the agent has not asked for anything yet.
  const clientName = process.env.TODOX_CLIENT_NAME;
  if (clientName) {
    try {
      await call("recordClientInfo", {
        name: clientName,
        version: process.env.TODOX_CLIENT_VERSION ?? "unknown",
      });
    } catch (e) {
      console.error("mcp clientInfo", e instanceof Error ? e.message : e);
    }
  }

  // The same sentence the hosted endpoint puts in front of its instructions
  // for an account that connects and never calls, asked for once here since
  // this side has no row to read. Best-effort for the same reason the client
  // record above is: a session must not fail to start over a measurement.
  let nudge: string | null = null;
  try {
    const reply = (await call("sessionNudge", clientName ? { client: clientName } : {})) as {
      nudge?: string | null;
    } | null;
    nudge = reply?.nudge ?? null;
  } catch (e) {
    console.error("mcp nudge", e instanceof Error ? e.message : e);
  }

  const server = new McpServer(SERVER_INFO, {
    instructions: instructions({ local: true }, nudge),
  });

  /**
   * The automatic half of the log, and the only thing here the model cannot
   * see.
   *
   * This process is the carrier because it is the one that can read the disk
   * and because it is the one every MCP client starts -- Claude Code hooks
   * would have been richer and would have worked for one client out of the
   * five the README names.
   *
   * `off` rather than a truthy check: the switch exists to be turned off in a
   * hurry, and an unset variable has to mean on.
   */
  const observer = createObserver({
    call: (method, params) => call(method as MethodName, params),
    git: {
      root: (path) => (isAbsolutePath(path) ? findProjectRoot(path) : undefined),
      head: gitHead,
      branch: gitBranch,
      dirty: gitDirtyCount,
      since: gitCommitsSince,
    },
    // Per process, which is as close to a session boundary as a tool call can
    // get: a client starts one of these when it opens and kills it when it
    // closes. What it cannot see is a conversation cleared inside a client
    // that keeps the process alive, and that is a Claude Code hook's job.
    sessionId: randomUUID(),
    cwd: process.cwd(),
    client: process.env.TODOX_CLIENT_NAME,
    enabled: process.env.TODOX_OBSERVE !== "off",
  });

  registerTools(
    server,
    async (method: MethodName, params) => {
      const result = await call(method, params);
      // Not awaited: the agent's tool call must not wait on bookkeeping, and
      // `notice` resolves whatever happens -- never rejecting is the contract
      // that makes this `void` safe. Work lost to a process dying mid-write is
      // picked up by the next session, which is what the widening is for.
      // After the call rather than before it, so a refused update_task never
      // marks a task as taken on.
      void observer.notice(method, params);
      return result;
    },
    localWorkspace,
  );

  closeWithLastLook(() => observer.flush());
  return server.connect(new StdioServerTransport());
}

/**
 * How long the last look may hold up an exit. A client closing this process
 * is not going to wait for a slow network, and an observation is worth less
 * than a process that leaves when it is told to.
 */
const LAST_LOOK_MS = 3_000;

/**
 * Exit when the client hangs up -- stdin ends, or a signal arrives -- after
 * one last look at the checkout. Without it, a session shorter than the
 * observer's interval never wrote anything (dogfood 2026-11-22, B10).
 */
function closeWithLastLook(lastLook: () => Promise<void>): void {
  let isClosing = false;
  const close = () => {
    if (isClosing) return;
    isClosing = true;
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, LAST_LOOK_MS).unref());
    void Promise.race([lastLook(), deadline]).finally(() => process.exit(0));
  };
  process.stdin.on("end", close);
  process.stdin.on("close", close);
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}

/**
 * `todox-mcp doctor [cwd]` is the one thing this binary does that is not
 * being an MCP server. Dispatched before `readConfig()`, because the doctor's
 * job is to find the token in the client configs -- it must not need one in
 * the environment to start. A static import above rather than a dynamic one
 * here: `pack-mcp` walks `require(...)` to decide what ships, and a dynamic
 * import would be pruned from the package and throw on the first run.
 */
if (process.argv[2] === "hook") {
  // The git hook's installer, like the doctor, needs no token to start: it
  // is how one gets saved.
  try {
    process.exit(runHookCommand(process.argv.slice(3), process.env, process.cwd()));
  } catch (e) {
    console.error("[todox] hook:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
} else if (process.argv[2] === "login") {
  // How a token gets saved without anyone copying one: also before readConfig.
  // `exitCode`, not `exit()`: right after a `fetch`, an explicit exit on
  // Windows trips a libuv assertion and turns a successful login into a crash
  // code. Nothing else is left running here, so the loop drains by itself.
  runLogin(process.argv.slice(3), process.env).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error("[todox] login:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
} else if (process.argv[2] === "doctor") {
  runInstallDoctor(process.argv[3] ?? process.cwd()).then(
    (code) => process.exit(code),
    (e) => {
      console.error("[todox] doctor:", e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
} else {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
