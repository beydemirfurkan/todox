import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readJsonFile } from "./atomic-write";
import { installJsonHttp, verifyJsonHttp } from "./json-http";
import type { ClientInstaller } from "./types";

const NAME = "todox";

/**
 * Resolved per call, not once at import. `os.homedir()` is read from the
 * environment, so a module-level constant freezes whatever HOME happened to
 * be set when the module was first loaded -- which is before any test can
 * point it somewhere safe, and wrong for any caller that changes it.
 */
function configPath(): string {
  return path.join(os.homedir(), ".claude.json");
}

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

async function installViaNativeCli(url: string, token: string): Promise<boolean> {
  if (!(await isClaudeOnPath())) return false;
  // `--header` takes KEY and VALUE as two separate arguments. Joining them
  // into one ("Authorization=Bearer ...") hands the parser a single greedy
  // positional, which is the bug this ordering exists to avoid.
  const args = [
    "mcp",
    "add",
    NAME,
    "--transport",
    "http",
    url,
    "--header",
    "Authorization",
    `Bearer ${token}`,
  ];
  return (await exitCodeOf("claude", args)) === 0;
}

async function hasEntry(): Promise<boolean> {
  const config = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(configPath());
  return Boolean(config?.mcpServers && NAME in config.mcpServers);
}

const TARGET = () => ({ configPath: configPath(), rootKey: "mcpServers" as const, name: NAME });

export const client: ClientInstaller = {
  name: "claude-code",

  async detect() {
    if (await isClaudeOnPath()) return true;
    try {
      await fs.access(configPath());
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
    // Read before writing so the reported status is the truth either way --
    // the native CLI does not tell us whether it replaced an entry.
    const existed = await hasEntry();

    // The native CLI first. When it succeeds it has already written this
    // entry, and writing it again over the top would clobber any extra
    // fields that version of the CLI set for itself.
    if (await installViaNativeCli(url, token)) {
      return { path: configPath(), status: existed ? "updated" : "created", entryId: "native" };
    }
    const result = await installJsonHttp(TARGET(), {
      type: "http",
      url,
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ...result, entryId: "json" };
  },

  async verify() {
    return verifyJsonHttp(TARGET(), "Bearer ");
  },
};
