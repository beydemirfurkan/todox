import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { HOSTED_URL } from "../hook/config";

/**
 * Where a git hook finds the server and the token.
 *
 * A git hook has no client to hand it either: it runs under whatever shell
 * ran `git commit`, an editor's included, so the environment alone would
 * work only from the terminal the developer exported it in. The environment
 * still wins -- it is how CI and a one-off override work -- and otherwise
 * `todox-mcp hook install` wrote the pair to a file only this user can read.
 */
export interface GitHookConfig {
  token: string | undefined;
  url: string;
  /** Where the log lives; the state lives in each repository's git dir. */
  dataDir: string;
  /** `TODOX_OBSERVE=off` or `TODOX_HOOKS=off`, the switches the other carriers obey. */
  disabled: boolean;
}

type Env = Record<string, string | undefined>;

export const todoxHome = (env: Env): string => env.TODOX_HOME || join(homedir(), ".todox");
export const configPath = (env: Env): string => join(todoxHome(env), "config.json");

export function gitHookConfig(env: Env, warn: (message: string) => void): GitHookConfig {
  const saved = readSaved(configPath(env), warn);
  return {
    token: env.TODOX_TOKEN || saved.token,
    url: env.TODOX_URL || saved.url || HOSTED_URL,
    dataDir: join(todoxHome(env), "git-hook"),
    disabled: env.TODOX_OBSERVE === "off" || env.TODOX_HOOKS === "off",
  };
}

function readSaved(path: string, warn: (message: string) => void): { token?: string; url?: string } {
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
