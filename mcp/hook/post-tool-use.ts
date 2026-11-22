import { isInside } from "../../lib/util/paths";
import { appendEvent } from "./state";
import type { HookContext, HookInput, HookOutput } from "./types";

/**
 * Notes what the session did, for the Stop hook to read: an edit to a file in
 * the working directory, or a todox task it created or wrote on. No network,
 * no output -- this runs after every matching tool call and must cost nothing
 * but an append.
 *
 * Edits outside the working directory are not counted. A plan written to
 * `~/.claude/plans` is a file edit as far as Claude Code is concerned, and a
 * session that only planned owes the repository nothing.
 */
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const TODOX_TASK_TOOL = /^mcp__.*todox.*__(create_task|update_task|log_entry)$/;

export async function postToolUse(ctx: HookContext): Promise<HookOutput> {
  const { session_id: sessionId, tool_name: tool } = ctx.input;
  if (!sessionId || !tool) return null;
  const at = ctx.now().toISOString();

  if (EDIT_TOOLS.has(tool)) {
    if (editsWorkingTree(ctx.input)) appendEvent(ctx.config.dataDir, sessionId, { t: "edit", at });
    return null;
  }
  if (TODOX_TASK_TOOL.test(tool)) {
    const id = taskIdOf(ctx.input);
    if (!id) {
      ctx.log("post-tool-use", `${tool}: no task id in the call or its answer`);
      return null;
    }
    appendEvent(ctx.config.dataDir, sessionId, { t: "task", at, id });
    if (ctx.input.tool_input?.status === "doing" && !/__log_entry$/.test(tool))
      appendEvent(ctx.config.dataDir, sessionId, { t: "doing", at, id });
  }
  return null;
}

function editsWorkingTree(input: HookInput): boolean {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof path !== "string" || !input.cwd) return false;
  return isInside(path, input.cwd);
}

/**
 * The task a todox call was about. `update_task` and `log_entry` name it in
 * their arguments; `create_task` only learns it from the answer, whose
 * receipt carries `task_path: /p/<slug>/t/<id>` -- found in the serialised
 * answer rather than by walking MCP's content blocks, whose shape is the
 * client's to change.
 */
export function taskIdOf(input: HookInput): number | null {
  const fromArgs = input.tool_input?.task_id;
  if (typeof fromArgs === "number" && Number.isInteger(fromArgs) && fromArgs > 0) return fromArgs;
  if (typeof fromArgs === "string" && /^\d+$/.test(fromArgs)) return Number(fromArgs);
  const answer = JSON.stringify(input.tool_response ?? "");
  const match = /\/p\/[^/"\\]+\/t\/(\d+)/.exec(answer);
  return match ? Number(match[1]) : null;
}
