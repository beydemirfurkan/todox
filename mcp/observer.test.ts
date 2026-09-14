import { beforeEach, describe, expect, it, vi } from "vitest";

import { createObserver, MAX_TASK_IDS, THROTTLE_MS, type ObserverGit } from "./observer";

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
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(calls).toHaveLength(0);
  });

  it("writes nothing when the switch is off", async () => {
    const h = harness({ enabled: false });
    h.state!.since.set(HEAD_AT_START, { count: 3, subjects: ["x"] });
    h.state!.head = "b".repeat(40);
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(0);
  });

  it("writes nothing when the directory is not a checkout", async () => {
    const { git } = fakeGit();
    (git.root as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const h = harness({ git });
    await h.observer.notice("getContext", { cwd: "/somewhere/else" });
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
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(0);
  });
});

describe("noticing work", () => {
  it("reports commits made during the session", async () => {
    const h = harness();
    h.state!.since.set(HEAD_AT_START, { count: 2, subjects: ["second", "first"] });
    h.state!.head = "b".repeat(40);

    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

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
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(lastWrite(h.calls)).toMatchObject({ commits: 0, files_changed: 4 });
  });

  it("carries the subject lines as one field", async () => {
    const h = harness();
    h.state!.since.set(HEAD_AT_START, { count: 2, subjects: ["second", "first"] });
    h.state!.head = "b".repeat(40);
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
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
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
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
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    h.advance(THROTTLE_MS / 2);
    h.state!.dirty = 2;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    h.state!.dirty = 3;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(1);
  });

  it("writes again once the interval has passed", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    h.advance(THROTTLE_MS + 1);
    h.state!.dirty = 2;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(h.calls).toHaveLength(2);
  });

  /**
   * A commit is the event worth being prompt about: it is the thing a session
   * ending badly would otherwise lose, and it is rare enough to be free.
   */
  it("ignores the interval when HEAD moves", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    h.state!.head = "b".repeat(40);
    h.state!.since.set(HEAD_AT_START, { count: 1, subjects: ["done"] });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(2);
    expect(lastWrite(h.calls)).toMatchObject({ commits: 1 });
  });
});

/**
 * What a tool call costs when nothing is happening.
 *
 * The interval gated the write and nothing else: every call still spawned
 * git four times -- HEAD, status, rev-list, log -- synchronously, on the
 * tool's own return path, and then the interval said no. A session that
 * changes nothing is most of a session. The reads themselves are what these
 * count, not the writes.
 */
