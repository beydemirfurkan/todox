import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which project gate each agent method stands behind.
 *
 * `mustResolve` answers for a member as readily as for an owner — that is the
 * point of a shared project. So a handler that resolves a project and writes
 * to it has decided nothing yet: the gate is the `assert*` call, and picking
 * the wrong one fails in two opposite directions, neither of them loudly.
 *
 * Too weak, on the project row itself: `projects.update` and `projects.remove`
 * are scoped `WHERE id = ? AND user_id = ?`, so a member's write matched no
 * row, changed nothing, and the handler returned success anyway —
 * `delete_project` told the agent `{ deleted: <slug>, tasks_removed: N }` over
 * a project that is still there.
 *
 * Too strong, on a row inside the project: `add_context` asserted ownership,
 * which left a collaborator able to open tasks and log entries but unable to
 * write down what any of it decided.
 *
 * The mock below is the whole test: the account is a **member and not the
 * owner**, expressed as the two ownership queries answering differently. What
 * each method does with that is what is asserted.
 */
const db = vi.hoisted(() => ({ one: vi.fn(), all: vi.fn(), run: vi.fn(), tx: vi.fn() }));

/**
 * Only the four functions that reach Postgres are replaced. Swapping the whole
 * module also removes `setClause`, and then `projects.update` dies on a
 * TypeError before it ever gets to the write — which reads as a refusal and
 * would let "the write was not reached" pass with the ownership check deleted.
 */
vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  ...db,
}));

const PROJECT = { id: 42, slug: "shared", name: "shared", user_id: 9 };

vi.mock("./project-resolver", () => ({
  mustResolve: vi.fn(async () => PROJECT),
  resolveOrCreate: vi.fn(async () => ({ project: PROJECT })),
}));

const { invoke } = await import("./rpc");
const { NotYours } = await import("./ownership");

const MEMBER = { userId: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  db.run.mockResolvedValue(0);
  db.all.mockResolvedValue([]);
  /**
   * One account, two answers, discriminated the way the SQL itself differs:
   * `ownsProject` asks about `projects.user_id` alone, `accessesProject` joins
   * `project_memberships`. Anything else this call path needs is answered
   * generically so the ownership decision is the only thing under test.
   */
  db.one.mockImplementation(async (text: string) => {
    if (text.includes("project_memberships")) return { n: 1 };
    if (text.includes("FROM projects WHERE id")) return undefined;
    if (text.includes("INSERT INTO contexts")) return { id: 1, title: "t", body: "b" };
    return undefined;
  });
});

describe("a member calling a method that writes the project row", () => {
  it("update_project is refused rather than answered with the unchanged row", async () => {
    await expect(invoke(MEMBER, "updateProject", { project: "shared", name: "mine" })).rejects.toThrow(
      NotYours,
    );
  });

  it("update_project does not reach the write", async () => {
    // The bug was never a wrong row being written — it was a write that hit
    // nothing while the caller was told otherwise. If the assert is removed,
    // this is the assertion that still notices.
    await expect(invoke(MEMBER, "updateProject", { project: "shared", name: "mine" })).rejects.toThrow();
    expect(db.run).not.toHaveBeenCalled();
  });

  it("delete_project is refused rather than reporting a deletion", async () => {
    await expect(
      invoke(MEMBER, "deleteProject", { project: "shared", confirm: "shared" }),
    ).rejects.toThrow(NotYours);
  });

  it("delete_project does not reach the write", async () => {
    await expect(
      invoke(MEMBER, "deleteProject", { project: "shared", confirm: "shared" }),
    ).rejects.toThrow();
    expect(db.run).not.toHaveBeenCalled();
  });

  it("is refused by the gate, not by the confirmation string", async () => {
    // A wrong `confirm` throws BadRequest, which would mask a missing gate
    // behind an error that looks like the right refusal. The slug here is
    // correct, so only ownership can be what stops it.
    const { BadRequest } = await import("./errors");
    await expect(
      invoke(MEMBER, "deleteProject", { project: "shared", confirm: "shared" }),
    ).rejects.not.toBeInstanceOf(BadRequest);
  });
});

describe("a member calling a method that writes inside the project", () => {
  it("add_context is allowed", async () => {
    // The same account, the same project, the opposite answer: a note beside
    // the work is part of the work.
    await expect(
      invoke(MEMBER, "addContext", {
        project: "shared",
        kind: "decision",
        title: "why the queue is not a cron",
        body: "because the retry has to be visible",
      }),
    ).resolves.toBeDefined();
  });
});
