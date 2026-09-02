import { beforeEach, describe, expect, it, vi } from "vitest";

import { createObserver, THROTTLE_MS, type ObserverGit } from "./observer";

/**
 * The automatic write path, and the only code in todox that runs without
 * anybody asking it to.
 *
 * That is what makes the failure modes here different from everywhere else.
 * It sits inside the agent's own tool calls, so an exception it lets escape
 * breaks work that has nothing to do with it; it writes to a table an agent
 * reads at every session start, so a row it writes carelessly is noise in the
 * one payload that has to stay worth reading. Those two -- never throw, and
 * stay quiet when there is nothing to say -- are what most of this file is
 * about.
 */

const ROOT = "/repo";
const HEAD_AT_START = "a".repeat(40);

/** A fake checkout whose answers the tests move around. */
function fakeGit(over: Partial<Record<string, unknown>> = {}) {
  const state = {
    head: HEAD_AT_START,
    branch: "main" as string | undefined,
    dirty: 0 as number | undefined,
    /** base -> what landed since it */
    since: new Map<string, { count: number; subjects: string[] }>(),
    ...over,
  };

  const git: ObserverGit = {
    root: vi.fn((path: string) => (path.startsWith(ROOT) ? ROOT : undefined)),
    head: vi.fn(() => state.head),
    branch: vi.fn(() => state.branch),
    dirty: vi.fn(() => state.dirty),
    since: vi.fn((_dir: string, base: string) => state.since.get(base)),
  };

  return { git, state };
}

type Call = { method: string; params: Record<string, unknown> };

function harness(over: { reply?: unknown; git?: ObserverGit; enabled?: boolean } = {}) {
  const calls: Call[] = [];
  const fake = over.git ? { git: over.git, state: null } : fakeGit();
  let clock = 1_000_000;

  const observer = createObserver({
    call: async (method, params) => {
      calls.push({ method, params });
      return over.reply ?? { ok: true, last_head_sha: null };
    },
    git: over.git ?? fake.git,
    sessionId: "session-1",
    cwd: `${ROOT}/sub`,
    client: "claude-code",
    enabled: over.enabled ?? true,
    clock: () => clock,
  });

  return {
    observer,
    calls,
    state: fake.state,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** The params of the last recordObservation that went out. */
const lastWrite = (calls: Call[]) =>
  calls.filter((c) => c.method === "recordObservation").at(-1)?.params;

beforeEach(() => vi.clearAllMocks());

describe("staying quiet", () => {
  it("writes nothing when the session has changed nothing", async () => {
    const { observer, calls } = harness();
    await observer.notice({ cwd: `${ROOT}/sub` });
    await observer.notice({ cwd: `${ROOT}/sub` });
    expect(calls).toHaveLength(0);
  });

  it("writes nothing when the switch is off", async () => {
    const h = harness({ enabled: false });
    h.state!.since.set(HEAD_AT_START, { count: 3, subjects: ["x"] });
    h.state!.head = "b".repeat(40);
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(0);
  });

  it("writes nothing when the directory is not a checkout", async () => {
    const { git } = fakeGit();
    (git.root as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const h = harness({ git });
    await h.observer.notice({ cwd: "/somewhere/else" });
    expect(h.calls).toHaveLength(0);
  });

  /**
   * A repository with no commits answers no HEAD. There is nothing to compare
   * against, so there is nothing to say -- and saying "0 commits" would put a
   * row in front of the next session that carries no information at all.
   */
  it("writes nothing when there is no HEAD to compare against", async () => {
    const { git } = fakeGit();
    (git.head as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const h = harness({ git });
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(0);
  });
});

describe("noticing work", () => {
  it("reports commits made during the session", async () => {
    const h = harness();
    h.state!.since.set(HEAD_AT_START, { count: 2, subjects: ["second", "first"] });
    h.state!.head = "b".repeat(40);

    await h.observer.notice({ cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(1);
    expect(lastWrite(h.calls)).toMatchObject({
      session_id: "session-1",
      cwd: ROOT,
      branch: "main",
      base_sha: HEAD_AT_START,
      head_sha: "b".repeat(40),
      commits: 2,
      client: "claude-code",
    });
  });

  it("reports uncommitted work even with no commits", async () => {
    const h = harness();
    h.state!.dirty = 4;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(lastWrite(h.calls)).toMatchObject({ commits: 0, files_changed: 4 });
  });

  it("carries the subject lines as one field", async () => {
    const h = harness();
    h.state!.since.set(HEAD_AT_START, { count: 2, subjects: ["second", "first"] });
    h.state!.head = "b".repeat(40);
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(lastWrite(h.calls)!.commit_subjects).toContain("second");
    expect(lastWrite(h.calls)!.commit_subjects).toContain("first");
  });
});

describe("the throttle", () => {
  /**
   * The observer runs inside the agent's tool calls, and an agent in a busy
   * stretch makes a lot of them. Without this, a write rides along with every
   * one -- on the same token bucket the agent's real work is spending.
   */
  it("does not write twice in a row for the same state", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(1);
  });

  /**
   * The assertion the throttle actually needs, and the one it did not have.
   *
   * "The same state twice" is caught by the change check on its own, so a test
   * built on it passes with the interval deleted -- which is a check nothing
   * proves. Editing files is the real shape: the dirty count moves with every
   * save, and without an interval every save that happens to land near a tool
   * call is another row and another request.
   */
  it("suppresses a changed state inside the interval", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });

    h.advance(THROTTLE_MS / 2);
    h.state!.dirty = 2;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    h.state!.dirty = 3;
    await h.observer.notice({ cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(1);
  });

  it("writes again once the interval has passed", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    h.advance(THROTTLE_MS + 1);
    h.state!.dirty = 2;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(2);
  });

  /**
   * A commit is the event worth being prompt about: it is the thing a session
   * ending badly would otherwise lose, and it is rare enough to be free.
   */
  it("ignores the interval when HEAD moves", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });

    h.state!.head = "b".repeat(40);
    h.state!.since.set(HEAD_AT_START, { count: 1, subjects: ["done"] });
    await h.observer.notice({ cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(2);
    expect(lastWrite(h.calls)).toMatchObject({ commits: 1 });
  });
});

describe("finding the project", () => {
  /**
   * Most tools carry no `cwd`: `log_entry`, `update_task` and `search` all
   * take ids and strings. So the observer takes the first path it is offered
   * and falls back to the directory the client launched this process in.
   */
  it("uses a path from whichever tool call carries one", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ task_id: 4, kind: "note", body: "x" });
    await h.observer.notice({ path: `${ROOT}/lib/thing.ts` });
    expect(lastWrite(h.calls)).toMatchObject({ cwd: ROOT });
  });

  it("falls back to the directory it was launched in", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice({ task_id: 4 });
    expect(lastWrite(h.calls)).toMatchObject({ cwd: ROOT });
  });
});

