import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";

import { readJsonFile } from "./atomic-write";
import { claudeCodeContract, ENTRY_NAME } from "./contract";
import { findStaleEntries, installJsonHttp, verifyJsonHttp } from "./json-http";
import type { ClientInstaller } from "./types";

/**
 * Path and root key come from `claudeCodeContract()`, resolved per call:
 * `os.homedir()` is read from the environment, so a module-level constant
 * freezes whatever HOME happened to be set when the module was first loaded --
 * which is before any test can point it somewhere safe.
 */
const target = () => ({ ...claudeCodeContract().current, name: ENTRY_NAME });

/** Resolves the process's exit code, or null when it could not be spawned. */
function exitCodeOf(command: string, args: readonly string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: "ignore" });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code));
  });
}

async function isClaudeOnPath(): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  return (await exitCodeOf(probe, ["claude"])) === 0;
}

/**
 * The argv for `claude mcp add`. Exported so the two things that are wrong
 * about it when they are wrong can be asserted without spawning anything.
 *
 * `--scope user` is not optional. The default is `local`, which means the
 * directory you happened to run the installer from — and a memory that exists
 * in exactly one repository is the opposite of what todox is for. It fails
 * quietly too: the tools are simply absent in the next project, so the agent
 * never mentions them.
 *
 * `--header` takes one `Name: value` argument. It was being passed as two
 * ("Authorization", "Bearer …"), which this CLI rejects outright — so the
 * native path returned a failure every time and the JSON fallback below did
 * the install. That hid the scope bug rather than avoiding it: the fallback
 * writes to the top-level `mcpServers`, which is user scope, so fixing the
 * header alone would have moved every new install into the current directory.
 */
export function nativeCliArgs(url: string, token: string): string[] {
  return [
    "mcp",
    "add",
    "--scope",
    "user",
    ENTRY_NAME,
    "--transport",
    "http",
    url,
    "--header",
    `Authorization: Bearer ${token}`,
  ];
}

async function installViaNativeCli(url: string, token: string): Promise<boolean> {
  if (!(await isClaudeOnPath())) return false;
  return (await exitCodeOf("claude", nativeCliArgs(url, token))) === 0;
}

async function hasEntry(): Promise<boolean> {
  const config = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(
    claudeCodeContract().current.file,
  );
  return Boolean(config?.mcpServers && ENTRY_NAME in config.mcpServers);
}

export const client: ClientInstaller = {
  name: "claude-code",

  async detect() {
    if (await isClaudeOnPath()) return true;
    try {
      await fs.access(claudeCodeContract().current.file);
      return true;
    } catch {
      return false;
    }
  },

  async install({ transport, url, token }) {
    if (transport !== "http") {
      throw new Error(
        "claude-code currently supports the http transport only; pass --transport http",
      );
    }
    const contract = claudeCodeContract();
    // Read before writing so the reported status is the truth either way --
    // the native CLI does not tell us whether it replaced an entry.
    const existed = await hasEntry();

    // The native CLI first. When it succeeds it has already written this
    // entry, and writing it again over the top would clobber any extra
    // fields that version of the CLI set for itself.
    if (await installViaNativeCli(url, token)) {
      return {
        path: contract.current.file,
        status: existed ? "updated" : "created",
        entryId: "native",
      };
    }
    const result = await installJsonHttp(
      { ...contract.current, name: ENTRY_NAME },
      { type: contract.httpType, url, headers: { Authorization: `Bearer ${token}` } },
    );
    return { ...result, entryId: "json" };
  },

  async verify() {
    return verifyJsonHttp(target(), "Bearer ");
  },

  async staleInstalls() {
    return findStaleEntries(claudeCodeContract().stale, ENTRY_NAME);
  },
};
