import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The payload every session opens with.
 *
 * `get_context` is the one call the instructions tell every agent to make
 * first, so what this returns is the product working or not working. It has no
 * test, and its failures are all quiet ones: a briefing that silently drops the
 * fiftieth task, a dead end that never reaches the reader, a handoff picked
 * from the wrong end of the log. None of them errors. The session simply starts
 * knowing less than it should and nobody can tell.
 */
const mocks = vi.hoisted(() => ({
  listByProject: vi.fn(),
  listContexts: vi.fn(),
  listByTasks: vi.fn(),
  listRefs: vi.fn(),
  freshness: vi.fn(() => "fresh"),
}));

vi.mock("../repositories/tasks", () => ({ listByProject: mocks.listByProject }));
vi.mock("../repositories/contexts", () => ({ listByProject: mocks.listContexts }));
vi.mock("../repositories/entries", () => ({ listByTasks: mocks.listByTasks }));
vi.mock("../repositories/refs", () => ({
  listByTasks: mocks.listRefs,
  freshness: mocks.freshness,
}));

const { briefing } = await import("./briefing");

/** Cast where it is used, not here: the tests read `PROJECT.id`. */
const PROJECT = {
  id: 1,
  slug: "todox",
  name: "todox",
  root_path: "/repo",
  summary: "s",
};

const brief = (userId = 7) => briefing(userId, PROJECT as never);

const task = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `task ${id}`,
  status: "doing",
  priority: 2,
  body: "b",
  updated_at: "2026-08-16T00:00:00Z",
  ...over,
});

const entry = (kind: string, body: string) => ({ id: 1, kind, body });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listByProject.mockResolvedValue([task(1)]);
  mocks.listContexts.mockResolvedValue([]);
  mocks.listByTasks.mockResolvedValue(new Map());
  mocks.listRefs.mockResolvedValue(new Map());
  mocks.freshness.mockReturnValue("fresh");
});

describe("what the briefing costs", () => {
  it("asks for the open tasks only", async () => {
    // Closed work is history; the briefing is about what is in flight.
    await brief();
    expect(mocks.listByProject).toHaveBeenCalledWith(PROJECT.id, "open");
  });

  it("loads every task's log in one query, not one per task", async () => {
    // A round trip per task is the shape this was written to avoid, on the
    // call every session makes first.
    mocks.listByProject.mockResolvedValue([task(1), task(2), task(3)]);
    await brief();
    expect(mocks.listByTasks).toHaveBeenCalledTimes(1);
    expect(mocks.listByTasks).toHaveBeenCalledWith([1, 2, 3]);
    expect(mocks.listRefs).toHaveBeenCalledTimes(1);
  });
});

describe("the ceiling on open tasks", () => {
  const many = Array.from({ length: 60 }, (_, i) => task(i + 1));

  it("carries at most fifty", async () => {
    // A project that has drifted would otherwise spend an agent's context on
    // the backlog before it read a line of code.
    mocks.listByProject.mockResolvedValue(many);
    const out = await brief();
    expect(out.open_tasks).toHaveLength(50);
  });

  it("says how many it left out rather than trimming in silence", async () => {
    mocks.listByProject.mockResolvedValue(many);
    const out = await brief();
    expect(out.open_tasks_omitted).toBe(10);
  });

  it("reports nothing omitted when nothing was", async () => {
    const out = await brief();
    expect(out.open_tasks_omitted).toBe(0);
  });

  it("does not fetch logs for the tasks it dropped", async () => {
    mocks.listByProject.mockResolvedValue(many);
    await brief();
    expect(mocks.listByTasks.mock.calls[0]![0]).toHaveLength(50);
  });
});

describe("what each task carries", () => {
  const log = [
    entry("handoff", "first handoff"),
    entry("decision", "chose the CTE"),
    entry("dead_end", "the cron did not work"),
    entry("question", "which timezone?"),
    entry("note", "chatter"),
    entry("handoff", "latest handoff"),
  ];

  beforeEach(() => {
    mocks.listByTasks.mockResolvedValue(new Map([[1, log]]));
  });

  it("takes the last handoff, not the first", async () => {
    // The log grows forwards; the useful end is the new one. Reading from the
    // front hands the next session the state before the work happened.
    const out = await brief();
    expect(out.open_tasks[0]!.last_handoff).toBe("latest handoff");
  });

  it("carries every dead end", async () => {
    // The highest-value entry there is: it is what stops the repeat.
    const out = await brief();
    expect(out.open_tasks[0]!.dead_ends).toEqual(["the cron did not work"]);
  });

  it("carries the decisions and the open questions apart", async () => {
    const out = await brief();
    expect(out.open_tasks[0]!.decisions).toEqual(["chose the CTE"]);
    expect(out.open_tasks[0]!.open_questions).toEqual(["which timezone?"]);
  });

  it("counts the whole log, including what it did not quote", async () => {
    const out = await brief();
    expect(out.open_tasks[0]!.entry_count).toBe(log.length);
  });

  it("says there is no handoff rather than inventing one", async () => {
    mocks.listByTasks.mockResolvedValue(new Map());
    const out = await brief();
    expect(out.open_tasks[0]!.last_handoff).toBeNull();
  });
});

describe("linked files", () => {
  const ref = { id: 4, path: "/repo/a.ts", note: null, hash: "abc", checked_at: "t" };

  beforeEach(() => {
    mocks.listRefs.mockResolvedValue(new Map([[1, [ref]]]));
  });

  it("hands out the id and hash, so the agent can check the file itself", async () => {
    // This process has no copy of the repository. Without these the agent
    // cannot report back and the status can never move off "unknown".
    const out = await brief();
    expect(out.open_tasks[0]!.files[0]).toMatchObject({ id: 4, hash: "abc" });
  });

  it("raises a stale line for a file that changed", async () => {
    mocks.freshness.mockReturnValue("changed");
    const out = await brief();
    expect(out.stale_refs).toHaveLength(1);
    expect(out.stale_refs[0]).toContain("/repo/a.ts");
  });

  it("raises one for a file that is gone", async () => {
    mocks.freshness.mockReturnValue("missing");
    const out = await brief();
    expect(out.stale_refs[0]).toContain("missing");
  });

  it("stays quiet for a file nobody has checked", async () => {
    // "Not checked" is not "changed". Saying so would train a reader to
    // ignore the warning that matters.
    mocks.freshness.mockReturnValue("unknown");
    const out = await brief();
    expect(out.stale_refs).toEqual([]);
  });
});

describe("context notes", () => {
  it("asks for the account-wide ones and the project's separately", async () => {
    await brief();
    expect(mocks.listContexts).toHaveBeenCalledWith(7, null);
    expect(mocks.listContexts).toHaveBeenCalledWith(7, PROJECT.id);
  });

  it("hands back only the four fields a reader needs", async () => {
    // The row carries timestamps and a user id; a briefing is spent context
    // and none of that is worth any of it.
    mocks.listContexts.mockResolvedValue([
      { id: 1, kind: "gotcha", title: "t", body: "b", user_id: 7, created_at: "x" },
    ]);
    const out = await brief();
    expect(Object.keys(out.global_context[0]!).sort()).toEqual(["body", "id", "kind", "title"]);
  });
});

describe("the closing hint", () => {
  it("asks for a handoff and for the dead ends by name", async () => {
    // The one instruction that decides whether the next briefing is worth
    // anything, so it travels with every one of them.
    const out = await brief();
    expect(out.hint).toContain("handoff");
    expect(out.hint).toContain("dead ends");
  });
});
