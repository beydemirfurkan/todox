import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runHook } from "./index";
import { REMINDER } from "./session-start";

const env = (extra: Record<string, string> = {}) => ({
  CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), "todox-hook-index-")),
  TODOX_URL: "http://todox.test",
  ...extra,
});

const input = JSON.stringify({ session_id: "s1", cwd: "/repo" });

afterEach(() => vi.unstubAllGlobals());

describe("the hook entry point", () => {
  it("says it is a hook on every call, so the server does not count it as the agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, result: { digest: "d" } }));
    vi.stubGlobal("fetch", fetchMock);

    await runHook("session-start", input, env({ CLAUDE_PLUGIN_OPTION_TOKEN: "todox_t" }));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://todox.test/api/rpc");
    expect(init.headers["x-todox-carrier"]).toBe("claude-code-hook");
    expect(init.headers.authorization).toBe("Bearer todox_t");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("prints nothing and touches nothing with TODOX_HOOKS=off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await runHook("session-start", input, env({ TODOX_HOOKS: "off", CLAUDE_PLUGIN_OPTION_TOKEN: "t" }))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open on input it cannot read, and leaves a line saying so", async () => {
    const e = env();
    expect(await runHook("session-start", "not json", e)).toBeNull();
    expect(readFileSync(join(e.CLAUDE_PLUGIN_DATA, "hook.log"), "utf8")).toMatch(/session-start failed/);
  });

  it("ignores an event it does not know, rather than guessing", async () => {
    const e = env();
    expect(await runHook("post-compact", input, e)).toBeNull();
    expect(readFileSync(join(e.CLAUDE_PLUGIN_DATA, "hook.log"), "utf8")).toMatch(/unknown hook event/);
  });

  it("still reminds when todox is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const out = (await runHook("session-start", input, env({ CLAUDE_PLUGIN_OPTION_TOKEN: "t" }))) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(out.hookSpecificOutput.additionalContext).toBe(REMINDER);
  });
});
