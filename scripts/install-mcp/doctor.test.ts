import { afterEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "./doctor";

/**
 * The doctor is the thing that turns a broken install into a loud one, and it
 * had no test of its own. The case that mattered was the one it could not
 * report at all: `fetch` rejects on a refused connection, that rejection went
 * straight past `runDoctor`, and the CLI printed a bare "fetch failed" over a
 * config it had already written — so the user could not tell whether the
 * install had worked.
 */

const TOOLS = ["get_context", "create_task", "log_entry", "update_task"];

/** A `fetch` stub that answers each JSON-RPC method from a table. */
function stubFetch(answers: {
  initialize?: { status: number; body?: unknown };
  "tools/list"?: { status: number; body?: unknown };
  "tools/call"?: { status: number; body?: unknown };
}) {
  const fetchStub = vi.fn(async (_url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body) as { method: string };
    const answer = answers[method as keyof typeof answers] ?? { status: 200, body: {} };
    return {
      status: answer.status,
      json: async () => answer.body ?? {},
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

const OK_TOOLS = { status: 200, body: { result: { tools: TOOLS.map((name) => ({ name })) } } };
const OK_CONTEXT = {
  status: 200,
  body: { result: { content: [{ type: "text", text: JSON.stringify({ project: "todox" }) }] } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runDoctor", () => {
  it("reports a healthy server", async () => {
    stubFetch({ "tools/list": OK_TOOLS, "tools/call": OK_CONTEXT });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk", cwd: "/repo" });

    expect(report.ok).toBe(true);
    expect(report.detail).toContain("tools=4");
  });

  it("turns an unreachable server into a report, not a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    // The regression: this used to reject, and the CLI printed the bare
    // "fetch failed" with no indication that the config had been written.
    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk" });

    expect(report.ok).toBe(false);
    expect(report.detail).toContain("cannot reach https://x/api/mcp");
    expect(report.detail).toContain("fetch failed");
    expect(report.detail).toMatch(/server is running/);
  });

  it("names the token as the thing to replace on a 401", async () => {
    stubFetch({ initialize: { status: 401 } });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "stale" });

    expect(report.ok).toBe(false);
    // "initialize HTTP 401" does not tell anyone what to do next.
    expect(report.detail).toMatch(/rejected the token/);
    expect(report.detail).toMatch(/Account page/);
  });

  it("points at the URL shape on a 404", async () => {
    stubFetch({ initialize: { status: 404 } });

    const report = await runDoctor({ url: "https://x", token: "tk" });

    expect(report.detail).toMatch(/should end in \/api\/mcp/);
  });

  it("names the tools that are missing", async () => {
    stubFetch({
      "tools/list": { status: 200, body: { result: { tools: [{ name: "get_context" }] } } },
    });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk" });

    expect(report.ok).toBe(false);
    expect(report.detail).toBe("tools missing: create_task, log_entry");
  });

  it("reports a get_context error rather than calling the install healthy", async () => {
    stubFetch({
      "tools/list": OK_TOOLS,
      "tools/call": { status: 200, body: { error: { message: "no such project" } } },
    });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk" });

    expect(report).toEqual({ ok: false, detail: "get_context error: no such project" });
  });

  it("relays a tool error verbatim instead of calling it malformed", async () => {
    stubFetch({
      "tools/list": OK_TOOLS,
      // How the hosted server reports a failed tool: a 200, a JSON-RPC result,
      // and isError. This is what a rotated database password looks like from
      // the outside, and it was being reported as "returned non-JSON".
      "tools/call": {
        status: 200,
        body: {
          result: {
            content: [{ type: "text", text: "error: the server could not complete that call" }],
            isError: true,
          },
        },
      },
    });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk" });

    expect(report.ok).toBe(false);
    expect(report.detail).toBe(
      "get_context failed: error: the server could not complete that call",
    );
  });

  it("rejects a get_context body that is not JSON", async () => {
    stubFetch({
      "tools/list": OK_TOOLS,
      "tools/call": {
        status: 200,
        body: { result: { content: [{ type: "text", text: "<html>502</html>" }] } },
      },
    });

    const report = await runDoctor({ url: "https://x/api/mcp", token: "tk" });

    // A proxy that answers HTML with a 200 is exactly the kind of "working"
    // server that would otherwise pass.
    expect(report).toEqual({ ok: false, detail: "get_context returned non-JSON" });
  });

  it("sends the bearer token and the cwd it was given", async () => {
    const fetchStub = stubFetch({ "tools/list": OK_TOOLS, "tools/call": OK_CONTEXT });

    await runDoctor({ url: "https://x/api/mcp", token: "tk", cwd: "/repo/here" });

    const calls = fetchStub.mock.calls.map(([, init]) => JSON.parse(init.body));
    const contextCall = calls.find((call) => call.method === "tools/call");
    expect(contextCall.params.arguments.cwd).toBe("/repo/here");
    expect(contextCall.params.arguments.create_if_missing).toBe(false);
  });
});
