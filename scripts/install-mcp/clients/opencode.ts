import * as os from "node:os";
import * as path from "node:path";

import { detectJsonHttp, installJsonHttp, verifyJsonHttp } from "./json-http";
import type { ClientInstaller } from "./types";

const NAME = "todox";

/**
 * Resolved per call, not once at import. `os.homedir()` reads the environment
 * at call time -- a module-level constant would freeze the value the module
 * first loaded with, which is before any test can point HOME somewhere safe.
 */
function configPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

/**
 * OpenCode runs the MCP server as a local stdio child process by default --
 * the process sits beside the developer's editor and has its filesystem. The
 * HTTP transport works too, but stdio is the path the developer doesn't have
 * to keep alive across machines.
 *
 * `TODOX_TOKEN` is a literal `${TODOX_TOKEN}` placeholder so OpenCode
 * expands it from the developer's shell at launch, not at install time --
 * the token should never land in a committed config. `TODOX_CLIENT_NAME`
 * and `TODOX_CLIENT_VERSION` are read by the stdio server so it can record
 * which client it was launched from. `TODOX_URL` is the origin the stdio
 * server should call -- pointing it at a local dev server requires a
 * different value than production, so the CLI's `--url` flag has to reach
 * the child process.
 */
async function buildStdioEntry(url: string): Promise<Record<string, unknown>> {
  return {
    type: "local",
    command: "npx",
    args: ["-y", "tsx", path.resolve(process.cwd(), "mcp/server.ts")],
    env: {
      TODOX_TOKEN: "${TODOX_TOKEN}",
      TODOX_URL: new URL(url).origin,
      TODOX_CLIENT_NAME: "opencode",
      TODOX_CLIENT_VERSION: "0.0.0",
    },
  };
}

export const client: ClientInstaller = {
  name: "opencode",
  async detect() {
    return detectJsonHttp(configPath());
  },
  async install({ transport, url, token }) {
    const entry: Record<string, unknown> =
      transport === "stdio"
        ? await buildStdioEntry(url)
        : { type: "remote", url, headers: { Authorization: `Bearer ${token}` } };
    const result = await installJsonHttp(
      { configPath: configPath(), rootKey: "mcp", name: NAME },
      entry,
    );
    return { ...result, entryId: NAME };
  },
  async verify() {
    return verifyJsonHttp({ configPath: configPath(), rootKey: "mcp", name: NAME });
  },
};
