import { describe, expect, it } from "vitest";

import { BadRequest } from "./errors";
import { invoke } from "./rpc";

/**
 * Ordering, not logic: `invoke` must reject bad params *before* dispatching to
 * a handler. There is no DATABASE_URL here, so anything that reaches a query
 * fails loudly with a different error — which is exactly the assertion.
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

  it("gets past validation on a well-formed call", async () => {
    // Reaches the handler and fails on the absent database, which is the
    // proof that validation was not what stopped it.
    await expect(invoke(ctx, "getTask", { task_id: 1 })).rejects.not.toBeInstanceOf(
      BadRequest,
    );
  });
});
