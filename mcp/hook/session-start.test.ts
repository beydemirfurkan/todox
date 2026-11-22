import { describe, expect, it, vi } from "vitest";

import { STALE_HEADING } from "./linked-files";
import { DIGEST_CHARS, INJECT_CEILING, PREAMBLE, REMINDER, sessionStart, staleWarning } from "./session-start";
import { readEvents } from "./state";
import { hookContext } from "./test-context";
import type { HookContext } from "./types";

const context = (rpc: HookContext["rpc"]) => hookContext({ rpc });

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

  it("names the remote, so a second checkout at a new path still gets its briefing", async () => {
    const rpc = vi.fn().mockResolvedValue({ digest: "d" });
    await sessionStart(hookContext({ rpc, git: { root: () => "/repo", remote: () => "https://github.com/acme/repo.git" } }));
    expect(rpc).toHaveBeenCalledWith("getContext", expect.objectContaining({
      repo_url: "https://github.com/acme/repo.git",
      create_if_missing: false,
    }));
  });

  it("falls back to the reminder, and logs why, when the briefing cannot be had", async () => {
    const ctx = context(vi.fn().mockRejectedValue(new Error("invalid or revoked token")));
    expect(contextOf(await sessionStart(ctx)).additionalContext).toBe(REMINDER);
    expect(ctx.log).toHaveBeenCalledWith("session-start", expect.stringMatching(/revoked token/));
  });

  it("hands over the checkout's identity when the project cannot be had, so the agent can register it", async () => {
    const git = { root: () => "/work/mobile", remote: () => "git@github.com:acme/mobile.git" };
    const refused = hookContext({ rpc: vi.fn().mockRejectedValue(new Error("no repository at /work/mobile")), git });
    const text = contextOf(await sessionStart(refused)).additionalContext;
    expect(text.startsWith(REMINDER)).toBe(true);
    expect(text).toContain('repo_url "git@github.com:acme/mobile.git" and repo_root "/work/mobile"');

    const noRemote = hookContext({ rpc: null, git: { root: () => "/work/scratch", remote: () => undefined } });
    expect(contextOf(await sessionStart(noRemote)).additionalContext).toContain('pass repo_root "/work/scratch" with cwd');
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

  it("records where HEAD was at a fresh start, and not again on resume", async () => {
    const git = { root: () => "/repo", head: () => "abc123" };
    const fresh = hookContext({ git, input: { session_id: "s1", cwd: "/repo", source: "startup" } });
    await sessionStart(fresh);
    expect(readEvents(fresh.config.dataDir, "s1")[0]).toMatchObject({ head: "abc123" });

    const resumed = hookContext({ git, input: { session_id: "s1", cwd: "/repo", source: "compact" } });
    await sessionStart(resumed);
    expect(readEvents(resumed.config.dataDir, "s1")[0]).not.toHaveProperty("head");
  });

  it("records the session's start for the hooks that run later", async () => {
    const ctx = context(null);
    await sessionStart(ctx);
    expect(readEvents(ctx.config.dataDir, "s1")).toEqual([{ t: "start", at: "2026-11-22T10:00:00.000Z" }]);
  });
  it("adds the linked files that changed on this machine under the digest", async () => {
    const rpc = vi.fn(async (_method: string, params?: unknown) =>
      (params as { shape?: string } | undefined)?.shape === "digest"
        ? { digest: "d" }
        : { open_tasks: [{ id: 7, title: "Cart", files: [{ id: 70, path: "/repo/a.ts", hash: "aaa" }] }] },
    );
    const ctx = hookContext({
      rpc,
      checkFiles: (refs) => ({
        checked: refs.map((r) => ({ ...r, status: "changed" as const })),
        seen: refs.map((r) => ({ id: r.id, hash: "bbb" })),
      }),
    });
    const text = contextOf(await sessionStart(ctx)).additionalContext;
    expect(text).toBe(`${PREAMBLE}\n\nd\n\n${STALE_HEADING}\n- task #7 "Cart" -> /repo/a.ts (changed)`);
    expect(rpc).toHaveBeenCalledWith("reportRefs", { refs: [{ id: 70, hash: "bbb" }] });
  });

  it("keeps the briefing when the file check fails", async () => {
    const rpc = vi.fn(async (_method: string, params?: unknown) => {
      if ((params as { shape?: string } | undefined)?.shape !== "digest") throw new Error("slow");
      return { digest: "d" };
    });
    const ctx = hookContext({ rpc });
    expect(contextOf(await sessionStart(ctx)).additionalContext).toBe(`${PREAMBLE}\n\nd`);
    expect(ctx.log).toHaveBeenCalledWith("session-start", expect.stringMatching(/linked files not checked: slow/));
  });

  it("cuts the warning to the room the digest leaves, and drops it when none is left", () => {
    const lines = ["- a", "- b", "- c"];
    const whole = staleWarning(lines, 10_000);
    expect(whole).toBe(`\n\n${STALE_HEADING}\n- a\n- b\n- c`);
    expect(staleWarning(lines, whole.length - 1)).toBe(`\n\n${STALE_HEADING}\n- a\n- b`);
    expect(staleWarning(lines, 20)).toBe("");
    expect(INJECT_CEILING).toBeLessThan(10_000);
  });
});

