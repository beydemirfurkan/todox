import { describe, expect, it } from "vitest";

import { BadRequest } from "./errors";
import { invoke } from "./rpc";

/**
 * Ordering, not logic: `invoke` must reject bad params *before* dispatching to
 * a handler. The four rejection cases assert the error type directly; the last
 * one asserts the absence of it, and deliberately does not care what happened
 * instead.
 *
 * It used to care. The assertion was `rejects.not.toBeInstanceOf(BadRequest)`,
 * which needed the call to fail for any reason at all, and the reason on hand
 * was that CI runs this suite with no DATABASE_URL. On a developer's machine
 * with one exported the query succeeds, the promise resolves, and the test
 * failed while nothing was wrong -- a red suite that says nothing about the
 * code is worse than no test, because the next person learns to ignore it.
 */
describe("invoke", () => {
  const ctx = { userId: 1 };

  it("rejects the injected key without dispatching", async () => {
    await expect(
      invoke(ctx, "updateTask", {
        task_id: 1,
        "title = (SELECT password_hash FROM users WHERE id=1), body": "x",
      }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it("rejects a foreign column on updateProject without dispatching", async () => {
    // Handing your project to another account is a legal column write.
    await expect(
      invoke(ctx, "updateProject", { project: "todox", user_id: 2 }),
    ).rejects.toBeInstanceOf(BadRequest);
  });

  it("rejects an unknown method", async () => {
    await expect(invoke(ctx, "dropEverything", {})).rejects.toBeInstanceOf(BadRequest);
  });

  it("rejects a missing required param", async () => {
    await expect(invoke(ctx, "getTask", {})).rejects.toBeInstanceOf(BadRequest);
  });

  it("says which kind of refusal each was, in the word the log keeps", async () => {
    // The message names the method or the parameter; the reason is what the
    // route logs, so it has to be set on every exit or the log says "other".
    await expect(invoke(ctx, "dropEverything", {})).rejects.toMatchObject({
      reason: "unknown_method",
    });
    await expect(invoke(ctx, "getTask", {})).rejects.toMatchObject({ reason: "schema" });
    // A missing project reference is caught by the schema's refine before
    // `pickRef` ever runs, so it is a schema refusal too.
    await expect(invoke(ctx, "listTasks", {})).rejects.toMatchObject({ reason: "schema" });
  });

  it("gets past validation on a well-formed call", async () => {
    // Whether the handler then answers or fails on the database is none of this
    // test's business: both mean validation was not what stopped it. Only a
    // BadRequest would.
    const stoppedBy = await invoke(ctx, "getTask", { task_id: 1 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(stoppedBy).not.toBeInstanceOf(BadRequest);
  });
});
