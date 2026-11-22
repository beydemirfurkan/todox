import { describe, expect, it } from "vitest";

import { hookClientFrom, normalizeInput, shapeOutput } from "./clients";

describe("which agent ran the hook", () => {
  it("reads the second argument, and assumes Claude Code otherwise", () => {
    expect(hookClientFrom("codex")).toBe("codex");
    expect(hookClientFrom("cursor")).toBe("cursor");
    expect(hookClientFrom(undefined)).toBe("claude-code");
    expect(hookClientFrom("vim")).toBe("claude-code");
  });
});

describe("Claude Code and Codex speak the same shapes", () => {
  it("passes their input and output through untouched", () => {
    const raw = { session_id: "s", cwd: "/r", tool_name: "mcp__todox__update_task", tool_input: { task_id: 3 } };
    expect(normalizeInput("codex", raw)).toBe(raw);
    const out = { decision: "block", reason: "write it up" };
    expect(shapeOutput("codex", "stop", out)).toBe(out);
  });
});

describe("Cursor, translated at the door", () => {
  it("finds the session and the directory under Cursor's names", () => {
    const input = normalizeInput("cursor", {
      conversation_id: "c1",
      workspace_roots: ["/repo", "/other"],
      hook_event_name: "stop",
      loop_count: 0,
    });
    expect(input).toMatchObject({ session_id: "c1", cwd: "/repo", stop_hook_active: false });
    expect(normalizeInput("cursor", { conversation_id: "c1", loop_count: 1 }).stop_hook_active).toBe(true);
  });

  it("reads afterFileEdit as an edit to that file", () => {
    expect(
      normalizeInput("cursor", { conversation_id: "c1", hook_event_name: "afterFileEdit", file_path: "/repo/a.ts", edits: [] }),
    ).toMatchObject({ tool_name: "Write", tool_input: { file_path: "/repo/a.ts" } });
  });

  it("names an MCP tool the way the Stop hook looks for it, and parses its JSON strings", () => {
    const input = normalizeInput("cursor", {
      conversation_id: "c1",
      hook_event_name: "postToolUse",
      tool_name: "MCP:update_task",
      tool_input: '{"task_id": 7, "status": "doing"}',
      tool_output: '{"id": 7}',
    });
    expect(input).toMatchObject({
      tool_name: "mcp__todox__update_task",
      tool_input: { task_id: 7, status: "doing" },
      tool_response: { id: 7 },
    });
  });

  it("answers SessionStart with additional_context and a stop with a follow-up turn", () => {
    expect(
      shapeOutput("cursor", "session-start", { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "brief" } }),
    ).toEqual({ additional_context: "brief" });
    expect(shapeOutput("cursor", "stop", { decision: "block", reason: "write it up" })).toEqual({
      followup_message: "write it up",
    });
    expect(shapeOutput("cursor", "stop", { systemMessage: "a note" })).toBeNull();
  });

  it("never holds a prompt back", () => {
    expect(shapeOutput("cursor", "user-prompt-submit", null)).toEqual({ continue: true });
  });
});