describe("what a look costs", () => {
  const reads = (git: ObserverGit) => ({
    head: (git.head as ReturnType<typeof vi.fn>).mock.calls.length,
    dirty: (git.dirty as ReturnType<typeof vi.fn>).mock.calls.length,
    since: (git.since as ReturnType<typeof vi.fn>).mock.calls.length,
  });

  it("reads only HEAD inside the interval", async () => {
    const { git, state } = fakeGit();
    const h = harness({ git });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    const first = reads(git);
    expect(first.dirty).toBe(1);
    expect(first.since).toBe(1);

    h.advance(1_000);
    state.dirty = 3;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    const after = reads(git);
    expect(after.head).toBe(first.head + 2);
    expect(after.dirty).toBe(first.dirty);
    expect(after.since).toBe(first.since);
  });

  it("looks again once the interval has passed, and writes what it finds", async () => {
    const { git, state } = fakeGit();
    const h = harness({ git });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    h.advance(THROTTLE_MS + 1);
    state.dirty = 3;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(reads(git).dirty).toBe(2);
    expect(lastWrite(h.calls)).toMatchObject({ files_changed: 3 });
  });

  it("looks at once when HEAD moves inside the interval", async () => {
    const { git, state } = fakeGit();
    const h = harness({ git });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    h.advance(1_000);
    state.head = "b".repeat(40);
    state.since.set(HEAD_AT_START, { count: 1, subjects: ["done"] });
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
    expect(reads(git).since).toBe(2);
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
    await h.observer.notice("getContext", { task_id: 4, kind: "note", body: "x" });
    await h.observer.notice("getContext", { path: `${ROOT}/lib/thing.ts` });
    expect(lastWrite(h.calls)).toMatchObject({ cwd: ROOT });
  });

  it("falls back to the directory it was launched in", async () => {
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice("getContext", { task_id: 4 });
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

    await observer.notice("getContext", { cwd: `${ROOT}/sub` });

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

    await observer.notice("getContext", { cwd: `${ROOT}/sub` });
    clock += THROTTLE_MS + 1;
    state.dirty = 2;
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });

    // Two for the first notice (the write and its correction), one for the
    // second. Not four.
    expect(calls).toHaveLength(3);
  });

  it("does not widen when the server is already up to date", async () => {
    const h = harness({ reply: { ok: true, last_head_sha: HEAD_AT_START } });
    h.state!.dirty = 1;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
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
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });
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

    await expect(observer.notice("getContext", { cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
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

    await expect(observer.notice("getContext", { cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
  });

  it("swallows a checkout that throws while being read", async () => {
    const { git } = fakeGit();
    (git.dirty as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("the disk went away");
    });
    const h = harness({ git });
    await expect(h.observer.notice("getContext", { cwd: `${ROOT}/sub` })).resolves.toBeUndefined();
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

    await observer.notice("getContext", { cwd: `${ROOT}/sub` });
    fail = false;
    clock += THROTTLE_MS + 1;
    state.dirty = 2;
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(calls).toHaveLength(2);
  });
});

/**
 * The agent calls tools in parallel, and `mcp/server.ts` fires `notice` after
 * every one of them without awaiting it. So two of these bodies running at
 * once is the normal case rather than the exotic one.
 *
 * It matters because every decision in `observe` reads state the *previous*
 * write was supposed to have set, and none of it is set until that write comes
 * back. Two calls that overlap therefore both believe they are the first.
 */
describe("tool calls that arrive together", () => {
  it("writes once when two notices land at the same moment", async () => {
    const h = harness();
    h.state!.dirty = 1;

    await Promise.all([
      h.observer.notice("getContext", { cwd: `${ROOT}/sub` }),
      h.observer.notice("getContext", { cwd: `${ROOT}/sub` }),
    ]);

    expect(h.calls).toHaveLength(1);
  });

  /**
   * Only one waiter is kept. A third notice arriving while one is already
   * lined up would write the row the waiter is about to write.
   */
  it("coalesces the ones behind the first rather than queueing them", async () => {
    const h = harness();
    h.state!.dirty = 1;

    await Promise.all([
      h.observer.notice("getContext", { cwd: `${ROOT}/sub` }),
      h.observer.notice("getContext", { cwd: `${ROOT}/sub` }),
      h.observer.notice("getContext", { cwd: `${ROOT}/sub` }),
    ]);

    expect(h.calls).toHaveLength(1);
  });

  /**
   * The one that loses data rather than just spending it twice.
   *
   * The first notice reads the server's older baseline, widens the window and
   * rewrites the row. A second notice running alongside it computed its window
   * before any of that, so its write puts the narrow one back -- and `widened`
   * is already true, so nothing tries again. What is overwritten is exactly
   * the work a killed session never reported.
   */
  it("does not let a second notice undo the correction the first is making", async () => {
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

    await Promise.all([
      observer.notice("getContext", { cwd: `${ROOT}/sub` }),
      observer.notice("getContext", { cwd: `${ROOT}/sub` }),
    ]);

    // The write and its correction, and nothing after them.
    expect(calls).toHaveLength(2);
    expect(lastWrite(calls)).toMatchObject({ base_sha: older, commits: 5 });
  });

  it("is still fire-and-forget when notices overlap", async () => {
    const { git, state } = fakeGit();
    state.dirty = 1;
    const observer = createObserver({
      call: async () => {
        throw new Error("nope");
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
    });

    await expect(
      Promise.all([
        observer.notice("getContext", { cwd: `${ROOT}/sub` }),
        observer.notice("getContext", { cwd: `${ROOT}/sub` }),
      ]),
    ).resolves.toBeDefined();
  });
});

/**
 * The one thing the observer notices that is not git: a task taken on.
 *
 * `updateTask` to 'doing' is the call that says which task a session is
 * about, and the row it writes is the pairing the briefing could not make
 * before -- this branch, these commits, that task, and no handoff. It counts
 * as a change of its own, so a session that takes a task and touches nothing
 * on disk still leaves a row; and it is exempt from the interval, like a
 * commit, because it is the event a dying session would otherwise lose.
 */
describe("noticing a task taken on", () => {
  const doing = (task_id: unknown) => ({ task_id, status: "doing", model: "m" });

  it("writes a row for a session that took a task and changed nothing on disk", async () => {
    const { observer, calls } = harness();
    await observer.notice("updateTask", doing(12));

    expect(lastWrite(calls)).toMatchObject({ commits: 0, files_changed: 0, task_ids: [12] });
  });

  it("does not count a status other than 'doing', or a different tool", async () => {
    const { observer, calls } = harness();
    await observer.notice("updateTask", { task_id: 12, status: "done", model: "m" });
    await observer.notice("logEntry", { task_id: 12, kind: "handoff", body: "x" });
    await observer.notice("createTask", { title: "t", status: "doing", cwd: `${ROOT}/sub` });

    expect(calls).toHaveLength(0);
  });

  it("refuses an id that is not a positive integer", async () => {
    const { observer, calls } = harness();
    for (const id of ["12", 1.5, 0, -3, null, undefined])
      await observer.notice("updateTask", doing(id));

    expect(calls).toHaveLength(0);
  });

  it("leaves the key out entirely when no task was taken on", async () => {
    // Strict schemas on a server that predates the field would refuse the
    // whole call; an absent key is what keeps an older self-host working.
    const h = harness();
    h.state!.dirty = 1;
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(lastWrite(h.calls)).toBeDefined();
    expect(lastWrite(h.calls)).not.toHaveProperty("task_ids");
  });

  it("writes again for a second task inside the interval, and once for the same one", async () => {
    const { observer, calls } = harness();
    await observer.notice("updateTask", doing(12));
    await observer.notice("updateTask", doing(12));
    expect(calls).toHaveLength(1);

    await observer.notice("updateTask", doing(13));
    expect(calls).toHaveLength(2);
    expect(lastWrite(calls)).toMatchObject({ task_ids: [12, 13] });
  });

  it("sends the whole list every time, so no write can narrow it", async () => {
    const h = harness();
    await h.observer.notice("updateTask", doing(12));
    h.state!.dirty = 3;
    h.advance(THROTTLE_MS + 1);
    await h.observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(h.calls).toHaveLength(2);
    expect(lastWrite(h.calls)).toMatchObject({ files_changed: 3, task_ids: [12] });
  });

  it("stops at the cap the schema enforces", async () => {
    const { observer, calls } = harness();
    for (let id = 1; id <= MAX_TASK_IDS + 5; id++) await observer.notice("updateTask", doing(id));

    const sent = lastWrite(calls)?.task_ids as number[];
    expect(sent).toHaveLength(MAX_TASK_IDS);
    expect(sent.at(-1)).toBe(MAX_TASK_IDS);
  });

  it("tries once when the server refuses, then falls back to the interval", async () => {
    // An older self-hosted server refuses the strict schema; the observer
    // swallows that. What must not happen is every later call retrying.
    const { git } = fakeGit();
    let attempts = 0;
    const observer = createObserver({
      call: async () => {
        attempts++;
        throw new Error("unrecognized key task_ids");
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
    });

    await observer.notice("updateTask", doing(12));
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });
    await observer.notice("getContext", { cwd: `${ROOT}/sub` });

    expect(attempts).toBe(1);
  });

  it("carries the list on the widened write too", async () => {
    const older = "0".repeat(40);
    const { git, state } = fakeGit();
    state.since.set(HEAD_AT_START, { count: 0, subjects: [] });
    state.since.set(older, { count: 5, subjects: ["a", "b"] });
    const calls: Call[] = [];
    const observer = createObserver({
      call: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, last_head_sha: older };
      },
      git,
      sessionId: "session-1",
      cwd: `${ROOT}/sub`,
    });

    await observer.notice("updateTask", doing(12));

    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.params).toMatchObject({ task_ids: [12] });
  });
});
