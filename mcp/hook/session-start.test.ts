import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { DIGEST_CHARS, PREAMBLE, REMINDER, sessionStart } from "./session-start";
import { readEvents } from "./state";
import type { Logger } from "./log";
import type { HookContext } from "./types";

function context(rpc: HookContext["rpc"], cwd: string | undefined = "/repo") {
  const dataDir = mkdtempSync(join(tmpdir(), "todox-hook-start-"));
  return {
    config: { token: rpc ? "todox_t" : undefined, url: "http://x", dataDir, disabled: false },
    log: vi.fn<Logger>(),
    input: { session_id: "s1", cwd },
    rpc,
    now: () => new Date("2026-11-22T10:00:00Z"),
  } satisfies HookContext;
}

const contextOf = (out: unknown) =>
  (out as { hookSpecificOutput: { hookEventName: string; additionalContext: string } }).hookSpecificOutput;

describe("SessionStart", () => {
  it("puts the digest in front of the session, under the preamble", async () => {
    const rpc = vi.fn().mockResolvedValue({ digest: "todox briefing for repo (digest)." });
    const out = contextOf(await sessionStart(context(rpc)));

    expect(out.hookEventName).toBe("SessionStart");
    expect(out.additionalContext).toBe(`${PREAMBLE}\n\ntodox briefing for repo (digest).`);
  });

  it("asks for a digest that fits Claude Code's 10,000-character ceiling, and never registers a project", async () => {
    const rpc = vi.fn().mockResolvedValue({ digest: "d" });
    await sessionStart(context(rpc));

    expect(rpc).toHaveBeenCalledWith("getContext", {
      cwd: "/repo",
      shape: "digest",
      max_chars: DIGEST_CHARS,
      create_if_missing: false,
    });
    expect(DIGEST_CHARS + PREAMBLE.length + 2).toBeLessThan(10_000);
  });

  it("falls back to the reminder, and logs why, when the briefing cannot be had", async () => {
    const ctx = context(vi.fn().mockRejectedValue(new Error("invalid or revoked token")));
    expect(contextOf(await sessionStart(ctx)).additionalContext).toBe(REMINDER);
    expect(ctx.log).toHaveBeenCalledWith("session-start", expect.stringMatching(/revoked token/));
  });

  it("falls back when the server answers without a digest (an older server)", async () => {
    const ctx = context(vi.fn().mockResolvedValue({ project: { slug: "repo" } }));
    expect(contextOf(await sessionStart(ctx)).additionalContext).toBe(REMINDER);
  });

  it("reminds without asking when there is no token", async () => {
    const ctx = context(null);
    expect(contextOf(await sessionStart(ctx)).additionalContext).toBe(REMINDER);
    expect(ctx.log).toHaveBeenCalledWith("session-start", expect.stringMatching(/no token/));
  });

  it("records the session's start for the hooks that run later", async () => {
    const ctx = context(null);
    await sessionStart(ctx);
    expect(readEvents(ctx.config.dataDir, "s1")).toEqual([{ t: "start", at: "2026-11-22T10:00:00.000Z" }]);
  });
});
