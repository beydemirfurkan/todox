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
  pageByProject: vi.fn(),
  pageNotes: vi.fn(),
  pageByTasksPerKind: vi.fn(),
  countsByTasks: vi.fn(),
  listRefs: vi.fn(),
  freshness: vi.fn(() => "fresh"),
  pageObservations: vi.fn(),
}));

vi.mock("../repositories/tasks", () => ({ pageByProject: mocks.pageByProject }));
vi.mock("../repositories/contexts", () => ({ pageByProject: mocks.pageNotes }));
vi.mock("../repositories/entries", () => ({
  pageByTasksPerKind: mocks.pageByTasksPerKind,
  countsByTasks: mocks.countsByTasks,
}));
vi.mock("../repositories/refs", () => ({
  listByTasks: mocks.listRefs,
  freshness: mocks.freshness,
}));
vi.mock("../repositories/observations", () => ({ pageByProject: mocks.pageObservations }));

const { briefing } = await import("./briefing");

/** Cast where it is used, not here: the tests read `PROJECT.id`. */
const PROJECT = {
  id: 1,
  slug: "todox",
  name: "todox",
  root_path: "/repo",
  summary: "s",
};

const brief = (userId = 7, focus?: string) => briefing(userId, PROJECT as never, focus);

const task = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `task ${id}`,
  status: "doing",
  priority: 2,
  body: "b",
  updated_at: "2026-08-16T00:00:00Z",
  ...over,
});

/**
 * What `pageByTasksPerKind` answers. `head` is separate from `body` because the
 * briefing may carry one without the other, and a factory that derived the head
 * from the body could not express the case that matters -- a record carried
 * with its head and no body at all.
 */
const entry = (kind: string, body: string | null, over: Record<string, unknown> = {}) => ({
  id: 1,
  kind,
  created_at: "2026-08-16T00:00:00Z",
  head: (body ?? "").split("\n")[0],
  body,
  ...over,
});

/** What `countsByTasks` answers: the real totals, whatever the log above shows. */
const counts = (over: Partial<Record<string, number>> = {}) =>
  new Map([
    [1, { total: 0, decisions: 0, dead_ends: 0, questions: 0, ...over }],
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pageByProject.mockResolvedValue({ rows: [task(1)], total: 1 });
  mocks.pageNotes.mockResolvedValue({ rows: [], omitted: 0 });
  mocks.pageByTasksPerKind.mockResolvedValue(new Map());
  mocks.countsByTasks.mockResolvedValue(counts());
  mocks.listRefs.mockResolvedValue(new Map());
  mocks.freshness.mockReturnValue("fresh");
  mocks.pageObservations.mockResolvedValue({ rows: [], omitted: 0 });
});

describe("what the briefing costs", () => {
  it("asks for the open tasks only, and asks for fifty of them", async () => {
    // Closed work is history; the briefing is about what is in flight. The
    // ceiling goes to the database rather than being applied to the answer:
    // reading a project's whole backlog to show fifty rows is the first query
    // of every session.
    await brief();
    expect(mocks.pageByProject).toHaveBeenCalledWith(PROJECT.id, "open", 50);
  });

  it("loads every task's log in one query, not one per task", async () => {
    // A round trip per task is the shape this was written to avoid, on the
    // call every session makes first.
    mocks.pageByProject.mockResolvedValue({ rows: [task(1), task(2), task(3)], total: 3 });
    await brief();
    expect(mocks.pageByTasksPerKind).toHaveBeenCalledTimes(1);
    expect(mocks.pageByTasksPerKind.mock.calls[0]![0]).toEqual([1, 2, 3]);
    expect(mocks.countsByTasks).toHaveBeenCalledTimes(1);
    expect(mocks.listRefs).toHaveBeenCalledTimes(1);
  });

  it("caps the log per kind, so a long log cannot uncap a capped task list", async () => {
    // The tasks were cut in SQL and the log under them was not, so fifty tasks
    // still answered with every entry ever written on any of them.
    await brief();
    const [, kinds, perKind] = mocks.pageByTasksPerKind.mock.calls[0]!;
    expect(perKind).toEqual({ handoff: 1, decision: 3, dead_end: 3, question: 3 });
    expect(kinds).toEqual(["handoff", "decision", "dead_end", "question"]);
  });

  it("asks for one handoff, because one handoff is what it shows", async () => {
    // Not a tidy-up. `openTasks` reads the newest handoff and nothing else, so
    // the other two were fetched on the first query of every session and
    // dropped -- 28 KB of a 143 KB payload on the widest project measured, and
    // uncounted, because `log_omitted` deliberately does not count handoffs.
    //
    // Asserted as "whatever the briefing asks for, it is the number it renders"
    // rather than as the literal 1, so raising it later fails here instead of
    // quietly going back to paying for rows nobody reads.
    await brief();
    const [, , perKind] = mocks.pageByTasksPerKind.mock.calls[0]!;
    expect((perKind as Record<string, number>).handoff).toBe(1);
  });

  it("never asks for notes, because nothing reads one", async () => {
    // They were carried across the network so that `.length` could count them.
    await brief();
    expect(mocks.pageByTasksPerKind.mock.calls[0]![1]).not.toContain("note");
  });
});

