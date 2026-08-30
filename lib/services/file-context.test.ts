import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The answer to "what do we already know about this file?".
 *
 * Two things here are worth a test rather than a read. The path is folded to
 * its repo-relative form and expanded back over every root the project is
 * known by, which is the only reason a note linked on one machine is found
 * from another — get that wrong and the feature silently answers "nothing" on
 * the second computer, which is indistinguishable from there being nothing.
 * And the refs come back matched on path alone, unscoped by account, so the
 * filter applied here is the only thing between a path and somebody else's
 * work.
 */
const mocks = vi.hoisted(() => ({
  listPaths: vi.fn(),
  listFor: vi.fn(),
  taskByIds: vi.fn(),
  contextByIds: vi.fn(),
  perKind: vi.fn(),
}));

vi.mock("../repositories/refs", () => ({ listByPaths: mocks.listPaths }));
vi.mock("../repositories/project-paths", () => ({ listFor: mocks.listFor }));
vi.mock("../repositories/tasks", () => ({ byIds: mocks.taskByIds }));
vi.mock("../repositories/contexts", () => ({ byIds: mocks.contextByIds }));
vi.mock("../repositories/entries", () => ({ listByTasksPerKind: mocks.perKind }));

const { fileContext } = await import("./file-context");

const PROJECT = { id: 1, slug: "todox", name: "todox", root_path: "/repo" };
const ask = (path: string, userId = 7) => fileContext(userId, PROJECT as never, path);

const ref = (over: Record<string, unknown> = {}) => ({
  id: 1,
  task_id: null,
  context_id: null,
  path: "/repo/lib/auth.ts",
  note: null,
  hash: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listFor.mockResolvedValue([]);
  mocks.listPaths.mockResolvedValue([]);
  mocks.taskByIds.mockResolvedValue([]);
  mocks.contextByIds.mockResolvedValue([]);
  mocks.perKind.mockResolvedValue(new Map());
});

describe("which paths it looks for", () => {
  it("expands a relative path across every root the project is known by", async () => {
    mocks.listFor.mockResolvedValue([{ path: "C:/work/todox" }, { path: "/srv/todox" }]);
    await ask("lib/auth.ts");
    expect(mocks.listPaths.mock.calls[0][0].sort()).toEqual(
      ["/repo/lib/auth.ts", "/srv/todox/lib/auth.ts", "C:/work/todox/lib/auth.ts"].sort(),
    );
  });

  it("folds an absolute path down before expanding it again", async () => {
    // The point of the whole exercise: a path from this machine finds a ref
    // linked from another one.
    mocks.listFor.mockResolvedValue([{ path: "C:/work/todox" }]);
    await ask("/repo/lib/auth.ts");
    expect(mocks.listPaths.mock.calls[0][0]).toContain("C:/work/todox/lib/auth.ts");
  });

  it("reports the repo-relative path, not the one it was handed", async () => {
    expect((await ask("/repo/lib/auth.ts")).path).toBe("lib/auth.ts");
  });

  it("still looks for the literal when the path is outside every known root", async () => {
    // Honest rather than empty: it cannot be folded, but the machine that
    // linked it stored exactly this string.
    await ask("/elsewhere/x.ts");
    expect(mocks.listPaths.mock.calls[0][0]).toEqual(["/elsewhere/x.ts"]);
  });

  it("keeps the caller's own path in the set", async () => {
    // A project can be open at a path `project_paths` has not learned yet, and
    // dropping it would answer "nothing known" about a file linked minutes ago.
    mocks.listFor.mockResolvedValue([{ path: "/srv/todox" }]);
    await ask("/srv/todox/lib/auth.ts");
    expect(mocks.listPaths.mock.calls[0][0]).toContain("/srv/todox/lib/auth.ts");
  });

  it("asks once, whatever the roots", async () => {
    mocks.listFor.mockResolvedValue([{ path: "/a" }, { path: "/b" }, { path: "/c" }]);
    await ask("lib/auth.ts");
    expect(mocks.listPaths).toHaveBeenCalledTimes(1);
  });
});

