import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The full briefing is fitted under a ceiling and the digest is not: a digest
 * rendered from a fitted briefing would lose the tasks the larger ceiling
 * condensed, and the records under them, without counting them as left out.
 * The opening is what the agent's tool asks for, and is only given when there
 * is something to choose by.
 */
const db = vi.hoisted(() => ({ one: vi.fn(), all: vi.fn(), run: vi.fn(), tx: vi.fn() }));
const mocks = vi.hoisted(() => ({ briefing: vi.fn(), search: vi.fn() }));

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  ...db,
}));
vi.mock("./briefing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./briefing")>()),
  briefing: mocks.briefing,
}));
vi.mock("./search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./search")>()),
  search: mocks.search,
}));
vi.mock("./project-resolver", () => ({
  mustResolve: vi.fn(async () => ({ id: 42, slug: "repo", name: "repo", user_id: 9 })),
  resolve: vi.fn(),
  resolveOrCreate: vi.fn(),
  noMatch: vi.fn(),
}));

const { invoke } = await import("./rpc");
const { BRIEFING_MAX_CHARS } = await import("./briefing-ceiling");

const task = (id: number) => ({
  id,
  title: `task ${id}`,
  status: "todo",
  priority: 2,
  updated_at: "2026-11-20T00:00:00Z",
  head: "h".repeat(200),
  body: null,
  last_handoff: null,
  decisions: Array.from({ length: 6 }, (_, i) => ({
    id: id * 10 + i,
    created_at: "2026-11-20T00:00:00Z",
    head: "d".repeat(200),
    body: null,
  })),
  dead_ends: [],
  open_questions: [],
  files: [],
  entry_count: 6,
});

const CROWDED = {
  project: { slug: "repo", name: "repo", root_path: "/repo", summary: "A repository." },
  developer: [],
  global_context: [],
  project_context: [],
  context_omitted: 0,
  open_tasks: Array.from({ length: 40 }, (_, i) => task(i + 1)),
  idle_tasks: [],
  open_tasks_omitted: 0,
  observations: [],
  stale_refs: [],
  log_bodies_omitted: 240,
  task_bodies_omitted: 40,
  hint: "",
};

const getContext = (params: Record<string, unknown> = {}) =>
  invoke({ userId: 9 }, "getContext", { project: "repo", ...params }) as Promise<Record<string, unknown>>;

beforeEach(() => {
  mocks.briefing.mockResolvedValue(CROWDED);
  mocks.search.mockResolvedValue([]);
  db.all.mockResolvedValue([]);
  db.run.mockResolvedValue(0);
});

describe("getContext's two shapes", () => {
  it("fits the full briefing under the ceiling", async () => {
    const full = await getContext();
    expect(JSON.stringify(CROWDED).length).toBeGreaterThan(BRIEFING_MAX_CHARS);
    const sent = JSON.stringify(full).replaceAll(/"\w+":\[\],?/g, "");
    expect(sent.length).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(full.condensed_tasks).not.toEqual([]);
  });

  const note = (over: object) => ({
    id: 5,
    kind: "gotcha",
    title: "Lock the table",
    body: "because it deadlocks",
    created_at: "2026-11-24T00:00:00Z",
    updated_at: "2026-11-24T00:00:00Z",
    ...over,
  });
  const withNote = (over: object) =>
    mocks.briefing.mockResolvedValue({ ...CROWDED, project_context: [note(over)] });

  it("gives the opening to a session whose focus reached a note", async () => {
    withNote({ matched: true });
    const { opening, files, stale_refs } = await getContext({ shape: "opening", focus: "lock the table" });
    expect(opening).toContain("because it deadlocks");
    expect(String(opening).length).toBeLessThanOrEqual(8_000);
    expect(files).toEqual([]);
    expect(stale_refs).toEqual([]);
  });

  it.each([
    ["the focus reached nothing", { matched: false }, { shape: "opening", focus: "xylophone" }],
    ["there was no focus", {}, { shape: "opening" }],
    ["everything was asked for", { matched: true, relevance: 0.3 }, { shape: "full", focus: "lock the table" }],
    ["an older client named no shape", { matched: true }, { focus: "lock the table" }],
  ])("gives everything when %s, without the opening's flag", async (_when, over, params) => {
    withNote(over);
    const full = await getContext(params);
    expect(full).not.toHaveProperty("opening");
    expect(full.open_tasks).not.toEqual([]);
    expect((full.project_context as object[])[0]).not.toHaveProperty("matched");
    expect((full.project_context as object[])[0]).not.toHaveProperty("relevance");
  });

  it("keeps a session's linked files to be hashed though it is not shown them", async () => {
    const files = [{ id: 7, path: "/repo/a.ts", hash: null }];
    mocks.briefing.mockResolvedValue({
      ...CROWDED,
      open_tasks: [{ ...task(1), files }],
      project_context: [note({ matched: true })],
    });
    const answer = await getContext({ shape: "opening", focus: "lock" });
    expect(answer.files).toEqual(files);
    expect(answer.opening).not.toContain("/repo/a.ts");
  });

  it("renders the digest from everything open, not from what the ceiling left", async () => {
    const { digest } = await getContext({ shape: "digest", max_chars: 40_000 });
    for (const t of CROWDED.open_tasks) expect(digest).toContain(`#${t.id} [todo] task ${t.id}`);
    // A record of a task the full shape carries as a line, without its log.
    const full = await getContext();
    expect((full.condensed_tasks as { id: number }[]).map((t) => t.id)).toContain(25);
    expect(digest).toContain("(entry 250,");
  });
});
