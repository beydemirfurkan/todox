import { describe, expect, it, vi } from "vitest";

import { HOOK_CLIENT, observeSession } from "./observe";
import { appendEvent, readEvents } from "./state";
import { hookContext } from "./test-context";
import type { HookGit } from "./types";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const OLDER = "c".repeat(40);

function checkout(overrides: Partial<HookGit> = {}): Partial<HookGit> {
  return {
    root: () => "/repo",
    head: () => HEAD,
    branch: () => "feat/x",
    dirty: () => 2,
    since: (_dir, base) => (base === OLDER ? { count: 5, subjects: ["older", "fix"] } : { count: 1, subjects: ["fix"] }),
    remote: () => "https://github.com/acme/repo.git",
    ...overrides,
  };
}

function session(options: { git?: Partial<HookGit>; reply?: unknown; observe?: boolean } = {}) {
  const rpc = vi.fn().mockResolvedValue(options.reply ?? { ok: true, last_head_sha: BASE });
  const ctx = hookContext({
    rpc,
    git: options.git ?? checkout(),
    config: { observe: options.observe ?? true },
    input: { session_id: "s1", cwd: "/repo/sub" },
  });
  appendEvent(ctx.config.dataDir, "s1", { t: "start", at: "2026-11-22T08:00:00.000Z", head: BASE });
  return { ctx, rpc };
}

describe("the hook as an observation carrier", () => {
  it("sends what git did since the session opened, labelled as the hook's", async () => {
    const { ctx, rpc } = session();
    appendEvent(ctx.config.dataDir, "s1", { t: "doing", at: "x", id: 7 });

    await observeSession(ctx);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("recordObservation", {
      cwd: "/repo",
      session_id: "cc:s1",
      client: HOOK_CLIENT,
      branch: "feat/x",
      base_sha: BASE,
      head_sha: HEAD,
      commits: 1,
      files_changed: 2,
      commit_subjects: "fix",
      task_ids: [7],
      started_at: "2026-11-22T08:00:00.000Z",
      repo_url: "https://github.com/acme/repo.git",
      source: "claude-code-hook",
    });
  });

  it("leaves repo_url out for a checkout with no remote", async () => {
    const { ctx, rpc } = session({ git: checkout({ remote: () => undefined }) });
    await observeSession(ctx);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("repo_url");
  });

  it("sends nothing for a session that changed nothing", async () => {
    const { ctx, rpc } = session({ git: checkout({ head: () => BASE, dirty: () => 0, since: () => ({ count: 0, subjects: [] }) }) });
    await observeSession(ctx);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not send the same state twice (Stop, then SessionEnd)", async () => {
    const { ctx, rpc } = session();
    await observeSession(ctx);
    await observeSession(ctx);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("widens the window once, back to the last HEAD the server recorded", async () => {
    const { ctx, rpc } = session({ reply: { ok: true, last_head_sha: OLDER } });
    await observeSession(ctx);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({ base_sha: OLDER, commits: 5, commit_subjects: "older\nfix" });
    expect(readEvents(ctx.config.dataDir, "s1").at(-1)).toMatchObject({ t: "observed", base: OLDER });
  });

  it("believes the server when the stdio process already has this session", async () => {
    const { ctx, rpc } = session({ reply: { ok: true, skipped: "stdio_active", last_head_sha: OLDER } });
    await observeSession(ctx);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("is off with TODOX_OBSERVE=off, outside a checkout, and before the first commit", async () => {
    const off = session({ observe: false });
    await observeSession(off.ctx);
    expect(off.rpc).not.toHaveBeenCalled();

    const outside = session({ git: checkout({ root: () => undefined }) });
    await observeSession(outside.ctx);
    expect(outside.rpc).not.toHaveBeenCalled();

    const empty = session({ git: checkout({ head: () => undefined }) });
    await observeSession(empty.ctx);
    expect(empty.rpc).not.toHaveBeenCalled();
  });

  it("never throws, and logs a refusal", async () => {
    const { ctx } = session();
    ctx.rpc = vi.fn().mockRejectedValue(new Error("Unrecognized key: source"));
    await expect(observeSession(ctx)).resolves.toBeUndefined();
    expect(ctx.log).toHaveBeenCalledWith("observe", expect.stringMatching(/Unrecognized key/));
  });
});
