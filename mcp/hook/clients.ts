import type { HookClient, HookInput, HookOutput } from "./types";

/**
 * The one place that knows the three agents speak differently.
 *
 * Claude Code and Codex send a hook the same JSON and read the same answers
 * -- Codex documents `hookSpecificOutput.additionalContext` for SessionStart
 * and `decision: "block"` with a `reason` for Stop, and reports MCP tools as
 * `mcp__<server>__<tool>` -- so for them this is the identity. Cursor is not:
 * its events are camelCase, it says `conversation_id` and `workspace_roots`
 * for the session and the directory, `tool_output` for the answer, `loop_count`
 * where Claude Code says `stop_hook_active`, and it reads `additional_context`
 * and `followup_message` back. Each translation below is a claim about
 * cursor.com/docs/agent/hooks as read on 2026-11-22.
 */

const CLIENTS: readonly HookClient[] = ["claude-code", "codex", "cursor"];

export function hookClientFrom(arg: string | undefined): HookClient {
  return CLIENTS.find((c) => c === arg) ?? "claude-code";
}

type Raw = Record<string, unknown>;

export function normalizeInput(client: HookClient, raw: Raw): HookInput {
  return client === "cursor" ? fromCursor(raw) : (raw as HookInput);
}

export function shapeOutput(client: HookClient, event: string, output: HookOutput): HookOutput {
  return client === "cursor" ? toCursor(event, output) : output;
}

function fromCursor(raw: Raw): HookInput {
  const roots = Array.isArray(raw.workspace_roots) ? raw.workspace_roots : [];
  const input: HookInput = {
    session_id: stringOr(raw.session_id) ?? stringOr(raw.conversation_id),
    cwd: stringOr(raw.cwd) ?? stringOr(roots[0]),
    hook_event_name: stringOr(raw.hook_event_name),
    prompt: stringOr(raw.prompt),
    trigger: stringOr(raw.trigger),
    stop_hook_active: typeof raw.loop_count === "number" && raw.loop_count > 0,
  };
  if (raw.hook_event_name === "afterFileEdit" && typeof raw.file_path === "string")
    return { ...input, tool_name: "Write", tool_input: { file_path: raw.file_path } };
  if (typeof raw.tool_name === "string")
    return {
      ...input,
      tool_name: cursorToolName(raw.tool_name),
      tool_input: objectFrom(raw.tool_input),
      tool_response: parsedOr(raw.tool_output),
    };
  return input;
}

/** `MCP:update_task` is how Cursor names an MCP tool in a hook. */
function cursorToolName(name: string): string {
  const mcp = /^MCP:(.+)$/.exec(name);
  return mcp ? `mcp__todox__${mcp[1]}` : name;
}

function toCursor(event: string, output: HookOutput): HookOutput {
  if (event === "user-prompt-submit") return { continue: true };
  if (!output || typeof output === "string") return null;
  if (event === "session-start") {
    const context = (output.hookSpecificOutput as { additionalContext?: unknown } | undefined)?.additionalContext;
    return typeof context === "string" ? { additional_context: context } : null;
  }
  // Cursor's stop has no message to the developer, only a follow-up turn, so
  // the gentle "edited without a task" note has nowhere to go and is dropped.
  if (event === "stop" && output.decision === "block" && typeof output.reason === "string")
    return { followup_message: output.reason };
  return null;
}

const stringOr = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function parsedOr(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function objectFrom(value: unknown): Record<string, unknown> | undefined {
  const parsed = parsedOr(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}
