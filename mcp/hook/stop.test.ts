import { describe, expect, it, vi } from "vitest";

import { appendEvent, readEvents } from "./state";
import { handoffReason, stop, windowHours } from "./stop";
import { hookContext } from "./test-context";
import type { HookContext } from "./types";

const NOW = new Date("2026-11-22T10:00:00Z");

function session(options: { rpc?: HookContext["rpc"]; stopMode?: "default" | "off" | "strict"; stopHookActive?: boolean } = {}) {
  const ctx = hookContext({
    rpc: options.rpc ?? null,
    now: NOW,
    config: { stopMode: options.stopMode ?? "default" },
    input: { session_id: "s1", cwd: "/repo", stop_hook_active: options.stopHookActive ?? false },
  });
  appendEvent(ctx.config.dataDir, "s1", { t: "start", at: "2026-11-22T08:30:00Z" });
  return ctx;
}

const touched = (ctx: ReturnType<typeof session>, id: number) =>
  appendEvent(ctx.config.dataDir, "s1", { t: "task", at: NOW.toISOString(), id });
const edited = (ctx: ReturnType<typeof session>) => appendEvent(ctx.config.dataDir, "s1", { t: "edit", at: NOW.toISOString() });

const statusWith = (...yours: { id: number; title: string; status: string; handoff_missing: boolean }[]) =>
  vi.fn().mockResolvedValue({ yours, stale: [], hint: "" });

describe("Stop: the handoff, once", () => {
  it("stops a session that left its own task 'doing', and names it", async () => {
    const rpc = statusWith({ id: 7, title: "Wire the digest", status: "doing", handoff_missing: true });
    const ctx = session({ rpc });
    touched(ctx, 7);

    const out = (await stop(ctx)) as { decision: string; reason: string };

    expect(out.decision).toBe("block");
    expect(out.reason).toContain('#7 "Wire the digest"');
    expect(out.reason).toMatch(/If the developer asked to stop now, say so and stop\.$/);
    expect(rpc).toHaveBeenCalledWith("sessionStatus", { cwd: "/repo", hours: 3 });
  });

  it("stops only once, however the second stop arrives", async () => {
    const ctx = session({ rpc: statusWith({ id: 7, title: "t", status: "doing", handoff_missing: false }) });
    touched(ctx, 7);
    expect(await stop(ctx)).not.toBeNull();
    expect(await stop(ctx)).toBeNull();
    expect(readEvents(ctx.config.dataDir, "s1").filter((e) => e.t === "blocked")).toHaveLength(1);
  });

  it("ignores tasks another session of the same account touched", async () => {
    const ctx = session({ rpc: statusWith({ id: 99, title: "someone else's", status: "doing", handoff_missing: true }) });
    touched(ctx, 7);
    expect(await stop(ctx)).toBeNull();
  });

  it("lets a written-up session go", async () => {
    const ctx = session({ rpc: statusWith({ id: 7, title: "t", status: "done", handoff_missing: false }) });
    touched(ctx, 7);
    expect(await stop(ctx)).toBeNull();
  });

  it("never stops a continuation of a stop, a session opted out, or TODOX_STOP=off", async () => {
    const owing = () => statusWith({ id: 7, title: "t", status: "doing", handoff_missing: true });

    const active = session({ rpc: owing(), stopHookActive: true });
    touched(active, 7);
    expect(await stop(active)).toBeNull();

    const off = session({ rpc: owing(), stopMode: "off" });
    touched(off, 7);
    expect(await stop(off)).toBeNull();

    const optedOut = session({ rpc: owing() });
    touched(optedOut, 7);
    appendEvent(optedOut.config.dataDir, "s1", { t: "optout", at: NOW.toISOString() });
    expect(await stop(optedOut)).toBeNull();
  });

  it("asks nothing of a session that only read", async () => {
    const rpc = vi.fn();
    expect(await stop(session({ rpc }))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails open when todox cannot be asked", async () => {
    const ctx = session({ rpc: vi.fn().mockRejectedValue(new Error("cannot reach todox")) });
    touched(ctx, 7);
    expect(await stop(ctx)).toBeNull();
    expect(ctx.log).toHaveBeenCalledWith("stop", expect.stringMatching(/not stopping/));
  });
});

describe("Stop: edits with no task", () => {
  it("tells the developer once, by default, and never stops the turn", async () => {
    const ctx = session();
    edited(ctx);
    expect(await stop(ctx)).toEqual({ systemMessage: expect.stringMatching(/without touching a todox task/) });
    expect(await stop(ctx)).toBeNull();
  });

  it("stops once under TODOX_STOP=strict", async () => {
    const ctx = session({ stopMode: "strict" });
    edited(ctx);
    expect(await stop(ctx)).toEqual({ decision: "block", reason: expect.stringMatching(/say so and stop\.$/) });
    expect(await stop(ctx)).toBeNull();
  });
});

describe("windowHours", () => {
  it("covers the session from its first event, with an hour of slack, inside session_status's bounds", () => {
    expect(windowHours([{ t: "start", at: "2026-11-22T08:30:00Z" }], NOW)).toBe(3);
    expect(windowHours([], NOW)).toBe(1);
    expect(windowHours([{ t: "start", at: "2026-10-01T00:00:00Z" }], NOW)).toBe(168);
  });
});

describe("handoffReason", () => {
  it("says what each task lacks, and the exact calls", () => {
    const reason = handoffReason([
      { id: 1, title: "a", status: "doing", handoff_missing: false },
      { id: 2, title: "b", status: "done", handoff_missing: true },
    ]);
    expect(reason).toContain(`#1 "a": still 'doing'`);
    expect(reason).toContain(`#2 "b": no handoff since your last change`);
    expect(reason).toMatch(/update_task/);
    expect(reason).toMatch(/kind:'handoff'/);
    expect(reason).toMatch(/kind:'dead_end'/);
  });
});
