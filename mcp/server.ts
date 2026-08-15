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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { MethodName } from "../lib/services/rpc-schemas";
import { isAbsolutePath } from "../lib/util/paths";
import { createClient, readConfig } from "./rpc-client";
import { instructions, registerTools, type Workspace } from "./tools";
import { checkRefs, findProjectRoot, hashFile } from "./workspace";

/**
 * Read by `localWorkspace.bearerToken`. Set inside `main`; undefined at import.
 *
 * Declared here rather than at the foot of the file: `main()` is called on the
 * last line and assigns this synchronously, so a `let` below that call is still
 * in its temporal dead zone when the assignment runs. Every stdio session died
 * on startup with "Cannot access 'currentToken' before initialization" -- the
 * hosted transport was unaffected, which is why it survived unnoticed.
 */
let currentToken: string | undefined;

/** The half of todox that has a filesystem, because it runs where the code is. */
const localWorkspace: Workspace = {
  tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  // `isAbsolutePath` rather than a leading slash: this process runs where the
  // developer is, and on Windows every path they hand us starts `C:\`.
  repoRoot: (path) => (isAbsolutePath(path) ? findProjectRoot(path) : undefined),
  hash: hashFile,
  checkRefs,
  // Filled in by `main` once `readConfig` has resolved the token. The workspace
  // object is captured by `registerTools` at registration time, but it points
  // at the `currentToken` slot, so updating the slot updates every call.
  bearerToken: () => currentToken,
};

/**
 * `readConfig` throws synchronously on a missing token, so this must be async:
 * a sync throw from `main()` means it never returns a promise, `.catch()` below
 * never attaches, and the helpful "create a token on the Account page" message
 * comes out as an uncaught stack trace instead.
 */
async function main() {
  const { token, url } = readConfig();
  currentToken = token;
  const call = createClient(url, token);

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

  const server = new McpServer(
    { name: "todox", version: "1.0.0" },
    { instructions: instructions({ local: true }) },
  );

  registerTools(server, (method: MethodName, params) => call(method, params), localWorkspace);

  return server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
