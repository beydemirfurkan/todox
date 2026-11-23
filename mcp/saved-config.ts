import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * `~/.todox/config.json`: the token and server every local carrier falls
 * back to when its environment names neither.
 *
 * Three processes run on the developer's machine -- the plugin's hooks, the
 * stdio server and the git hook -- and none of them is an MCP client, so none
 * can use the OAuth token the agent keeps for `/api/mcp`. `todox-mcp login`
 * (or `hook install --token`) writes this file once, readable by its owner
 * only, and all three read it. The environment still wins: it is how CI and a
 * one-off override work.
 */

type Env = Record<string, string | undefined>;

export interface SavedConfig {
  token?: string;
  url?: string;
}

export const todoxHome = (env: Env): string => env.TODOX_HOME || join(homedir(), ".todox");
export const configPath = (env: Env): string => join(todoxHome(env), "config.json");

export function readSavedConfig(env: Env, warn: (message: string) => void): SavedConfig {
  const path = configPath(env);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown; url?: unknown };
    return {
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      url: typeof parsed.url === "string" ? parsed.url : undefined,
    };
  } catch (e) {
    warn(`${path} unreadable: ${(e as Error).message}`);
    return {};
  }
}

/** Writes the pair, owner-only, replacing whatever was there. Returns the path. */
export function saveCredentials(env: Env, saved: { token: string; url?: string }): string {
  const home = todoxHome(env);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = configPath(env);
  const body = { token: saved.token, ...(saved.url ? { url: saved.url } : {}) };
  writeFileSync(path, `${JSON.stringify(body)}\n`, { mode: 0o600 });
  // `mode` applies only when the file is created; an existing one keeps its own.
  chmodSync(path, 0o600);
  return path;
}
