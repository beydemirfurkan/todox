import { describe, expect, it } from "vitest";

import { postToolUse, taskIdOf } from "./post-tool-use";
import { readEvents } from "./state";
import { hookContext } from "./test-context";
import type { HookInput } from "./types";

const run = async (input: HookInput) => {
  const ctx = hookContext({ input });
  expect(await postToolUse(ctx)).toBeNull();
  return readEvents(ctx.config.dataDir, "s1").map((e) => e.t + ("id" in e ? `:${e.id}` : ""));
};

describe("PostToolUse", () => {
  it("counts an edit inside the working tree", async () => {
    expect(await run({ session_id: "s1", cwd: "/repo", tool_name: "Edit", tool_input: { file_path: "/repo/a.ts" } })).toEqual(["edit"]);
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "NotebookEdit", tool_input: { notebook_path: "/repo/n.ipynb" } }),
    ).toEqual(["edit"]);
  });

  it("counts a Codex apply_patch by the files its headers name", async () => {
    const patch = (file: string) =>
      `*** Begin Patch\n*** Update File: ${file}\n@@\n-a\n+b\n*** End Patch`;
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "apply_patch", tool_input: { command: patch("src/a.ts") } }),
    ).toEqual(["edit"]);
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "apply_patch", tool_input: { command: patch("/elsewhere/a.ts") } }),
    ).toEqual([]);
    expect(await run({ session_id: "s1", cwd: "/repo", tool_name: "apply_patch", tool_input: {} })).toEqual([]);
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "apply_patch", tool_input: { command: patch("../other/a.ts") } }),
    ).toEqual([]);
  });

  it("reads Windows paths the same way, whatever machine runs the test", async () => {
    const patch = (file: string) => `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch`;
    expect(
      await run({ session_id: "s1", cwd: "C:\\repo", tool_name: "apply_patch", tool_input: { command: patch("src\\a.ts") } }),
    ).toEqual(["edit"]);
    expect(
      await run({ session_id: "s1", cwd: "C:\\repo", tool_name: "Edit", tool_input: { file_path: "C:\\Repo\\a.ts" } }),
    ).toEqual(["edit"]);
  });

  it("does not count a plan written outside it, or a sibling that shares a prefix", async () => {
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "Write", tool_input: { file_path: "/home/u/.claude/plans/p.md" } }),
    ).toEqual([]);
    expect(await run({ session_id: "s1", cwd: "/repo", tool_name: "Write", tool_input: { file_path: "/repo-old/a.ts" } })).toEqual([]);
  });

  it("notes the task a todox call wrote on, through either transport's tool name", async () => {
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "mcp__todox__update_task", tool_input: { task_id: 7, status: "done" } }),
    ).toEqual(["task:7"]);
    expect(
      await run({
        session_id: "s1",
        cwd: "/repo",
        tool_name: "mcp__plugin_todox_todox__log_entry",
        tool_input: { task_id: 8, kind: "handoff" },
      }),
    ).toEqual(["task:8"]);
  });

  it("marks a task taken on, which is what an observation's task_ids carry", async () => {
    expect(
      await run({ session_id: "s1", cwd: "/repo", tool_name: "mcp__todox__update_task", tool_input: { task_id: 7, status: "doing" } }),
    ).toEqual(["task:7", "doing:7"]);
  });

  it("ignores every other tool", async () => {
    expect(await run({ session_id: "s1", cwd: "/repo", tool_name: "mcp__todox__search", tool_input: { query: "x" } })).toEqual([]);
    expect(await run({ session_id: "s1", cwd: "/repo", tool_name: "Bash", tool_input: { command: "ls" } })).toEqual([]);
  });
});

describe("taskIdOf", () => {
  it("reads create_task's id from the receipt's task_path, however the answer is wrapped", () => {
    const receipt = JSON.stringify({ task: { id: 142 }, task_path: "/p/hookdemo/t/142" });
    expect(taskIdOf({ tool_response: [{ type: "text", text: receipt }] })).toBe(142);
    expect(taskIdOf({ tool_response: { task_path: "/p/a/t/9" } })).toBe(9);
  });

  it("is null when neither the call nor the answer names one", () => {
    expect(taskIdOf({ tool_input: { title: "x" }, tool_response: "refused" })).toBeNull();
    expect(taskIdOf({ tool_input: { task_id: -1 } })).toBeNull();
  });
});
