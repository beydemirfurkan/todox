import { join } from "node:path";

import { HOSTED_URL } from "../hook/config";
import { readSavedConfig, todoxHome } from "../saved-config";

export { configPath, todoxHome } from "../saved-config";

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

export function gitHookConfig(env: Env, warn: (message: string) => void): GitHookConfig {
  const saved = readSavedConfig(env, warn);
  return {
    token: env.TODOX_TOKEN || saved.token,
    url: env.TODOX_URL || saved.url || HOSTED_URL,
    dataDir: join(todoxHome(env), "git-hook"),
    disabled: env.TODOX_OBSERVE === "off" || env.TODOX_HOOKS === "off",
  };
}
