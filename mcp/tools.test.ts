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
  clientInfo: async () => null,
};

const remoteWs: Workspace = {
  tz: () => undefined,
  repoRoot: () => undefined,
  repoUrl: () => undefined,
  hash: () => null,
  checkRefs: () => null,
  clientInfo: async () => null,
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
  /**
   * Server-side only; the agent is the thing they record, so neither is a tool.
   *
   * `recordClientInfo` names the client the model is running inside.
   * `recordObservation` reports what the session did to the tree, and it is
   * kept off the surface for a sharper reason than symmetry: an observation a
   * model could write is an observation a model could flatter. The value of
   * the row is that nobody had to be asked for it.
   */
  const NEVER_A_TOOL = ["recordClientInfo", "recordObservation"];
  /** The local process checks its own files, so hosted is the only one that asks. */
  const HOSTED_ONLY = ["reportRefs"];

  const methods = Object.keys(SHAPES).length;

  it("registers every method hosted, bar the server-side ones", () => {
    expect(harness(remoteWs).tools.size).toBe(methods - NEVER_A_TOOL.length);
  });

  it("registers every method locally, bar those and the hosted-only one", () => {
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

  it("tells an agent how the query is actually read", () => {
    // The instructions name the two moments to reach for search -- 'have I hit
    // this before?' and 'where did we decide X?' -- and those are the right
    // moments. What they used to leave out is that the query is not phrased
    // that way, so an agent followed them literally and searched the sentence.
    for (const local of [true, false]) {
      const text = instructions({ local });
      expect(text).toMatch(/Ask it in words/);
      expect(text).toMatch(/parsed and ranked/);
    }
  });
});

/**
 * What the search tool promises.
 *
 * `lib/services/search.ts` is three `ILIKE '%q%'` scans merged and sorted by
 * `created_at` -- no index, no ranking, no stemming. The description called
 * that "Full-text-ish search" and invited exactly the query it cannot answer,
 * so a model asked its question in a sentence, got `[]`, and had no way to
 * tell an empty log from an unusable query.
 *
 * These assertions are here rather than in `search.test.ts` because the defect
 * was never in the SQL: the SQL does what it says it does. The gap was between
 * the implementation and the sentence an agent reads before calling it, and a
 * sentence drifts back the moment somebody improves the wording. Assert the
 * claim, not the prose around it -- restoring "full-text" has to fail here.
 */
/**
 * What the briefing tool promises about its own ceilings.
 *
 * Here rather than in `briefing.test.ts` for the reason the search block below
 * gives: the defect this guards against was never in the SQL. The description
 * said "three log entries per kind per task" and nothing about bytes, which
 * was true and useless -- three entries of 6 KB each is not a ceiling, and the
 * agent reading that sentence had no reason to expect a body it could not
 * read. A sentence drifts back the moment somebody improves the wording, so
 * assert the claim rather than the prose.
 */
describe("the briefing tool's description", () => {
  const briefingDescription = () =>
    harness(remoteWs).tools.get("get_context")!.config.description!;

  it("says the log bodies have a byte budget, not only a count", () => {
    expect(briefingDescription()).toMatch(/byte budget/i);
  });

  it("no longer describes the cap as three entries per kind and stops there", () => {
    // The sentence this block was written for.
    expect(briefingDescription()).not.toMatch(/three log entries per kind per task, and sixty/i);
  });

  it("says a null body is a spent budget and not an empty record", () => {
    expect(briefingDescription()).toMatch(/null means the budget was already spent/i);
  });

  it("names the call that reads what it did not send", () => {
    // Without this the budget is indistinguishable from losing the log.
    expect(briefingDescription()).toMatch(/get_task/);
  });

  it("promises the head that makes an unpaid record usable", () => {
    expect(briefingDescription()).toMatch(/head/i);
  });

  it("is the same sentence on both transports", () => {
    // The one difference between them is a Workspace, never the tool list.
    expect(harness(localWs).tools.get("get_context")!.config.description).toBe(
      briefingDescription(),
    );
  });
});

describe("the search tool's description", () => {
  const searchDescription = () => harness(remoteWs).tools.get("search")!.config.description!;

  it("says what the match actually is", () => {
    expect(searchDescription()).toMatch(/Full-text search/i);
  });

  it("never claims to be full-text-ish", () => {
    // The word this file was created for. It described three ILIKE scans, and
    // a model reading it wrote the question out and got nothing back.
    expect(searchDescription()).not.toMatch(/full-text-ish/i);
  });

  it("tells the caller a whole question is the right shape", () => {
    // The previous description said the opposite, correctly at the time, and
    // an agent that keeps following it narrows every query for no reason.
    const text = searchDescription();
    expect(text).toMatch(/in words/i);
    expect(text).toMatch(/phrase/i);
  });

  it("says the order is relevance", () => {
    // Otherwise the first hit reads as merely the newest, which is what it
    // used to be.
    expect(searchDescription()).toMatch(/ranked by relevance/i);
  });

  it("still promises the substring case, which is the arm under the index", () => {
    // Removing the ILIKE fallback takes the bench from 24/24 to 23/24, and it
    // is the only thing that finds the middle of an identifier.
    expect(searchDescription()).toMatch(/substring/i);
  });

  it("is offered on both transports, and identically", () => {
    // It touches no filesystem, so there is no reason for it to differ -- and
    // if it ever does, the agent surface has stopped being defined once.
    const local = harness(localWs).tools.get("search")!.config.description;
    expect(local).toBe(searchDescription());
  });
});
