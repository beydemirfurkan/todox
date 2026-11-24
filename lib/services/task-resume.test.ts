import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The log of the task being started, in the answer to the call that starts it.
 * What these hold is that it fits, that the dead ends survive a long handoff,
 * and that nothing arrives half-read.
 */
const mocks = vi.hoisted(() => ({ page: vi.fn() }));
vi.mock("../repositories/entries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repositories/entries")>()),
  pageByTasksPerKind: mocks.page,
}));

const { fitResume, taskResume, RESUME_MAX_CHARS } = await import("./task-resume");

const ME = 11;
type Kind = "handoff" | "dead_end" | "question" | "decision";
const entry = (id: number, kind: Kind, body: string | null, over: Record<string, unknown> = {}) => ({
  id,
  kind,
  created_at: "2026-11-24T10:00:00.000Z",
  head: `head ${id}`,
  body,
  user_id: ME,
  author: "agent",
  model: "claude-opus-5",
  author_name: "furkan",
  ...over,
});
const answering = (...rows: unknown[]) =>
  mocks.page.mockResolvedValue({ rows: new Map([[7, rows]]), bodiesOmitted: 0 });
const chars = (value: unknown) => JSON.stringify(value).length;

beforeEach(() => mocks.page.mockReset());

describe("taskResume", () => {
  it("answers nothing for a task with no log", async () => {
    mocks.page.mockResolvedValue({ rows: new Map(), bodiesOmitted: 0 });
    expect(await taskResume(ME, 7)).toBeNull();
  });

  it("puts the handoff first, then dead ends newest first, whatever order they were written in", async () => {
    answering(
      entry(1, "dead_end", "old"),
      entry(2, "decision", "why"),
      entry(3, "handoff", "left here"),
      entry(4, "dead_end", "new"),
    );
    const resume = await taskResume(ME, 7);
    expect(resume!.log.map((r) => r.id)).toEqual([3, 4, 1, 2]);
    expect(resume).not.toHaveProperty("more");
    expect(resume!.log[0]).toEqual({ id: 3, kind: "handoff", date: "2026-11-24", body: "left here" });
  });

  it("says who wrote a record when it was somebody else", async () => {
    answering(entry(1, "handoff", "left", { user_id: 12, author_name: "Mert" }));
    expect((await taskResume(ME, 7))!.log[0]).toMatchObject({ by: "Mert's agent (claude-opus-5)" });
  });

  it("keeps a short dead end whole under a handoff too long to send", async () => {
    // The query's rule, not a fixture: the row that crosses the budget is paid
    // for and every body after it is null. Any budget the handoff could cross
    // would cost the dead end its body.
    const rows = [entry(1, "handoff", "x".repeat(90_000)), entry(2, "dead_end", "tried it, locks the table")];
    mocks.page.mockImplementation(async (_ids, _kinds, _perKind, budget: number) => {
      let spent = 0;
      const read = rows.map((r) => {
        const body = spent < budget ? r.body : null;
        spent += r.body!.length;
        return { ...r, body };
      });
      return { rows: new Map([[7, read]]), bodiesOmitted: 0 };
    });
    const { log } = (await taskResume(ME, 7))!;
    expect(log[0]).toMatchObject({ id: 1, head: "head 1" });
    expect(log[1]).toMatchObject({ id: 2, body: "tried it, locks the table" });
  });

  it("sends a head for a body that did not come back", async () => {
    answering(entry(1, "handoff", null));
    expect(await taskResume(ME, 7)).toEqual({
      log: [{ id: 1, kind: "handoff", date: "2026-11-24", head: "head 1" }],
      more: 1,
    });
  });
});

describe("fitResume", () => {
  it("stays under the ceiling with the fullest log there can be", () => {
    const long = "x".repeat(5_000);
    const log = [
      entry(1, "handoff", long),
      ...[2, 3, 4].map((id) => entry(id, "dead_end", long)),
      ...[5, 6].map((id) => entry(id, "question", long)),
      ...[7, 8].map((id) => entry(id, "decision", long)),
    ].map((e) => ({ ...e, head: "h".repeat(240) }));
    const resume = fitResume(log);
    expect(chars(resume)).toBeLessThanOrEqual(RESUME_MAX_CHARS);
    expect(resume.log[0]).toMatchObject({ id: 1, head: expect.any(String) });
    expect(resume.more).toBe(8);
  });

  it("does not let a long handoff hide the dead ends under it", () => {
    const resume = fitResume([
      entry(1, "handoff", "x".repeat(1_380)),
      entry(2, "dead_end", "d".repeat(900)),
      entry(3, "dead_end", "d".repeat(900)),
    ]);
    expect(resume.log.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(resume.log[0]).toHaveProperty("head");
  });

  it("gives up decisions before it gives up the handoff's body", () => {
    const resume = fitResume([
      entry(1, "handoff", "x".repeat(1_300)),
      entry(2, "decision", "y".repeat(900)),
      entry(3, "decision", "z".repeat(900)),
    ]);
    expect(resume.log[0]).toHaveProperty("body");
    expect(chars(resume)).toBeLessThanOrEqual(RESUME_MAX_CHARS);
  });

  it("never sends part of a body", () => {
    const body = "line one\n" + "w".repeat(2_000);
    const [record] = fitResume([entry(1, "handoff", body)]).log;
    expect(record).not.toHaveProperty("body");
    expect(record).toHaveProperty("head", "head 1");
  });
});
