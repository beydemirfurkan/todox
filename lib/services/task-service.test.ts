import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What `answers_entry_id` is allowed to point at.
 *
 * The field is the only thing that ever closes a `question`, and closing one
 * means it stops arriving in every briefing and every report. So the failure
 * that matters is not an error — it is a pointer at the wrong row quietly
 * hiding something that should still be open, which nothing downstream would
 * report and nobody would go looking for.
 */
const mocks = vi.hoisted(() => ({
  byId: vi.fn(),
  createStmt: vi.fn(() => ({ text: "INSERT", params: [] })),
  touchStmt: vi.fn(() => ({ text: "UPDATE", params: [] })),
  tx: vi.fn(async () => [[{ id: 900 }]]),
}));

vi.mock("../db/client", () => ({ tx: mocks.tx }));
vi.mock("../repositories/entries", () => ({
  byId: mocks.byId,
  createStmt: mocks.createStmt,
}));
vi.mock("../repositories/tasks", () => ({ touchStmt: mocks.touchStmt, remove: vi.fn() }));
vi.mock("../repositories/events", () => ({ recordStmt: vi.fn() }));
vi.mock("../repositories/refs", () => ({ linkStmt: vi.fn() }));

const { addEntry } = await import("./task-service");

const entry = (over: Record<string, unknown> = {}) => ({
  id: 118,
  task_id: 42,
  kind: "question",
  body: "which timezone?",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.mockResolvedValue([[{ id: 900 }]]);
});

describe("addEntry", () => {
  it("writes without a lookup when it answers nothing", async () => {
    await addEntry({ task_id: 42, kind: "note", body: "just a note" });
    // Nearly every entry answers nothing; none of them should pay for a read.
    expect(mocks.byId).not.toHaveBeenCalled();
    expect(mocks.tx).toHaveBeenCalledOnce();
  });

  it("accepts a question on the same task", async () => {
    mocks.byId.mockResolvedValue(entry());
    await addEntry({ task_id: 42, kind: "decision", body: "UTC", answers_entry_id: 118 });
    expect(mocks.tx).toHaveBeenCalledOnce();
  });

  it("refuses a question belonging to another task", async () => {
    // Ownership was established for *this* task, so a pointer that leaves it
    // leaves what the caller was authorised for.
    mocks.byId.mockResolvedValue(entry({ task_id: 7 }));
    await expect(
      addEntry({ task_id: 42, kind: "decision", body: "UTC", answers_entry_id: 118 }),
    ).rejects.toThrow(/not on task #42/);
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("refuses an id that is not an entry, in the same words", async () => {
    // Same message as the wrong-task case: the reply must not tell a caller
    // that an id exists somewhere they cannot see.
    mocks.byId.mockResolvedValue(undefined);
    await expect(
      addEntry({ task_id: 42, kind: "decision", body: "UTC", answers_entry_id: 9999 }),
    ).rejects.toThrow(/not on task #42/);
  });

  it("refuses to answer anything that is not a question", async () => {
    // A decision pointed at a decision would hide the target from every
    // briefing, which is the one thing this field does and the last thing
    // anybody meant by it.
    mocks.byId.mockResolvedValue(entry({ kind: "dead_end" }));
    await expect(
      addEntry({ task_id: 42, kind: "decision", body: "UTC", answers_entry_id: 118 }),
    ).rejects.toThrow(/only a question can be answered/);
    expect(mocks.tx).not.toHaveBeenCalled();
  });
});
