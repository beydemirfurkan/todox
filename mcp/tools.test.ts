import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { instructions, registerTools, type Workspace } from "./tools";

type Registered = {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean };
  };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

/** Captures registrations instead of speaking the protocol. */
function harness(ws: Workspace) {
  const tools = new Map<string, Registered>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];

  const server = {
    registerTool: (name: string, config: Registered["config"], handler: Registered["handler"]) =>
      tools.set(name, { name, config, handler }),
    registerPrompt: () => {},
  } as unknown as McpServer;

  registerTools(server, async (method, params) => {
    calls.push({ method, params });
    return { ok: true };
  }, ws);

  return { tools, calls };
}

const localWs: Workspace = {
  tz: () => "Europe/Istanbul",
  repoRoot: () => "/repo",
  hash: () => "a".repeat(64),
  checkRefs: (refs) => ({
    checked: refs.map((r) => ({ ...r, status: "fresh" as const })),
    seen: refs.map((r) => ({ id: r.id, hash: r.hash })),
  }),
};

const remoteWs: Workspace = {
  tz: () => undefined,
  repoRoot: () => undefined,
  hash: () => null,
  checkRefs: () => null,
};

describe("argument filtering", () => {
  /**
   * The schemas are `strict()`, and MCP clients attach `_meta` to arguments.
   * Forwarding it turns every single tool call into a 400, which is the kind of
   * breakage that looks like the server being down.
   */
  it("never forwards keys the server's schema does not declare", async () => {
    const { tools, calls } = harness(remoteWs);
    await tools.get("get_task")!.handler({
      task_id: 7,
      _meta: { progressToken: "abc" },
      format: "markdown",
    });

    expect(calls[0].params).toEqual({ task_id: 7 });
  });

  it("keeps presentation arguments on this side", async () => {
    const { tools, calls } = harness(remoteWs);
    await tools.get("activity_report")!.handler({ period: "today", format: "json" });

    expect(calls[0].params).not.toHaveProperty("format");
    expect(calls[0].params).toEqual({ period: "today" });
  });
});

describe("what each side fills in for itself", () => {
  it("a local process supplies the repo root and timezone, and hides them", () => {
    const { tools } = harness(localWs);
    expect(tools.get("get_context")!.config.inputSchema).not.toHaveProperty("repo_root");
    expect(tools.get("activity_report")!.config.inputSchema).not.toHaveProperty("tz");
  });

  it("a hosted server asks the agent for them instead", () => {
    const { tools } = harness(remoteWs);
    expect(tools.get("get_context")!.config.inputSchema).toHaveProperty("repo_root");
    expect(tools.get("activity_report")!.config.inputSchema).toHaveProperty("tz");
  });

  it("fills the repo root in from cwd when it can", async () => {
    const { tools, calls } = harness(localWs);
    await tools.get("get_context")!.handler({ cwd: "/repo/src" });
    expect(calls[0].params.repo_root).toBe("/repo");
  });
});

/**
 * The feature the product leads with, and the one that was dead on the hosted
 * transport: `hash` was stripped from the schema whichever side was asking, so
 * a remote agent had no way to send one and every ref read "not checked".
 */
describe("who hashes the files", () => {
  it("does not ask a local agent for a hash it cannot compute honestly", () => {
    const { tools } = harness(localWs);
    const paths = tools.get("link_files")!.config.inputSchema.paths as {
      element?: unknown;
    };
    expect(JSON.stringify(paths)).not.toContain("hash");
    expect(tools.has("report_file_hashes")).toBe(false);
  });

  it("asks a remote agent for one, and gives it somewhere to send it", () => {
    const { tools } = harness(remoteWs);
    expect(JSON.stringify(tools.get("link_files")!.config.inputSchema)).toContain("hash");
    expect(tools.has("report_file_hashes")).toBe(true);
  });

  it("passes a remote agent's hash through untouched", async () => {
    const { tools, calls } = harness(remoteWs);
    const hash = "b".repeat(64);
    await tools.get("link_files")!.handler({
      task_id: 1,
      paths: [{ path: "/repo/a.ts", hash }],
    });
    expect(calls[0].params.paths).toEqual([{ path: "/repo/a.ts", hash }]);
  });
});

describe("annotations", () => {
  /** Without this a client cannot auto-approve the call every session starts with. */
  it("marks the reads as read-only", () => {
    const { tools } = harness(remoteWs);
    for (const name of ["get_context", "get_task", "list_tasks", "list_projects", "search"])
      expect(tools.get(name)!.config.annotations?.readOnlyHint).toBe(true);
  });

  it("leaves the writes unmarked", () => {
    const { tools } = harness(remoteWs);
    for (const name of ["create_task", "update_task", "log_entry", "link_files"])
      expect(tools.get(name)!.config.annotations?.readOnlyHint).toBeUndefined();
  });

  /** The one that deletes a project and everything under it, most of all. */
  it("does not let the destructive one look safe", () => {
    const { tools } = harness(remoteWs);
    const del = tools.get("delete_project")!;
    expect(del.config.annotations?.readOnlyHint).toBeUndefined();
    expect(del.config.description).toContain("confirm");
    expect(Object.keys(del.config.inputSchema)).toContain("confirm");
  });
});

describe("instructions", () => {
  it("tells a hosted agent that the hashing is its job", () => {
    expect(instructions({ local: false })).toContain("report_file_hashes");
    expect(instructions({ local: true })).not.toContain("report_file_hashes");
  });

  it("names the parameter get_context actually takes", () => {
    // The instructions said "cwd" while the field was called `project`, and
    // strict mode rejected the extra key -- so an agent that followed them
    // literally failed on its first call.
    expect(instructions({ local: true })).toContain("`cwd`");
  });
});
