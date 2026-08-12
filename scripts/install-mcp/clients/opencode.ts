import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile } from "./atomic-write";
import { ENTRY_NAME, openCodeContract, type OpenCodeMajor } from "./contract";
import {
  detectJsonHttp,
  findStaleEntries,
  installJsonHttp,
  verifyJsonHttp,
} from "./json-http";
import type { ClientInstaller } from "./types";

const configFile = () => openCodeContract("v2").current.file;

/**
 * The repository root, resolved from this file rather than `process.cwd()`.
 *
 * The stdio entry names an absolute path to `mcp/server.ts`, and cwd is
 * whatever directory the user happened to run the CLI from -- right when it is
 * `pnpm install:mcp` at the repo root, and a path to nothing the moment anyone
 * runs the script from a subdirectory. The file's own location is the thing
 * that is actually known.
 */
function repoRoot(): string {
  return path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
}

/**
 * Which layout this machine's OpenCode reads. v1 keys servers directly under
 * `mcp`; v2 nests them under `mcp.servers`. Same file, and writing the wrong
 * one is silent -- the server simply never appears.
 *
 * An existing config answers the question, so that is the first thing asked.
 * The binary's version number is deliberately not consulted: the mapping from
 * a semver to a config schema is not something this repo can verify, and a
 * confident wrong answer is worse here than an admitted unknown. When there is
 * nothing to read, the caller is told which layout was assumed.
 */
export async function detectLayout(): Promise<{ major: OpenCodeMajor; certain: boolean }> {
  // A hand-broken config must not fail detection: the install can still fix it.
  const doc = await readJsonFile<{ mcp?: Record<string, unknown> }>(configFile()).catch(
    () => null,
  );
  const mcp = doc?.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    const servers = (mcp as Record<string, unknown>).servers;
    if (servers && typeof servers === "object" && !Array.isArray(servers)) {
      return { major: "v2", certain: true };
    }
    // Keys under `mcp` that are not `servers` are v1 server entries.
    if (Object.keys(mcp).length > 0) return { major: "v1", certain: true };
  }
  return { major: "v2", certain: false };
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
function buildStdioEntry(url: string): Record<string, unknown> {
  return {
    type: "local",
    command: "npx",
    args: ["-y", "tsx", path.join(repoRoot(), "mcp", "server.ts")],
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
    return detectJsonHttp(configFile());
  },
  async install({ transport, url, token, openCodeLayout }) {
    const detected = openCodeLayout ? undefined : await detectLayout();
    const major = openCodeLayout ?? detected?.major ?? "v2";
    const contract = openCodeContract(major);
    const entry =
      transport === "stdio"
        ? buildStdioEntry(url)
        : { type: contract.httpType, url, headers: { Authorization: `Bearer ${token}` } };
    const result = await installJsonHttp({ ...contract.current, name: ENTRY_NAME }, entry);
    // An assumption the user cannot see is the thing this whole change is
    // about, so say it was one -- and say how to overrule it in the same line.
    const note =
      detected && !detected.certain
        ? `assumed OpenCode ${major} layout (no existing config to read); ` +
          "re-run with --opencode-layout v1 if this machine runs OpenCode v1"
        : `OpenCode ${major} layout`;
    return { ...result, entryId: ENTRY_NAME, note };
  },
  async verify() {
    const { major } = await detectLayout();
    return verifyJsonHttp({ ...openCodeContract(major).current, name: ENTRY_NAME });
  },
  async staleInstalls() {
    const { major } = await detectLayout();
    return findStaleEntries(openCodeContract(major).stale, ENTRY_NAME);
  },
};
