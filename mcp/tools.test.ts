import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { SHAPES } from "@/lib/services/rpc-schemas";
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
  repoUrl: () => "git@github.com:me/repo.git",
  hash: () => "a".repeat(64),
  checkRefs: (refs) => ({
    checked: refs.map((r) => ({ ...r, status: "fresh" as const })),
    seen: refs.map((r) => ({ id: r.id, hash: r.hash })),
  }),
  bearerToken: () => undefined,
};

const remoteWs: Workspace = {
  tz: () => undefined,
  repoRoot: () => undefined,
  repoUrl: () => undefined,
  hash: () => null,
  checkRefs: () => null,
  bearerToken: () => undefined,
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
    expect(tools.get("get_context")!.config.inputSchema).not.toHaveProperty("repo_url");
    expect(tools.get("activity_report")!.config.inputSchema).not.toHaveProperty("tz");
  });

  it("a hosted server asks the agent for them instead", () => {
    const { tools } = harness(remoteWs);
    expect(tools.get("get_context")!.config.inputSchema).toHaveProperty("repo_root");
    expect(tools.get("get_context")!.config.inputSchema).toHaveProperty("repo_url");
    expect(tools.get("activity_report")!.config.inputSchema).toHaveProperty("tz");
  });

  it("fills the repo root in from cwd when it can", async () => {
    const { tools, calls } = harness(localWs);
    await tools.get("get_context")!.handler({ cwd: "/repo/src" });
    expect(calls[0].params.repo_root).toBe("/repo");
  });

  /**
   * The path differs on every machine; the remote does not. A local process can
   * read it, so it must -- otherwise resolution falls back to comparing
   * absolute paths, which is what registered one repo as two projects.
   */
  it("fills the repo remote in from cwd, so a second machine resolves", async () => {
    const { tools, calls } = harness(localWs);
    await tools.get("get_context")!.handler({ cwd: "/repo/src" });
    expect(calls[0].params.repo_url).toBe("git@github.com:me/repo.git");
  });

  it("sends no remote when this side cannot read one", async () => {
    const { tools, calls } = harness(remoteWs);
    await tools.get("get_context")!.handler({ cwd: "/repo/src" });
    expect(calls[0].params).not.toHaveProperty("repo_url");
  });

  /** What the model sent wins: it is the side that can see the checkout. */
  it("does not overwrite a remote the agent supplied", async () => {
    const { tools, calls } = harness(localWs);
    await tools
      .get("get_context")!
      .handler({ cwd: "/repo/src", repo_url: "https://github.com/me/other.git" });
    expect(calls[0].params.repo_url).toBe("https://github.com/me/other.git");
  });

  /**
   * `repo_url` is hidden per-tool, not account-wide, and this is why.
   *
   * `update_project` and `create_project` exist partly to set the remote, and
   * their reference is a slug -- so the injection above cannot fill it in for
   * them. Hiding it there would leave a local agent with no way to record one
   * at all, which is the opposite of the point.
   */
  it("still lets a local agent set the remote explicitly", () => {
    const { tools } = harness(localWs);
    expect(tools.get("update_project")!.config.inputSchema).toHaveProperty("repo_url");
    expect(tools.get("create_project")!.config.inputSchema).toHaveProperty("repo_url");
  });
});

describe("merge_projects", () => {
  /** The way back from a repo registered twice; both transports need it. */
  it.each([
    ["local", localWs],
    ["hosted", remoteWs],
  ])("is registered on the %s transport", (_name, ws) => {
    const { tools } = harness(ws as Workspace);
    expect(tools.get("merge_projects")).toBeDefined();
  });

  it("is not marked read-only, and asks for a confirmation", () => {
    const { tools } = harness(remoteWs);
    const tool = tools.get("merge_projects")!;

    expect(tool.config.annotations?.readOnlyHint).not.toBe(true);
    expect(tool.config.inputSchema).toHaveProperty("confirm");
    expect(tool.config.description).toMatch(/confirm/);
  });
});

/**
 * What the agent is actually handed back.
 *
 * Every test above asserts what went out — the schema, the params — and none
 * asserted what came back, which is how `get_context` shipped returning `{}`
 * to every agent on both transports. Its `transform` is async and the call
 * site did not await it, so the briefing was serialised as a pending promise.
 * A tool that answers `{}` still looks connected: it lists, it responds, it
 * reports no error.
 */
describe("the payload the agent receives", () => {
  /** The single text block a tool answers with, parsed. */
  const payloadOf = (result: unknown) =>
    JSON.parse(
      (result as { content: { text: string }[] }).content[0].text,
    ) as Record<string, unknown>;

  it("returns the server's briefing, not an empty object", async () => {
    const { tools } = harness(localWs);

    const result = await tools.get("get_context")!.handler({ cwd: "/repo" });

    // The harness's invoker answers `{ ok: true }`; anything that loses it —
    // an unawaited promise most of all — shows up here as `{}`.
    expect(payloadOf(result)).toMatchObject({ ok: true });
  });

  it("returns a briefing on the hosted transport too", async () => {
    // The hosted workspace has no filesystem, so it takes the other branch of
    // every `after`/`transform` hook. Both transports, one assertion each.
    const { tools } = harness(remoteWs);

    const result = await tools.get("get_context")!.handler({ cwd: "/repo" });

    expect(payloadOf(result)).toMatchObject({ ok: true });
  });

  it("never answers with a serialised promise", async () => {
    const { tools } = harness(localWs);

    for (const name of ["get_context", "list_tasks", "list_projects"]) {
      const result = await tools.get(name)!.handler({ cwd: "/repo" });
      const text = (result as { content: { text: string }[] }).content[0].text;
      // `JSON.stringify(Promise.resolve(x))` is exactly "{}", and that is the
      // shape this whole block exists to keep out.
      expect(text, name).not.toBe("{}");
    }
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

/**
 * Every method reaches an agent, or is on the list of the ones that do not.
 *
 * Registering a tool is step four of a six-file change, and the four steps
 * before it all fail loudly: a schema without a handler will not compile, a
 * handler without a schema will not either. This one fails by silence — the
 * method works over `/api/rpc` and simply does not exist as a tool, which is
 * indistinguishable from a model choosing not to call it.
 *
 * Counted rather than matched by name, because the two do not line up:
 * `reportRefs` is registered as `report_file_hashes`.
 */
describe("the agent surface covers the method list", () => {
  /** Server-side only; the agent is the thing it records, so it is not a tool. */
  const NEVER_A_TOOL = ["recordClientInfo"];
  /** The local process checks its own files, so hosted is the only one that asks. */
  const HOSTED_ONLY = ["reportRefs"];

  const methods = Object.keys(SHAPES).length;

  it("registers every method hosted, bar the server-side one", () => {
    expect(harness(remoteWs).tools.size).toBe(methods - NEVER_A_TOOL.length);
  });

  it("registers every method locally, bar that one and the hosted-only one", () => {
    expect(harness(localWs).tools.size).toBe(
      methods - NEVER_A_TOOL.length - HOSTED_ONLY.length,
    );
  });

  it("differs between the two transports by exactly the hosted-only tool", () => {
    // The agent surface is defined once; what changes between transports is a
    // Workspace, not a copy of the tool list.
    const local = new Set(harness(localWs).tools.keys());
    const missing = [...harness(remoteWs).tools.keys()].filter((n) => !local.has(n));
    expect(missing).toEqual(["report_file_hashes"]);
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
