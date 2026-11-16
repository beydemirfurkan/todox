import { describe, expect, it } from "vitest";

import { OPEN_STATUSES } from "../constants";
import { openByProjectsSql, stalledByProjectsSql } from "./tasks";

/**
 * The dashboard's two task queries, asserted as text.
 *
 * `pnpm test` has no database, so the string is what CI can check, and the
 * mistakes that live in these are the silent kind: a parameter count that is
 * off by one binds a status where a project id belongs and returns nothing,
 * which on a dashboard reads as "nothing in flight".
 */
const literals = (sql: string) => sql.match(/'[^']*'/g) ?? [];
const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

describe("openByProjectsSql", () => {
  const SQL = openByProjectsSql(4);

  it("binds the projects, the open statuses and the ceiling, in that order", () => {
    expect(placeholders(SQL)).toBe(4 + OPEN_STATUSES.length + 1);
    expect(SQL.indexOf("project_id IN")).toBeLessThan(SQL.indexOf("status IN"));
    expect(SQL.indexOf("status IN")).toBeLessThan(SQL.indexOf("rank <= ?"));
  });

  it("cuts per project and per status, so one busy project cannot empty the others", () => {
    expect(SQL).toContain("PARTITION BY t.project_id, t.status");
  });

  it("does not read bodies", () => {
    expect(SQL).not.toContain("body");
    expect(SQL).not.toContain("*");
  });
});

describe("stalledByProjectsSql", () => {
  const SQL = stalledByProjectsSql(2);

  it("binds the projects, the quiet threshold and the limit", () => {
    expect(placeholders(SQL)).toBe(2 + 1 + 1);
    for (const literal of literals(SQL)) expect(literal).not.toContain("?");
  });

  it("holds the threshold to doing: a blocked task waits however recent it is", () => {
    expect(SQL).toContain("status = 'blocked' OR (status = 'doing' AND updated_at < ?)");
  });

  it("returns the longest wait first", () => {
    expect(SQL).toMatch(/ORDER BY updated_at\s+LIMIT \?/);
  });
});
