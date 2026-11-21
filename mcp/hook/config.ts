import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
}

export const HOSTED_URL = "https://www.todox.dev";

type Env = Record<string, string | undefined>;

export function hookConfig(
  env: Env,
  pluginRoot: string | undefined,
  warn: (message: string) => void,
): HookConfig {
  return {
    token: env.CLAUDE_PLUGIN_OPTION_TOKEN || env.TODOX_TOKEN || undefined,
    url: env.TODOX_URL || (pluginRoot && urlFromMcpJson(pluginRoot, warn)) || HOSTED_URL,
    dataDir: dataDirFrom(env),
    disabled: env.TODOX_HOOKS === "off",
  };
}

export function dataDirFrom(env: Env): string {
  return env.CLAUDE_PLUGIN_DATA || join(homedir(), ".claude", "plugins", "data", "todox");
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
