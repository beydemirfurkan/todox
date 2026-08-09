import { describe, expect, it } from "vitest";

import { setClause } from "./client";

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
