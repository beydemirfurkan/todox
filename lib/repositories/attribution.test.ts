import { describe, expect, it } from "vitest";

import { createStmt } from "./events";

/**
 * `?` is rewritten to `$n` by position, so adding a column to an INSERT is the
 * classic way to slide every parameter after it one place along. Nothing else
 * in the suite would notice: the wrong value would simply be stored, and the
 * page rendering it says nothing about a status that is off by one field.
 */
describe("task_events insert", () => {
  it("binds one parameter per placeholder", () => {
    const stmt = createStmt({
      task_id: 1,
      from_status: "todo",
      to_status: "doing",
      actor: "human",
      model: null,
      user_id: 9,
    });
    const placeholders = (stmt.text.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(stmt.params.length);
  });

  it("puts the author last, where the column list says it is", () => {
    const stmt = createStmt({
      task_id: 1,
      from_status: null,
      to_status: "todo",
      user_id: 9,
    });
    const columns = stmt.text
      .slice(stmt.text.indexOf("(") + 1, stmt.text.indexOf(")"))
      .split(",")
      .map((c) => c.trim());
    expect(columns.indexOf("user_id")).toBe(columns.length - 1);
    expect(stmt.params[stmt.params.length - 1]).toBe(9);
  });

  /** Not every writer has one: the agent surface fills it, old rows do not. */
  it("stores no author rather than inventing one", () => {
    const stmt = createStmt({ task_id: 1, from_status: null, to_status: "todo" });
    expect(stmt.params[stmt.params.length - 1]).toBe(null);
  });
});
