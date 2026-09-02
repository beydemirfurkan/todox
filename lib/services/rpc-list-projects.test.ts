import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which projects a caller asking "what am I working on" is shown.
 *
 * `get_context` registers a project for whatever directory an agent is in,
 * deliberately -- it is why capturing a task works on the first try. The cost
 * is that a directory somebody opened once becomes a row, and in production 18
 * of 58 projects had never been given a task or a note.
 *
 * The failure worth guarding against is not the noise, though. It is the fix
 * being too eager: five of those projects hold standing notes and no tasks,
 * and they are precisely the ones carrying rules the briefing reads. Defining
 * "empty" as "no tasks" would have hidden them.
 */

const db = vi.hoisted(() => ({ one: vi.fn(), all: vi.fn(), run: vi.fn(), tx: vi.fn() }));

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  ...db,
}));

const usage = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("../repositories/tool-usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/tool-usage")>()),
  ...usage,
}));

const projects = vi.hoisted(() => ({ list: vi.fn() }));
const tasks = vi.hoisted(() => ({ countsByProject: vi.fn() }));
const contexts = vi.hoisted(() => ({ projectIdsWithNotes: vi.fn() }));

vi.mock("../repositories/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/projects")>()),
  ...projects,
}));
vi.mock("../repositories/tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/tasks")>()),
  ...tasks,
}));
vi.mock("../repositories/contexts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/contexts")>()),
  ...contexts,
}));

const { invoke } = await import("./rpc");

const CTX = { userId: 7 };

const project = (id: number, slug: string) => ({
  id,
  slug,
  name: slug,
  root_path: `/repo/${slug}`,
  summary: null,
  share_token: null,
});

const EMPTY_COUNTS = { todo: 0, doing: 0, blocked: 0, done: 0, dropped: 0 };

type Listed = { projects: { slug: string }[]; empty_projects_omitted: number };

const list = () => invoke(CTX, "listProjects", {}) as Promise<Listed>;

beforeEach(() => {
  vi.clearAllMocks();
  usage.record.mockResolvedValue(undefined);
  contexts.projectIdsWithNotes.mockResolvedValue(new Set<number>());
  tasks.countsByProject.mockResolvedValue({ map: new Map(), empty: EMPTY_COUNTS });
  projects.list.mockResolvedValue([]);
});

describe("what a project has to carry to be listed", () => {
  it("shows a project with tasks", async () => {
    projects.list.mockResolvedValue([project(1, "has-tasks")]);
    tasks.countsByProject.mockResolvedValue({
      map: new Map([[1, { ...EMPTY_COUNTS, todo: 2 }]]),
      empty: EMPTY_COUNTS,
    });

    const { projects: shown, empty_projects_omitted } = await list();

    expect(shown.map((p) => p.slug)).toEqual(["has-tasks"]);
    expect(empty_projects_omitted).toBe(0);
  });

  /**
   * The one this exists to protect. A project holding standing rules and no
   * tasks is not empty -- the briefing reads those rules every session.
   */
  it("shows a project that has only notes", async () => {
    projects.list.mockResolvedValue([project(2, "rules-only")]);
    contexts.projectIdsWithNotes.mockResolvedValue(new Set([2]));

    const { projects: shown, empty_projects_omitted } = await list();

    expect(shown.map((p) => p.slug)).toEqual(["rules-only"]);
    expect(empty_projects_omitted).toBe(0);
  });

  it("leaves out a project with neither", async () => {
    projects.list.mockResolvedValue([project(3, "nothing-here")]);

    const { projects: shown } = await list();

    expect(shown).toEqual([]);
  });
});

describe("saying what was left out", () => {
  it("counts the omitted rather than trimming in silence", async () => {
    projects.list.mockResolvedValue([
      project(1, "has-tasks"),
      project(2, "rules-only"),
      project(3, "nothing-here"),
      project(4, "also-nothing"),
    ]);
    tasks.countsByProject.mockResolvedValue({
      map: new Map([[1, { ...EMPTY_COUNTS, done: 1 }]]),
      empty: EMPTY_COUNTS,
    });
    contexts.projectIdsWithNotes.mockResolvedValue(new Set([2]));

    const { projects: shown, empty_projects_omitted } = await list();

    expect(shown.map((p) => p.slug)).toEqual(["has-tasks", "rules-only"]);
    expect(empty_projects_omitted).toBe(2);
  });

  it("reports zero rather than nothing when the account is empty", async () => {
    // An account with no projects at all and an account whose projects were
    // all filtered read identically without this.
    const { projects: shown, empty_projects_omitted } = await list();

    expect(shown).toEqual([]);
    expect(empty_projects_omitted).toBe(0);
  });
});