describe("what it hands back", () => {
  it("carries the dead ends of a task that touched the file", async () => {
    mocks.listPaths.mockResolvedValue([ref({ task_id: 4, note: "the hot path" })]);
    mocks.taskByIds.mockResolvedValue([
      { id: 4, project_id: 1, title: "auth", status: "done", priority: 1 },
    ]);
    mocks.perKind.mockResolvedValue(
      new Map([[4, [{ kind: "dead_end", body: "bcrypt was too slow" }]]]),
    );

    const out = await ask("lib/auth.ts");
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({ id: 4, note: "the hot path" });
    expect(out.tasks[0].dead_ends).toEqual(["bcrypt was too slow"]);
  });

  it("asks for dead ends and decisions, and nothing else", async () => {
    mocks.listPaths.mockResolvedValue([ref({ task_id: 4 })]);
    mocks.taskByIds.mockResolvedValue([{ id: 4, project_id: 1, title: "t", status: "todo", priority: 2 }]);
    await ask("lib/auth.ts");
    expect(mocks.perKind.mock.calls[0][1]).toEqual(["dead_end", "decision"]);
  });

  it("carries a context note's whole body", async () => {
    // Unlike the briefing's ceiling: one file's standing rules are few, and
    // the agent asked about this file in particular.
    mocks.listPaths.mockResolvedValue([ref({ context_id: 9 })]);
    mocks.contextByIds.mockResolvedValue([
      { id: 9, project_id: 1, user_id: 7, kind: "convention", title: "hashing", body: "scrypt, and why" },
    ]);
    expect((await ask("lib/auth.ts")).notes[0]).toMatchObject({ id: 9, body: "scrypt, and why" });
  });

  it("lists a task once even when several roots matched the same file", async () => {
    mocks.listPaths.mockResolvedValue([
      ref({ id: 1, task_id: 4, path: "/repo/lib/auth.ts" }),
      ref({ id: 2, task_id: 4, path: "C:/work/todox/lib/auth.ts" }),
    ]);
    mocks.taskByIds.mockResolvedValue([{ id: 4, project_id: 1, title: "t", status: "todo", priority: 2 }]);
    expect((await ask("lib/auth.ts")).tasks).toHaveLength(1);
  });

  it("asks for nothing when no ref matched", async () => {
    await ask("lib/auth.ts");
    expect(mocks.taskByIds).toHaveBeenCalledWith([]);
    expect(mocks.perKind).toHaveBeenCalledWith([], expect.anything(), expect.anything());
  });
});

/**
 * `listByPaths` matches on the path and nothing else — it cannot scope by
 * account, because `refs` has no column that would let it. Every assertion
 * below is about the filter that stands in for that.
 */
describe("what it refuses to hand back", () => {
  it("drops a task belonging to another project", async () => {
    mocks.listPaths.mockResolvedValue([ref({ task_id: 4 })]);
    mocks.taskByIds.mockResolvedValue([
      { id: 4, project_id: 99, title: "somebody else's", status: "todo", priority: 2 },
    ]);
    expect((await ask("lib/auth.ts")).tasks).toEqual([]);
  });

  it("drops a note belonging to another project", async () => {
    mocks.listPaths.mockResolvedValue([ref({ context_id: 9 })]);
    mocks.contextByIds.mockResolvedValue([
      { id: 9, project_id: 99, user_id: 7, kind: "gotcha", title: "t", body: "b" },
    ]);
    expect((await ask("lib/auth.ts")).notes).toEqual([]);
  });

  it("keeps an account-wide note of this user's own", async () => {
    mocks.listPaths.mockResolvedValue([ref({ context_id: 9 })]);
    mocks.contextByIds.mockResolvedValue([
      { id: 9, project_id: null, user_id: 7, kind: "preference", title: "t", body: "b" },
    ]);
    expect((await ask("lib/auth.ts")).notes).toHaveLength(1);
  });

  it("drops an account-wide note belonging to somebody else", async () => {
    // The one that would leak: `project_id` is null for both, so only the
    // owner's id separates them.
    mocks.listPaths.mockResolvedValue([ref({ context_id: 9 })]);
    mocks.contextByIds.mockResolvedValue([
      { id: 9, project_id: null, user_id: 8, kind: "preference", title: "t", body: "b" },
    ]);
    expect((await ask("lib/auth.ts")).notes).toEqual([]);
  });
});
