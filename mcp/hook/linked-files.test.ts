import { describe, expect, it, vi } from "vitest";

import { checkLinkedFiles, linkedTasks } from "./linked-files";
import { hookContext } from "./test-context";
import type { HookContext } from "./types";

const BRIEF = {
  open_tasks: [
    {
      id: 7,
      title: "Fix the cart total",
      files: [
        { id: 70, path: "/repo/src/cart.ts", hash: "aaa", status: "fresh" },
        { id: 71, path: "/repo/docs/plan.md", hash: null, status: "unknown" },
      ],
    },
    { id: 8, title: "No files", files: [] },
  ],
};

/** answers getContext with `brief` and records every other call */
const rpcWith = (brief: unknown) =>
  vi.fn(async (method: string) => (method === "getContext" ? brief : { recorded: 1 }));

const checking =
  (statuses: Record<number, "fresh" | "changed" | "missing" | "unknown">): HookContext["checkFiles"] =>
  (refs) => ({
    checked: refs.map((r) => ({ ...r, status: statuses[r.id] ?? "unknown" })),
    seen: refs.map((r) => ({ id: r.id, hash: statuses[r.id] === "missing" ? null : `h${r.id}` })),
  });

describe("linkedTasks", () => {
  it("collects each open task's linked files, and skips tasks without any", () => {
    expect(linkedTasks(BRIEF)).toEqual([
      {
        id: 7,
        title: "Fix the cart total",
        refs: [
          { id: 70, path: "/repo/src/cart.ts", hash: "aaa" },
          { id: 71, path: "/repo/docs/plan.md", hash: null },
        ],
      },
    ]);
  });

  it("collects from the tasks the ceiling condensed to a line as well", () => {
    const condensed = { condensed_tasks: BRIEF.open_tasks };
    expect(linkedTasks({ open_tasks: [], ...condensed })).toEqual(linkedTasks(BRIEF));
    expect(linkedTasks(condensed)).toEqual(linkedTasks(BRIEF));
  });

  it("reads nothing out of an answer that is not a briefing", () => {
    expect(linkedTasks(null)).toEqual([]);
    expect(linkedTasks({ open_tasks: "no" })).toEqual([]);
    expect(linkedTasks({ open_tasks: [{ id: 1, files: [{ id: "x", path: 3 }] }] })).toEqual([]);
  });
});

describe("checkLinkedFiles", () => {
  it("hashes the linked files here, reports them, and names the ones that changed", async () => {
    const rpc = rpcWith(BRIEF);
    const ctx = hookContext({ rpc, checkFiles: checking({ 70: "changed", 71: "fresh" }) });

    const lines = await checkLinkedFiles(ctx, { cwd: "/repo" });

    expect(rpc).toHaveBeenCalledWith("getContext", { cwd: "/repo", create_if_missing: false });
    expect(rpc).toHaveBeenCalledWith("reportRefs", {
      refs: [
        { id: 70, hash: "h70" },
        { id: 71, hash: "h71" },
      ],
    });
    expect(lines).toEqual(['- task #7 "Fix the cart total" -> /repo/src/cart.ts (changed)']);
  });

  it("names a file that is gone", async () => {
    const ctx = hookContext({ rpc: rpcWith(BRIEF), checkFiles: checking({ 70: "missing" }) });
    expect(await checkLinkedFiles(ctx, { cwd: "/repo" })).toEqual([
      '- task #7 "Fix the cart total" -> /repo/src/cart.ts (missing)',
    ]);
  });

  it("makes no report when no open task has a linked file", async () => {
    const rpc = rpcWith({ open_tasks: [] });
    const ctx = hookContext({ rpc, checkFiles: checking({}) });
    expect(await checkLinkedFiles(ctx, { cwd: "/repo" })).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("makes no report when nothing could be read here (another machine's paths)", async () => {
    const rpc = rpcWith(BRIEF);
    const ctx = hookContext({
      rpc,
      checkFiles: (refs) => ({ checked: refs.map((r) => ({ ...r, status: "unknown" as const })), seen: [] }),
    });
    expect(await checkLinkedFiles(ctx, { cwd: "/repo" })).toEqual([]);
    expect(rpc).not.toHaveBeenCalledWith("reportRefs", expect.anything());
  });

  it("still names the changed files when the report fails, and logs why", async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === "reportRefs") throw new Error("todox unreachable");
      return BRIEF;
    });
    const ctx = hookContext({ rpc, checkFiles: checking({ 70: "changed" }) });
    expect(await checkLinkedFiles(ctx, { cwd: "/repo" })).toHaveLength(1);
    expect(ctx.log).toHaveBeenCalledWith("session-start", expect.stringMatching(/not reported: todox unreachable/));
  });

  it("does nothing without a token", async () => {
    const ctx = hookContext({ rpc: null, checkFiles: checking({ 70: "changed" }) });
    expect(await checkLinkedFiles(ctx, { cwd: "/repo" })).toEqual([]);
  });
});
