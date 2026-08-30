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

import { normalise, type ClientInfo } from "../lib/client-identity";
import type { MethodName } from "../lib/services/rpc-schemas";
import { isAbsolutePath } from "../lib/util/paths";
import { createClient, readConfig } from "./rpc-client";
import { instructions, registerTools, SERVER_INFO, type Workspace } from "./tools";
import { checkRefs, findProjectRoot, gitRemote, hashFile } from "./workspace";

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
  repoRoot: (path) => (isAbsolutePath(path) ? findProjectRoot(path) : undefined),
  // From the root rather than the path itself: an agent hands over the file it
  // is editing as often as the directory, and `.git` only sits at the top.
  repoUrl: (path) => (isAbsolutePath(path) ? gitRemote(findProjectRoot(path)) : undefined),
  hash: hashFile,
  checkRefs,
  clientInfo: async () => envClient(),
};

/**
 * `readConfig` throws synchronously on a missing token, so this must be async:
 * a sync throw from `main()` means it never returns a promise, `.catch()` below
 * never attaches, and the helpful "create a token on the Account page" message
 * comes out as an uncaught stack trace instead.
 */
async function main() {
  const { token, url } = readConfig();
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

  const server = new McpServer(SERVER_INFO, {
    instructions: instructions({ local: true }),
  });

  registerTools(server, (method: MethodName, params) => call(method, params), localWorkspace);

  return server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
