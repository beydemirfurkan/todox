import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readJsonFile, writeJsonFile } from "./atomic-write";
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

async function installViaJson(url: string, token: string): Promise<void> {
  const target = configPath();
  const current = (await readJsonFile<Record<string, unknown>>(target)) ?? {};
  const servers = (current.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers[NAME] = {
    type: "http",
    url,
    headers: { Authorization: `Bearer ${token}` },
  };
  current.mcpServers = servers;
  await writeJsonFile(target, current);
}

async function hasEntry(): Promise<boolean> {
  const config = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(configPath());
  return Boolean(config?.mcpServers && NAME in config.mcpServers);
}

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
    const status = existed ? "updated" : "created";

    // The native CLI first. When it succeeds it has already written this
    // entry, and writing it again over the top would clobber any extra
    // fields that version of the CLI set for itself.
    if (await installViaNativeCli(url, token)) {
      return { path: configPath(), status, entryId: "native" };
    }
    await installViaJson(url, token);
    return { path: configPath(), status, entryId: "json" };
  },

  async verify() {
    const target = configPath();
    const config = await readJsonFile<{ mcpServers?: Record<string, unknown> }>(target);
    const entry = config?.mcpServers?.[NAME];
    if (!entry) return { ok: false, detail: `no mcpServers.${NAME} in ${target}` };
    const { headers } = entry as { headers?: Record<string, string> };
    if (!String(headers?.Authorization ?? "").startsWith("Bearer ")) {
      return { ok: false, detail: `Authorization header missing or not Bearer in ${target}` };
    }
    return { ok: true, detail: target };
  },
};