describe("work the last session never reported", () => {
  /**
   * The case this whole design is arranged around.
   *
   * A session ends when the agent stops calling tools, which is usually before
   * the developer stops working -- and always before a crash. So the commits
   * between the last report and the end are invisible, and no amount of
   * flushing on exit fixes that, because a killed process does not flush.
   *
   * Instead the server answers every write with the last HEAD it recorded for
   * this project. If that is not where this session started, the window is
   * widened backwards and the row is corrected in place.
   */
  it("widens the window back to the last HEAD the server knows", async () => {
    const older = "0".repeat(40);
    const { git, state } = fakeGit();
    state.dirty = 1;
    state.since.set(HEAD_AT_START, { count: 0, subjects: [] });
    state.since.set(older, { count: 5, subjects: ["unreported"] });

    const calls: Call[] = [];
    const observer = createObserver({
      call: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, last_head_sha: older };
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
      clock: () => 1_000_000,
    });

    await observer.notice({ cwd: `${ROOT}/sub` });

    expect(calls).toHaveLength(2);
    expect(calls[1]!.params).toMatchObject({
      session_id: "session-1",
      base_sha: older,
      commits: 5,
    });
  });

  it("corrects the row once, not on every write afterwards", async () => {
    const older = "0".repeat(40);
    const { git, state } = fakeGit();
    state.dirty = 1;
    state.since.set(HEAD_AT_START, { count: 0, subjects: [] });
    state.since.set(older, { count: 5, subjects: ["unreported"] });

    let clock = 1_000_000;
    const calls: Call[] = [];
    const observer = createObserver({
      call: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, last_head_sha: older };
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
      clock: () => clock,
    });

    await observer.notice({ cwd: `${ROOT}/sub` });
    clock += THROTTLE_MS + 1;
    state.dirty = 2;
    await observer.notice({ cwd: `${ROOT}/sub` });

    // Two for the first notice (the write and its correction), one for the
    // second. Not four.
    expect(calls).toHaveLength(3);
  });

  it("does not widen when the server is already up to date", async () => {
    const h = harness({ reply: { ok: true, last_head_sha: HEAD_AT_START } });
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(1);
  });

  /**
   * The baseline was rebased away, or it came from another machine's checkout.
   * Widening to a commit git cannot resolve would replace a true small number
   * with no number at all.
   */
  it("does not widen to a baseline git cannot resolve", async () => {
    const h = harness({ reply: { ok: true, last_head_sha: "f".repeat(40) } });
    h.state!.dirty = 1;
    await h.observer.notice({ cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(1);
  });
});

describe("never getting in the way", () => {
  /**
   * The observer is wrapped around the agent's real tool calls. Anything it
   * throws lands on work that has nothing to do with it, and the agent would
   * see a todox tool failing for a reason no message explains.
   */
  it("swallows a server that refuses the write", async () => {
    const { git, state } = fakeGit();
    state.dirty = 1;
    const observer = createObserver({
      call: async () => {
        throw new Error("500 from the server");
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
    });

    await expect(observer.notice({ cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
  });

  /**
   * The state before the migration that creates the table, which is a real
   * window on every deploy: the app is new and the schema is not.
   */
  it("swallows the table not existing yet", async () => {
    const { git, state } = fakeGit();
    state.dirty = 1;
    const observer = createObserver({
      call: async () => {
        throw new Error('relation "observations" does not exist');
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
    });

    await expect(observer.notice({ cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
  });

  it("swallows a checkout that throws while being read", async () => {
    const { git } = fakeGit();
    (git.dirty as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("the disk went away");
    });
    const h = harness({ git });
    await expect(h.observer.notice({ cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
  });

  /** One failure must not stop it trying again later. */
  it("keeps working after a failed write", async () => {
    const { git, state } = fakeGit();
    state.dirty = 1;
    let fail = true;
    const calls: Call[] = [];
    let clock = 1_000_000;
    const observer = createObserver({
      call: async (method, params) => {
        calls.push({ method, params });
        if (fail) throw new Error("nope");
        return { ok: true, last_head_sha: null };
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
      clock: () => clock,
    });

    await observer.notice({ cwd: `${ROOT}/sub` });
    fail = false;
    clock += THROTTLE_MS + 1;
    state.dirty = 2;
    await observer.notice({ cwd: `${ROOT}/sub` });

    expect(calls).toHaveLength(2);
  });
});
