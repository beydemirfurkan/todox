import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A note and the observation it was written up from.
 *
 * `addContext` was a single-table write and lived in the RPC handler, which
 * was right while it wrote one row. Promotion makes it two rows in two tables
 * that have to agree, and sequencing those is a service's job -- a handler
 * that opens a transaction is how the next one comes to open a wider one.
 */
const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 5 })),
  createStmt: vi.fn(() => ({ text: "INSERT INTO contexts", params: [] })),
  promoteStmt: vi.fn(() => ({ text: "UPDATE observations", params: [] })),
  tx: vi.fn(async (_statements: unknown[]) => [[{ id: 5 }]]),
}));

vi.mock("../db/client", () => ({ tx: mocks.tx }));
vi.mock("../repositories/contexts", () => ({
  create: mocks.create,
  createStmt: mocks.createStmt,
}));
vi.mock("../repositories/observations", () => ({ promoteStmt: mocks.promoteStmt }));

const { addContext } = await import("./context-service");

const note = {
  user_id: 7,
  project_id: 1,
  kind: "gotcha" as const,
  title: "the deploy is two steps",
  body: "migrate does not run on push",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: 5 });
  mocks.tx.mockResolvedValue([[{ id: 5 }]]);
});

describe("addContext", () => {
  /**
   * The common path is a note nobody is promoting, and it must stay one query.
   * A transaction around a single insert is three round trips instead of one,
   * on a write agents are told to reach for often.
   */
  it("writes an ordinary note in one query, with no transaction", async () => {
    await addContext(note);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.tx).not.toHaveBeenCalled();
  });

  it("promotes in the same transaction as the note", async () => {
    await addContext({ ...note, from_observation_id: 12 });
    expect(mocks.promoteStmt).toHaveBeenCalledWith(12, "gotcha");
    expect(mocks.tx).toHaveBeenCalledOnce();
    expect(mocks.tx.mock.calls[0]![0]).toHaveLength(2);
    // The single-query path must not also have run.
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the note either way", async () => {
    await expect(addContext(note)).resolves.toMatchObject({ id: 5 });
    await expect(addContext({ ...note, from_observation_id: 12 })).resolves.toMatchObject({
      id: 5,
    });
  });

  /**
   * The observation is the prompt, not the content: what is stored is what the
   * agent decided was worth keeping, in its own words.
   */
  it("keeps the agent's own words", async () => {
    await addContext({ ...note, from_observation_id: 12 });
    expect(mocks.createStmt).toHaveBeenCalledWith(
      expect.objectContaining({ body: "migrate does not run on push" }),
    );
  });
});