describe("the ceiling on open tasks", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => task(i + 1));

  it("asks the database for the ceiling", async () => {
    // A project that has drifted would otherwise spend an agent's context on
    // the backlog before it read a line of code.
    await brief();
    expect(mocks.pageByProject.mock.calls[0]![2]).toBe(50);
  });

  it("says how many it left out rather than trimming in silence", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: fifty, total: 60 });
    const out = await brief();
    expect(out.open_tasks_omitted).toBe(10);
  });

  it("reports nothing omitted when nothing was", async () => {
    const out = await brief();
    expect(out.open_tasks_omitted).toBe(0);
  });

  it("fetches logs only for the tasks it is going to show", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: fifty, total: 60 });
    await brief();
    expect(mocks.pageByTasksPerKind.mock.calls[0]![0]).toHaveLength(50);
  });
});

describe("what each task carries", () => {
  // No note in here: the repository filters kinds, so this is what it answers.
  const log = [
    entry("handoff", "first handoff"),
    entry("decision", "chose the CTE"),
    entry("dead_end", "the cron did not work"),
    entry("question", "which timezone?"),
    entry("handoff", "latest handoff"),
  ];

  beforeEach(() => {
    mocks.pageByTasksPerKind.mockResolvedValue(new Map([[1, log]]));
    // Six in the table, five shown: one of them is a note nobody asked for.
    mocks.countsByTasks.mockResolvedValue(
      counts({ total: 6, decisions: 1, dead_ends: 1, questions: 1 }),
    );
  });

  it("takes the last handoff, not the first", async () => {
    // The log grows forwards; the useful end is the new one. Reading from the
    // front hands the next session the state before the work happened.
    const out = await brief();
    expect(out.open_tasks[0]!.last_handoff?.body).toBe("latest handoff");
  });

  it("carries every dead end", async () => {
    // The highest-value entry there is: it is what stops the repeat.
    const out = await brief();
    expect(out.open_tasks[0]!.dead_ends).toEqual([
      expect.objectContaining({ id: expect.any(Number), body: "the cron did not work" }),
    ]);
  });

  it("carries the decisions and the open questions apart", async () => {
    const out = await brief();
    expect(out.open_tasks[0]!.decisions).toEqual([
      expect.objectContaining({ id: expect.any(Number), body: "chose the CTE" }),
    ]);
    expect(out.open_tasks[0]!.open_questions).toEqual([
      expect.objectContaining({ id: expect.any(Number), body: "which timezone?" }),
    ]);
  });

  /**
   * The id is the point of the shape, not decoration.
   *
   * A briefing that hands back bare strings is reading matter: an agent that
   * has just worked out the answer to an open question cannot say *which*
   * question it answered without a second `get_task`, and that call returns the
   * whole log to recover a number this payload already had.
   */
  it("names every record it hands back, so the agent can act on one", async () => {
    const out = await brief();
    const task = out.open_tasks[0]!;
    // `last_handoff` is in the list on purpose. It is the one field of this
    // shape that stands alone, so it is the one where flattening it back to a
    // bare string would look like a simplification rather than a loss.
    const records = [
      ...task.decisions,
      ...task.dead_ends,
      ...task.open_questions,
      ...(task.last_handoff ? [task.last_handoff] : []),
    ];
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(typeof record.id).toBe("number");
      expect(typeof record.kind).toBe("string");
      expect(typeof record.created_at).toBe("string");
      // Always, even when the body came back whole: an agent skimming a task
      // should not have to branch on whether it did.
      expect(record.head.length).toBeGreaterThan(0);
    }
  });

  it("counts the whole log, including the kinds it never asked for", async () => {
    // The count comes from the database, not from the rows in hand. Counting
    // what was returned would have made the cap invisible in the one number a
    // reader could have used to notice it.
    const out = await brief();
    expect(out.open_tasks[0]!.entry_count).toBe(6);
  });

  it("says how much the cap hid, rather than trimming in silence", async () => {
    // The same rule as `open_tasks_omitted`, one level down. A briefing that
    // quietly drops the dead end it was capped out of is worse than a long one,
    // because the reader stops knowing to go and look.
    mocks.countsByTasks.mockResolvedValue(
      counts({ total: 40, decisions: 10, dead_ends: 5, questions: 1 }),
    );
    const out = await brief();
    // Shown: 1 decision, 1 dead end, 1 question. Held back: 9 + 4 + 0.
    expect(out.open_tasks[0]!.log_omitted).toBe(13);
  });

  it("reports nothing hidden when the cap did not bite", async () => {
    const out = await brief();
    expect(out.open_tasks[0]!.log_omitted).toBe(0);
  });

  /**
   * MUTATION CHECK. `log_omitted` counts RECORDS THE CAP DROPPED, and a record
   * carried without its body was not dropped -- it is in the payload, named,
   * dated and headed, and `get_task` reads the rest.
   *
   * The plausible edit is `decisions.filter((d) => d.body !== null).length` in
   * the arithmetic, which reads like a tightening. It would inflate
   * `log_omitted` by every head-only record, and this number is the one thing
   * telling the agent how much it has not seen -- so the mutation makes it lie
   * in exactly the direction briefing.ts warns about: "a number that lies about
   * how much it is hiding is worse here than a big payload, because the agent
   * stops knowing to go and look."
   */
  it("counts a record carried without its body as carried, not as omitted", async () => {
    mocks.countsByTasks.mockResolvedValue(counts({ total: 1, decisions: 1 }));
    mocks.pageByTasksPerKind.mockResolvedValue(
      new Map([[1, [entry("decision", null, { head: "chose the CTE" })]]]),
    );

    const out = await brief();

    expect(out.open_tasks[0]!.decisions).toHaveLength(1);
    expect(out.open_tasks[0]!.log_omitted).toBe(0);
  });

  it("says there is no handoff rather than inventing one", async () => {
    mocks.pageByTasksPerKind.mockResolvedValue(new Map());
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
  const note = (id: number, body: string | null = "b") => ({
    id,
    kind: "gotcha",
    title: `note ${id}`,
    body,
  });

  it("asks for the account-wide ones and the project's separately", async () => {
    await brief();
    expect(mocks.pageNotes).toHaveBeenCalledWith(7, null, 60, undefined);
    expect(mocks.pageNotes).toHaveBeenCalledWith(7, PROJECT.id, 60, undefined);
  });

  /**
   * A focus reorders which notes keep a body; it never changes how many.
   *
   * Both scopes get it, because a standing rule that applies to every project
   * is the kind most likely to be old -- and therefore the kind recency buries
   * first. Reaching only the project's own notes would leave exactly the wrong
   * half on the guess.
   */
  it("passes the focus to both scopes, or neither", async () => {
    await brief(7, "why is login redirecting in a loop");
    expect(mocks.pageNotes).toHaveBeenCalledWith(7, null, 25, "why is login redirecting in a loop");
    expect(mocks.pageNotes).toHaveBeenCalledWith(
      7,
      PROJECT.id,
      25,
      "why is login redirecting in a loop",
    );
  });

  it("says which of the two orderings the notes came back in", async () => {
    // The agent cannot tell by looking, and it changes what a null body means:
    // ranked, it was judged irrelevant; recent, nobody said what to judge by.
    expect((await brief()).context_ranked_by).toBe("recency");
    expect((await brief(7, "anything at all")).context_ranked_by).toBe("focus");
  });

  it("asks the database for the ceiling rather than slicing after the fact", async () => {
    // The whole point of the cap is the bytes that never cross the network.
    // Trimming here would leave the cost exactly where it was.
    await brief();
    for (const call of mocks.pageNotes.mock.calls) expect(call[2]).toBe(60);
  });

  /**
   * A lower ceiling is only safe because the budget is being aimed. Sending a
   * focus therefore buys fewer bodies, not the same number reordered -- and
   * *not* sending one must keep the old, wider guess, since nothing else is
   * left to choose by.
   */
  it("spends less when it knows what to spend it on", async () => {
    await brief();
    for (const call of mocks.pageNotes.mock.calls) expect(call[2]).toBe(60);
    mocks.pageNotes.mockClear();
    await brief(7, "the login redirect loop");
    for (const call of mocks.pageNotes.mock.calls) expect(call[2]).toBe(25);
  });

  it("hands back only the four fields a reader needs", async () => {
    // The row carries timestamps and a user id; a briefing is spent context
    // and none of that is worth any of it.
    mocks.pageNotes.mockResolvedValue({ rows: [note(1)], omitted: 0 });
    const out = await brief();
    expect(Object.keys(out.global_context[0]!).sort()).toEqual(["body", "id", "kind", "title"]);
  });

  it("keeps the title of a note whose body it could not afford", async () => {
    // A capped note is still a note the agent should know exists. Dropping the
    // row would make the ceiling invisible; the title plus the id is what lets
    // it decide whether to spend a get_context_note call on this one.
    mocks.pageNotes.mockResolvedValue({ rows: [note(1), note(2, null)], omitted: 1 });
    const out = await brief();
    expect(out.global_context).toHaveLength(2);
    expect(out.global_context[1]).toMatchObject({ id: 2, title: "note 2", body: null });
  });

  it("adds up what both scopes left out", async () => {
    // One number for two calls. Reported separately it would read as two
    // different ceilings, and there is only one.
    mocks.pageNotes
      .mockResolvedValueOnce({ rows: [note(1, null)], omitted: 1 })
      .mockResolvedValueOnce({ rows: [note(2, null), note(3, null)], omitted: 2 });
    expect((await brief()).context_omitted).toBe(3);
  });

  it("reports nothing omitted when nothing was", async () => {
    expect((await brief()).context_omitted).toBe(0);
  });
});

/**
 * The wrap-up request, and why it is no longer the same sentence every time.
 *
 * It used to be one line, identical in every briefing: write a handoff before
 * you finish. Two accounts in production read that at the top of every session
 * for weeks and wrote nothing — roughly what a request that is the same
 * whether or not it applies deserves.
 *
 * `last_handoff` is already computed for each open task, so the ask can name a
 * number and the ids behind it without querying anything. The half worth
 * guarding is the other one: when every open task already has a handoff, the
 * briefing must not end by asking for one. That is the same always-true
 * sentence wearing a different hat, and it is what teaches an agent to stop
 * reading the last line.
 */
describe("the closing hint", () => {
  it("still asks for dead ends, which is true whatever the tasks look like", async () => {
    const out = await brief();
    expect(out.hint).toContain("dead ends");
  });

  it("names how many open tasks have no handoff, and which", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: [task(1), task(2), task(3)], total: 3 });
    // No handoff entries at all, so all three are naked.
    mocks.pageByTasksPerKind.mockResolvedValue(new Map());

    const out = await brief();

    expect(out.hint).toContain("3 of the open tasks");
    expect(out.hint).toContain("#1, #2, #3");
    expect(out.hint).toContain("handoff");
  });

  it("goes quiet about handoffs when every open task already has one", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: [task(1)], total: 1 });
    // A flat list per task, which is what the repository answers.
    mocks.pageByTasksPerKind.mockResolvedValue(
      new Map([[1, [entry("handoff", "where I left it")]]]),
    );

    const out = await brief();

    expect(out.hint).not.toContain("handoff");
    expect(out.hint).toContain("dead ends");
  });

  /**
   * MUTATION CHECK. The only job of this test is to fail against one plausible
   * edit, and the edit is plausible enough that it has a shape already used
   * twice in this file: reading `.body` off a record where existence was the
   * question.
   *
   * A handoff whose body the byte budget did not pay for is still a handoff --
   * it is one `get_task` away, and its head is right there in the payload. If
   * `closingHint` narrows to `t.last_handoff?.body == null`, or if
   * `last_handoff` is flattened back to `handoff?.body ?? null`, this briefing
   * ends by asking an agent to write a handoff that already exists. Both
   * compile. Both are silent in production. Both put back the always-true
   * sentence the hint was rebuilt to stop being, in a third disguise.
   */
  it("counts a handoff it could not afford to show as a handoff", async () => {
    mocks.pageByProject.mockResolvedValue({ rows: [task(1)], total: 1 });
    mocks.pageByTasksPerKind.mockResolvedValue(
      new Map([[1, [entry("handoff", null, { head: "where I left it" })]]]),
    );

    const out = await brief();

    expect(out.open_tasks[0]!.last_handoff).not.toBeNull();
    expect(out.hint).not.toContain("handoff");
    expect(out.hint).not.toContain("#1");
  });

  /**
   * Past a handful this stops being a list of things to do before finishing
   * and becomes a statement about the backlog, which is a different message
   * and not this one's job.
   */
  it("caps the ids it lists", async () => {
    const many = Array.from({ length: 9 }, (_, i) => task(i + 1));
    mocks.pageByProject.mockResolvedValue({ rows: many, total: 9 });
    mocks.pageByTasksPerKind.mockResolvedValue(new Map());

    const out = await brief();

    expect(out.hint).toContain("9 of the open tasks");
    expect(out.hint).toContain("#5");
    expect(out.hint).not.toContain("#6");
    expect(out.hint).toContain("+4 more");
  });
});

