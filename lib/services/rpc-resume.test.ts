import { beforeEach, describe, expect, it, vi } from "vitest";

/** When `updateTask` hands over the task's log, and that it can never cost the update. */
const db = vi.hoisted(() => ({ one: vi.fn(), all: vi.fn(), run: vi.fn(), tx: vi.fn() }));
const mocks = vi.hoisted(() => ({ update: vi.fn(), resume: vi.fn() }));

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  ...db,
}));
vi.mock("./ownership", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ownership")>()),
  assertTask: vi.fn(),
}));
vi.mock("./task-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./task-service")>()),
  update: mocks.update,
}));
vi.mock("./task-resume", () => ({ taskResume: mocks.resume }));

const { invoke } = await import("./rpc");

const LOG = { log: [{ id: 1, kind: "handoff", date: "2026-11-24", body: "left here" }] };
const update = (status: string) =>
  invoke({ userId: 9 }, "updateTask", { task_id: 7, status }) as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  db.run.mockResolvedValue(0);
  mocks.update.mockImplementation(async (id: number, patch: object) => ({ id, ...patch }));
  mocks.resume.mockResolvedValue(LOG);
});

describe("updateTask's resume", () => {
  it("comes with 'doing'", async () => {
    expect(await update("doing")).toEqual({ id: 7, status: "doing", resume: LOG });
  });

  it.each(["todo", "blocked", "dropped"])("is not read for '%s'", async (status) => {
    expect(await update(status)).not.toHaveProperty("resume");
    expect(mocks.resume).not.toHaveBeenCalled();
  });

  it("is absent for a task with no log", async () => {
    mocks.resume.mockResolvedValue(null);
    expect(await update("doing")).not.toHaveProperty("resume");
  });

  it("does not cost the update when reading it fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.resume.mockRejectedValue(new Error("connection reset"));
    expect(await update("doing")).toEqual({ id: 7, status: "doing" });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
