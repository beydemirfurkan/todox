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
import { createClient, readConfig } from "./rpc-client";
import { instructions, registerTools, type Workspace } from "./tools";
import { checkRefs, findProjectRoot, hashFile } from "./workspace";

/** The half of todox that has a filesystem, because it runs where the code is. */
const localWorkspace: Workspace = {
  tz: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  repoRoot: (path) => (path.startsWith("/") ? findProjectRoot(path) : undefined),
  hash: hashFile,
  checkRefs,
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
