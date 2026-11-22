import { resolve } from "node:path";

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
/**
 * Codex edits through one tool, `apply_patch`, whose `tool_input.command` is
 * the patch; the paths are its `*** Add/Update/Delete File:` headers.
 */
const PATCH_TOOL = "apply_patch";
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const TODOX_TASK_TOOL = /^mcp__.*todox.*__(create_task|update_task|log_entry)$/;

export async function postToolUse(ctx: HookContext): Promise<HookOutput> {
  const { session_id: sessionId, tool_name: tool } = ctx.input;
  if (!sessionId || !tool) return null;
  const at = ctx.now().toISOString();

  if (EDIT_TOOLS.has(tool) || tool === PATCH_TOOL) {
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
  const cwd = input.cwd;
  if (!cwd) return false;
  return editedPaths(input).some((path) => isInside(resolve(cwd, path), cwd));
}

export function editedPaths(input: HookInput): string[] {
  const given = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof given === "string") return [given];
  const patch = input.tool_input?.command;
  if (input.tool_name !== PATCH_TOOL || typeof patch !== "string") return [];
  return [...patch.matchAll(PATCH_FILE)].map((m) => m[1]!.trim());
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
