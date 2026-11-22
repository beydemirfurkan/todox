import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CLIENT, type CommitGit, observeCommit, sessionKey, STATE_FILE } from "./observe-commit";

const PARENT = "a".repeat(40);
const HEAD = "b".repeat(40);
const NEXT = "d".repeat(40);
const SERVER_HEAD = "c".repeat(40);
const NOW = new Date(2026, 10, 22, 10, 0, 0);

function repo() {
  const gitDir = mkdtempSync(join(tmpdir(), "todox-git-hook-"));
  let head = HEAD;
  let dirty = 0;
  const git: CommitGit = {
    root: () => "/repo",
    gitDir: () => gitDir,
    head: () => head,
    parent: () => PARENT,
    branch: () => "main",
    dirty: () => dirty,
    since: (_dir, base) =>
      base === SERVER_HEAD ? { count: 4, subjects: ["older", "fix"] } : { count: head === NEXT ? 2 : 1, subjects: ["fix"] },
  };
  return {
    gitDir,
    git,
    commit: (sha: string) => {
      head = sha;
    },
    makeDirty: (n: number) => {
      dirty = n;
    },
  };
}

function context(r: ReturnType<typeof repo>, reply: unknown = { ok: true, last_head_sha: PARENT }, event = "post-commit") {
  const rpc = vi.fn().mockResolvedValue(reply);
  return { rpc, ctx: { event, cwd: "/repo/sub", git: r.git, rpc, log: vi.fn(), now: () => NOW } };
}

describe("a commit, observed by the git hook", () => {
  it("sends the commit since the day's first parent, labelled as the git hook's", async () => {
    const r = repo();
    const { rpc, ctx } = context(r);

    expect(await observeCommit(ctx)).toBe("sent");
    expect(rpc).toHaveBeenCalledWith("recordObservation", {
      cwd: "/repo",
      session_id: sessionKey("main", NOW),
      client: CLIENT,
      branch: "main",
      base_sha: PARENT,
      head_sha: HEAD,
      commits: 1,
      files_changed: 0,
      commit_subjects: "fix",
      started_at: NOW.toISOString(),
      source: "git-hook",
    });
  });

  it("keeps the day's base for the next commit, so one row grows", async () => {
    const r = repo();
    await observeCommit(context(r).ctx);
    r.commit(NEXT);
    const { rpc, ctx } = context(r);

    await observeCommit(ctx);

    expect(rpc.mock.calls[0][1]).toMatchObject({ base_sha: PARENT, head_sha: NEXT, commits: 2 });
  });

  it("sends nothing twice for one state (post-commit and post-rewrite after an amend)", async () => {
    const r = repo();
    await observeCommit(context(r).ctx);
    const { rpc, ctx } = context(r, undefined, "post-rewrite");
    expect(await observeCommit(ctx)).toBe("unchanged");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stays quiet through a rebase's replayed commits, and speaks once at post-rewrite", async () => {
    const r = repo();
    mkdirSync(join(r.gitDir, "rebase-merge"));
    const during = context(r);
    expect(await observeCommit(during.ctx)).toBe("rebasing");
    expect(during.rpc).not.toHaveBeenCalled();

    const after = context(r, undefined, "post-rewrite");
    expect(await observeCommit(after.ctx)).toBe("sent");
  });

  it("widens once to the server's last HEAD, and remembers the wider base", async () => {
    const r = repo();
    const { rpc, ctx } = context(r, { ok: true, last_head_sha: SERVER_HEAD });

    await observeCommit(ctx);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toMatchObject({ base_sha: SERVER_HEAD, commits: 4, commit_subjects: "older\nfix" });
    const state = JSON.parse(readFileSync(join(r.gitDir, STATE_FILE), "utf8")) as { base: string; widened: boolean };
    expect(state).toMatchObject({ base: SERVER_HEAD, widened: true });

    r.makeDirty(1);
    const next = context(r, { ok: true, last_head_sha: "e".repeat(40) });
    await observeCommit(next.ctx);
    expect(next.rpc).toHaveBeenCalledTimes(1);
  });

  it("believes the server when a richer carrier has this session", async () => {
    const r = repo();
    const { rpc, ctx } = context(r, { ok: true, skipped: "carrier_active", last_head_sha: SERVER_HEAD });
    expect(await observeCommit(ctx)).toBe("skipped-by-server");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("starts a new row on a new day or another branch", async () => {
    const r = repo();
    writeFileSync(
      join(r.gitDir, STATE_FILE),
      JSON.stringify({ session: "git:x:main:2026-11-21", base: SERVER_HEAD, head: HEAD, dirty: 0, startedAt: "y", widened: true }),
    );
    const { rpc, ctx } = context(r);
    await observeCommit(ctx);
    expect(rpc.mock.calls[0][1]).toMatchObject({ base_sha: PARENT, started_at: NOW.toISOString() });
  });

  it("keeps its state in the git dir and starts over from a corrupt one", async () => {
    const r = repo();
    writeFileSync(join(r.gitDir, STATE_FILE), "{ torn");
    const { ctx } = context(r);
    expect(await observeCommit(ctx)).toBe("sent");
    expect(ctx.log).toHaveBeenCalledWith("state", expect.stringMatching(/unreadable/));
    expect(existsSync(join(r.gitDir, STATE_FILE))).toBe(true);
  });

  it("does nothing outside a checkout or before the first commit", async () => {
    const outside = repo();
    outside.git.root = () => undefined;
    expect(await observeCommit(context(outside).ctx)).toBe("not-a-checkout");

    const empty = repo();
    empty.git.head = () => undefined;
    expect(await observeCommit(context(empty).ctx)).toBe("no-history");
  });
});

describe("sessionKey", () => {
  it("is one machine, one branch, one local day, and no host name in the clear", () => {
    const key = sessionKey("feat/x", NOW);
    expect(key).toMatch(/^git:[0-9a-f]{8}:feat\/x:2026-11-22$/);
    expect(sessionKey(undefined, NOW)).toMatch(/:detached:/);
  });
});
