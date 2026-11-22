import { describe, expect, it, vi } from "vitest";

import { preCompact, UNTRACKED_EDITS } from "./pre-compact";
import { appendEvent } from "./state";
import { hookContext } from "./test-context";
import type { HookContext } from "./types";

const NOW = new Date("2026-11-22T10:00:00Z");

function session(options: { rpc?: HookContext["rpc"]; stopMode?: "default" | "off" | "strict" } = {}) {
  const ctx = hookContext({
    rpc: options.rpc ?? null,
    now: NOW,
    config: { stopMode: options.stopMode ?? "default" },
    input: { session_id: "s1", cwd: "/repo", hook_event_name: "PreCompact", trigger: "auto" },
  });
  appendEvent(ctx.config.dataDir, "s1", { t: "start", at: "2026-11-22T08:30:00Z" });
  return ctx;
}

const touched = (ctx: HookContext, id: number) =>
  appendEvent(ctx.config.dataDir, "s1", { t: "task", at: NOW.toISOString(), id });
const edited = (ctx: HookContext) => appendEvent(ctx.config.dataDir, "s1", { t: "edit", at: NOW.toISOString() });

const statusWith = (...yours: { id: number; title: string; status: string; handoff_missing: boolean }[]) =>
  vi.fn().mockResolvedValue({ yours, stale: [], hint: "" });

describe("PreCompact: what the summary must keep", () => {
  it("names this session's unwritten tasks and asks for the write-up after compaction", async () => {
    const rpc = statusWith(
      { id: 7, title: "Wire the digest", status: "doing", handoff_missing: true },
      { id: 9, title: "Another session's", status: "doing", handoff_missing: true },
    );
    const ctx = session({ rpc });
    touched(ctx, 7);

    const out = await preCompact(ctx);

    expect(typeof out).toBe("string");
    expect(out).toContain(`#7 "Wire the digest": still 'doing'; no handoff since its last change`);
    expect(out).not.toContain("#9");
    expect(out).toMatch(/right after compaction, before anything else/);
    expect(rpc).toHaveBeenCalledWith("sessionStatus", { cwd: "/repo", hours: 3 });
  });

  it("says nothing when every touched task is written up", async () => {
    const ctx = session({ rpc: statusWith({ id: 7, title: "t", status: "done", handoff_missing: false }) });
    touched(ctx, 7);
    expect(await preCompact(ctx)).toBeNull();
  });

  it("says nothing for a session that only read", async () => {
    expect(await preCompact(session({ rpc: statusWith() }))).toBeNull();
  });

  it("keeps the why of edits made with no task", async () => {
    const ctx = session({ rpc: statusWith() });
    edited(ctx);
    expect(await preCompact(ctx)).toBe(UNTRACKED_EDITS);
  });

  it("still names the touched ids when there is no token to ask with", async () => {
    const ctx = session();
    touched(ctx, 7);
    expect(await preCompact(ctx)).toContain("- #7");
  });

  it("respects the developer's opt-out, for the session and for always", async () => {
    const optedOut = session({ rpc: statusWith({ id: 7, title: "t", status: "doing", handoff_missing: true }) });
    touched(optedOut, 7);
    appendEvent(optedOut.config.dataDir, "s1", { t: "optout", at: NOW.toISOString() });
    expect(await preCompact(optedOut)).toBeNull();

    const off = session({ stopMode: "off", rpc: statusWith({ id: 7, title: "t", status: "doing", handoff_missing: true }) });
    touched(off, 7);
    expect(await preCompact(off)).toBeNull();
  });

  it("stays under Claude Code's 10,000 characters however many tasks", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: i + 1,
      title: "x".repeat(80),
      status: "doing",
      handoff_missing: true,
    }));
    const ctx = session({ rpc: statusWith(...many) });
    for (const t of many) touched(ctx, t.id);
    expect(((await preCompact(ctx)) as string).length).toBeLessThanOrEqual(10_000);
  });
});
