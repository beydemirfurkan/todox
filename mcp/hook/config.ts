import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { HookClient } from "./types";

/**
 * Where the plugin's hooks find the server, the token and their own state.
 *
 * Nothing new is asked of the person installing the plugin. The token is the
 * one `plugin.json` already prompts for, which Claude Code hands every hook as
 * `CLAUDE_PLUGIN_OPTION_TOKEN`. The server is the one the plugin's own MCP
 * entry points at, because a self-hoster already edits `.mcp.json` to point
 * the tools at their instance and should not have to say it twice; an
 * explicit `TODOX_URL` wins over both, for the plugin-update case where that
 * edit was overwritten.
 */
export interface HookConfig {
  token: string | undefined;
  url: string;
  dataDir: string;
  /** `TODOX_HOOKS=off`: every hook does nothing and says nothing. */
  disabled: boolean;
  /**
   * `TODOX_STOP`: `off` never stops a turn; `strict` also stops one that
   * edited files without any todox task; anything else is the default --
   * stop once for a task this session left unwritten.
   */
  stopMode: StopMode;
  /** `TODOX_OBSERVE=off`, the stdio observer's switch, turns this carrier off too. */
  observe: boolean;
}

export type StopMode = "default" | "off" | "strict";

export const HOSTED_URL = "https://www.todox.dev";

type Env = Record<string, string | undefined>;

/**
 * The plugin's own prompted token first, then the environment's.
 *
 * Cursor's hooks are handed the prompted value as `TODOX_PLUGIN_TOKEN="${token}"`
 * in the command line. Whether Cursor substitutes a plugin variable there is
 * not documented: if it does not, the shell expands `${token}` to nothing, or
 * the text reaches us unexpanded -- and either must fall through to
 * `TODOX_TOKEN` rather than silence it.
 */
export function tokenFrom(env: Env): string | undefined {
  const given = [env.CLAUDE_PLUGIN_OPTION_TOKEN, env.TODOX_PLUGIN_TOKEN, env.TODOX_TOKEN];
  return given.find((value) => value && !value.startsWith("${")) || undefined;
}

export function hookConfig(
  env: Env,
  pluginRoot: string | undefined,
  warn: (message: string) => void,
  client: HookClient = "claude-code",
): HookConfig {
  return {
    token: tokenFrom(env),
    url: env.TODOX_URL || (pluginRoot && urlFromMcpJson(pluginRoot, warn)) || HOSTED_URL,
    dataDir: dataDirFrom(env, client),
    disabled: env.TODOX_HOOKS === "off",
    stopMode: env.TODOX_STOP === "off" || env.TODOX_STOP === "strict" ? env.TODOX_STOP : "default",
    observe: env.TODOX_OBSERVE !== "off",
  };
}

/**
 * Claude Code and Codex hand a plugin its data directory as
 * `CLAUDE_PLUGIN_DATA` (Codex sets `PLUGIN_DATA` as well). Cursor documents
 * none, so its plugin keeps its state beside Cursor's own.
 */
export function dataDirFrom(env: Env, client: HookClient = "claude-code"): string {
  const given = env.CLAUDE_PLUGIN_DATA || env.PLUGIN_DATA;
  if (given) return given;
  const home = client === "cursor" ? ".cursor" : client === "codex" ? ".codex" : ".claude";
  return join(homedir(), home, "plugins", "data", "todox");
}

/** The server the plugin's MCP entry reaches, without its `/api/mcp` path. */
export function urlFromMcpJson(pluginRoot: string, warn: (message: string) => void): string | undefined {
  const path = join(pluginRoot, ".mcp.json");
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers?: Record<string, { url?: unknown }>;
    };
    const url = parsed.mcpServers?.todox?.url;
    return typeof url === "string" ? url.replace(/\/api\/mcp\/?$/, "") : undefined;
  } catch (e) {
    warn(`.mcp.json unreadable, using the default server: ${(e as Error).message}`);
    return undefined;
  }
}
