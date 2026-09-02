import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Counting the call, and the two ways counting it could make things worse.
 *
 * The measurement sits on the one path every agent tool call takes, which is
 * what makes it worth having and also what makes it dangerous. Two properties
 * matter more than the number it produces:
 *
 *   - a refused call is counted. The most useful row this table can hold is an
 *     agent asking for something real and being told no on a shape nobody ever
 *     sees, so `parseParams` has to be inside the counted region.
 *   - a broken counter breaks nothing. A table that does not exist yet -- the
 *     state of every deployment between the code landing and the migration
 *     running -- must not turn every tool call into an error.
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

const { invoke } = await import("./rpc");

const CTX = { userId: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  usage.record.mockResolvedValue(undefined);
});

describe("counting what an agent called", () => {
  it("counts a call that worked", async () => {
    db.all.mockResolvedValue([]);
    db.one.mockResolvedValue(undefined);

    await invoke(CTX, "listProjects", {});

    expect(usage.record).toHaveBeenCalledWith(7, "listProjects", true);
  });

  /**
   * The row worth having. An agent that calls `create_task` with a shape the
   * schema rejects looks, from every other angle, exactly like an agent that
   * never called it at all.
   */
  it("counts a call the schema refused, and still refuses it", async () => {
    await expect(invoke(CTX, "createTask", { title: "" })).rejects.toThrow();

    expect(usage.record).toHaveBeenCalledWith(7, "createTask", false);
  });

  it("counts a call the handler threw on", async () => {
    db.all.mockRejectedValue(new Error("database went away"));
    db.one.mockRejectedValue(new Error("database went away"));

    await expect(invoke(CTX, "listProjects", {})).rejects.toThrow();

    expect(usage.record).toHaveBeenCalledWith(7, "listProjects", false);
  });

  /**
   * A method name that is not a method never reaches the counter: there is no
   * bucket to key on, and inventing one would let a caller write arbitrary
   * strings into the table a row at a time.
   */
  it("does not count a method that does not exist", async () => {
    await expect(invoke(CTX, "notAMethod", {})).rejects.toThrow();

    expect(usage.record).not.toHaveBeenCalled();
  });
});

describe("never getting in the way", () => {
  it("returns the result even when the counter rejects", async () => {
    db.all.mockResolvedValue([]);
    db.one.mockResolvedValue(undefined);
    usage.record.mockRejectedValue(new Error("relation tool_usage does not exist"));

    // The repository swallows its own failures; this asserts the caller does
    // not depend on that being true, because the two live in different files
    // and only one of them is on the path of every tool call.
    await expect(invoke(CTX, "listProjects", {})).resolves.toBeDefined();
  });
});
