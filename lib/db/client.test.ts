import { describe, expect, it } from "vitest";

import { isTimeout, setClause } from "./client";

/**
 * These are the regression tests for an authenticated SQL injection.
 *
 * `updateTask` reaches the repository as `const { task_id, model, ...patch } = p`,
 * so before the allow-list every key the caller invented was interpolated into
 * the statement. The placeholder count still matched, so it bound cleanly and
 * `RETURNING *` handed the result back.
 */
describe("setClause", () => {
  const COLUMNS = ["title", "body", "status", "priority"] as const;

  it("keeps the columns it is given", () => {
    // Column order follows the allow-list, not the caller's key order.
    expect(setClause({ priority: 1, title: "hello" }, COLUMNS)).toEqual({
      sql: "title = ?, priority = ?",
      values: ["hello", 1],
    });
  });

  it("ignores undefined so a partial patch stays partial", () => {
    expect(setClause({ title: "hello", body: undefined }, COLUMNS)).toEqual({
      sql: "title = ?",
      values: ["hello"],
    });
  });

  it("keeps null, which is how a field gets cleared", () => {
    expect(setClause({ body: null }, COLUMNS)).toEqual({
      sql: "body = ?",
      values: [null],
    });
  });

  it("drops the injected subselect that leaked the users table", () => {
    const patch = {
      "title = (SELECT password_hash FROM users WHERE id=1), body": "x",
    };
    expect(setClause(patch, COLUMNS)).toEqual({ sql: "", values: [] });
  });

  it("drops a column the caller is not allowed to write", () => {
    // The `updateProject` version of the same hole: user_id is a real column,
    // so without the list this handed your project to another account.
    expect(setClause({ user_id: 2, name: "mine" }, ["name"])).toEqual({
      sql: "name = ?",
      values: ["mine"],
    });
  });

  it("never emits a placeholder it has no value for", () => {
    // A mismatch here is what would let injected text shift the numbering.
    const patch = { title: "a", "b?c": "d", status: "done" };
    const { sql, values } = setClause(patch, COLUMNS);
    expect(sql.split("?").length - 1).toBe(values.length);
  });
});

/**
 * A statement that ran out of time used to reach the caller as the generic
 * 500, whose only actionable reading is "try again" -- and trying again times
 * out again. Naming it is what lets the answer say the useful thing; keeping
 * the name *narrow* is what stops it saying it about everything else.
 */
describe("isTimeout", () => {
  it("recognises a cancelled statement", () => {
    expect(isTimeout({ code: "57014" })).toBe(true);
  });

  it("leaves every other Postgres error alone", () => {
    // A unique violation reading as "your question was too big" would send the
    // caller to fix the size of a query that was exactly the right size.
    expect(isTimeout({ code: "23505" })).toBe(false);
    expect(isTimeout({ code: "42601" })).toBe(false);
    // Not a number, and not a prefix match either.
    expect(isTimeout({ code: 57014 })).toBe(false);
    expect(isTimeout({ code: "57014x" })).toBe(false);
  });

  it("does not throw on the things a catch block actually receives", () => {
    expect(isTimeout(new Error("connection terminated"))).toBe(false);
    expect(isTimeout(null)).toBe(false);
    expect(isTimeout(undefined)).toBe(false);
    expect(isTimeout("57014")).toBe(false);
  });
});
