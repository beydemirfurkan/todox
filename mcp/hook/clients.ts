import type { HookClient } from "./types";

/**
 * Which agent ran the hook: `run.sh`'s second argument. Claude Code and Codex
 * send a hook the same JSON and read the same answers -- Codex documents
 * `hookSpecificOutput.additionalContext` for SessionStart and
 * `decision: "block"` with a `reason` for Stop, and names MCP tools
 * `mcp__<server>__<tool>` -- so the name decides only where state is kept and
 * how an observation says who saw it.
 */
const CLIENTS: readonly HookClient[] = ["claude-code", "codex"];

export function hookClientFrom(arg: string | undefined): HookClient {
  return CLIENTS.find((c) => c === arg) ?? "claude-code";
}
