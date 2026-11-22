import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a log entry leaves a trace. What is pinned: the permission check
 * comes first, and the delete and its record are one transaction, so a shared
 * log never loses a line without saying so.
 */
const ownership = vi.hoisted(() => {
  class NotYours extends Error {}
  return { assertCanDeleteEntry: vi.fn(), NotYours };
});
const entriesRepo = vi.hoisted(() => ({
  byId: vi.fn(),
  removeStmt: vi.fn(() => ({ text: "delete entry", params: [] })),
}));
const deletionsRepo = vi.hoisted(() => ({
  createStmt: vi.fn((input: unknown) => ({ text: "record deletion", params: [input] })),
}));
const db = vi.hoisted(() => ({ tx: vi.fn() }));

vi.mock("./ownership", () => ownership);
vi.mock("../repositories/entries", () => entriesRepo);
vi.mock("../repositories/entry-deletions", () => deletionsRepo);
vi.mock("../db/client", () => db);

const { deleteEntry } = await import("./entry-deletion");

const ENTRY = { id: 5, task_id: 2, kind: "decision", user_id: 7, created_at: "2026-11-01T00:00:00.000Z" };

beforeEach(() => {
  vi.clearAllMocks();
  ownership.assertCanDeleteEntry.mockResolvedValue(undefined);
  entriesRepo.byId.mockResolvedValue(ENTRY);
});

describe("deleteEntry", () => {
  it("deletes and records who deleted what, in one transaction", async () => {
    expect(await deleteEntry(3, 5)).toEqual({ deleted: true });
    expect(db.tx).toHaveBeenCalledTimes(1);
    expect((db.tx.mock.calls[0][0] as { text: string }[]).map((s) => s.text)).toEqual([
      "delete entry",
      "record deletion",
    ]);
    expect(deletionsRepo.createStmt).toHaveBeenCalledWith({
      task_id: 2,
      kind: "decision",
      author_id: 7,
      deleted_by: 3,
      created_at: ENTRY.created_at,
    });
  });

  it("asks permission before reading or writing anything", async () => {
    ownership.assertCanDeleteEntry.mockRejectedValue(new ownership.NotYours("entry #5"));
    await expect(deleteEntry(3, 5)).rejects.toBeInstanceOf(ownership.NotYours);
    expect(entriesRepo.byId).not.toHaveBeenCalled();
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("answers like a missing entry when it vanished after the check", async () => {
    entriesRepo.byId.mockResolvedValue(undefined);
    await expect(deleteEntry(3, 5)).rejects.toBeInstanceOf(ownership.NotYours);
    expect(db.tx).not.toHaveBeenCalled();
  });

  it("keeps an unsigned entry unsigned in the record", async () => {
    entriesRepo.byId.mockResolvedValue({ ...ENTRY, user_id: null });
    await deleteEntry(3, 5);
    expect(deletionsRepo.createStmt).toHaveBeenCalledWith(expect.objectContaining({ author_id: null }));
  });
});