/**
 * The automatic half, and the reason it is a separate field rather than more
 * entries.
 *
 * Nobody vouched for any of this: it is what the stdio process saw in git
 * while the last session ran. Mixing it into the log would buy recall with the
 * one property the log has that a transcript does not -- that somebody decided
 * each line was worth keeping. So it arrives beside the log, labelled, capped,
 * and honest about what it left out.
 */
describe("unverified observations", () => {
  const observation = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    source: "stdio",
    client: "claude-code",
    branch: "feat/x",
    base_sha: "aaa",
    head_sha: "bbb",
    commits: 3,
    files_changed: 7,
    commit_subjects: "fix the thing",
    started_at: "2026-09-01T09:00:00Z",
    observed_at: "2026-09-01T11:00:00Z",
    ...over,
  });

  it("carries what the session before it did", async () => {
    mocks.pageObservations.mockResolvedValue({ rows: [observation(1)], omitted: 0 });
    const out = await brief();
    expect(out.observations).toHaveLength(1);
    expect(out.observations[0]).toMatchObject({ id: 1, commits: 3, branch: "feat/x" });
  });

  /**
   * A cold agent has to be able to tell "nothing happened" from "this server
   * does not do that". An absent key reads as the second and is the first.
   */
  it("is an empty list rather than absent when there is nothing", async () => {
    const out = await brief();
    expect(out.observations).toEqual([]);
    expect(out.observations_omitted).toBe(0);
  });

  /**
   * Ten, and the number is small on purpose: these are the least trustworthy
   * rows in the payload, and the budget they spend is taken from the notes and
   * the log, which are the most.
   */
  it("asks for six", async () => {
    await brief();
    expect(mocks.pageObservations).toHaveBeenCalledWith(PROJECT.id, 6);
  });

  /**
   * The same honesty `log_omitted` and `context_omitted` keep. A number that
   * lies about how much it is hiding is worse than a big payload, because the
   * agent stops knowing to go and look.
   */
  it("says how many it did not show", async () => {
    mocks.pageObservations.mockResolvedValue({ rows: [observation(1)], omitted: 4 });
    expect((await brief()).observations_omitted).toBe(4);
  });

  /**
   * The two layers, asserted rather than assumed: nothing an observation
   * carries may appear among the entries a task reports.
   */
  it("never reaches the curated log", async () => {
    mocks.pageObservations.mockResolvedValue({ rows: [observation(1)], omitted: 0 });
    const out = await brief();
    for (const t of out.open_tasks) {
      expect(t.decisions).toEqual([]);
      expect(t.dead_ends).toEqual([]);
      expect(t.open_questions).toEqual([]);
    }
  });
});
