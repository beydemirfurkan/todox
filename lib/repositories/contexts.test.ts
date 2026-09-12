import { describe, expect, it } from "vitest";

import { pageByProjectSql } from "./contexts";

/**
 * The briefing's note query, asserted as text.
 *
 * The same argument `entries.test.ts` makes, and it applies here word for
 * word: `pnpm test` runs without a database, so the shape of this string is
 * the only thing CI checks on every push, and every mistake that can live in
 * it is a silent one. A placeholder inside a literal binds the wrong values.
 * A dropped window frame answers with titles and no bodies -- or every body,
 * which is the failure the budget was added to stop. Nothing errors.
 *
 * Behaviour against a real Postgres is `pnpm smoke:mcp` and `pnpm bench:memory`.
 */
const ACCOUNT = pageByProjectSql("account", false);
const PROJECT = pageByProjectSql("project", false);
const FOCUSED = pageByProjectSql("project", true);

const count = (sql: string) => (sql.match(/\?/g) ?? []).length;

describe("no question mark inside a string literal", () => {
  it("holds for every form of the query", () => {
    for (const sql of [ACCOUNT, PROJECT, FOCUSED])
      for (const literal of sql.match(/'[^']*'/g) ?? []) expect(literal).not.toContain("?");
  });
});

describe("the parameters it takes", () => {
  /**
   * The account scope binds the user; the project scope binds the member
   * check, the project and the owner. Both then bind the row ceiling and the
   * byte budget, in that order, because that is the order the caller sends
   * them. Counted rather than trusted: a placeholder added to the text without
   * a value added to the array binds everything after it one position out.
   */
  it("takes exactly the placeholders the caller binds", () => {
    expect(count(ACCOUNT)).toBe(1 + 2);
    expect(count(PROJECT)).toBe(3 + 2);
  });

  it("takes two more with a focus, for the two configurations", () => {
    expect(count(FOCUSED)).toBe(count(PROJECT) + 2);
  });

  it("binds the row ceiling and the byte budget rather than writing them in", () => {
    expect(PROJECT).toContain("rn <= ?");
    expect(PROJECT).toContain("coalesce(spent_before, 0) < ?");
  });
});

describe("the byte budget", () => {
  /**
   * The frame is the whole design and losing it is silent.
   *
   * `1 PRECEDING` charges what every row BEFORE this one cost, so the row
   * that crosses the line is still paid for and a briefing always carries at
   * least one note whole. `CURRENT ROW` has a cliff: one long note sorting
   * first would answer with titles and nothing else.
   */
  it("charges for what came before, not including the row itself", () => {
    expect(PROJECT).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
  });

  it("counts bytes, not characters", () => {
    expect(PROJECT).toContain("SUM(octet_length(body))");
    expect(PROJECT).not.toContain("SUM(length(body))");
  });

  it("spends one budget per scope, not one per note", () => {
    const window = PROJECT.slice(
      PROJECT.indexOf("SUM(octet_length"),
      PROJECT.indexOf("AS spent_before"),
    );
    expect(window).not.toContain("PARTITION BY");
  });

  /**
   * Spent in the order the row ceiling already ranks the notes -- by the
   * number assigned, not by recomputing the ranking. With a focus that
   * ranking carries two `ts_rank` calls per note, and ordering the running
   * sum by `rn` keeps that at one pass rather than two.
   */
  it("spends in the ranked order, by the number already assigned", () => {
    const window = FOCUSED.slice(
      FOCUSED.indexOf("SUM(octet_length"),
      FOCUSED.indexOf("AS spent_before"),
    );
    expect(window).toContain("ORDER BY rn");
    expect(window).not.toContain("ts_rank");
  });

  it("returns a body only under both ceilings", () => {
    expect(PROJECT).toContain("CASE WHEN rn <= ? AND coalesce(spent_before, 0) < ? THEN body END");
  });

  it("keeps every title whatever the budget did", () => {
    // The final SELECT has no WHERE: a note past either ceiling is still a
    // row, with its id and title, so the agent can ask for it by id.
    const tail = PROJECT.slice(PROJECT.indexOf("SELECT id, kind, title"));
    expect(tail).not.toContain("WHERE");
  });
});

describe("ownership", () => {
  it("restricts the account scope on the row's own user", () => {
    expect(ACCOUNT).toContain("c.user_id = ? AND c.project_id IS NULL");
  });

  it("restricts the project scope on the owner or a membership", () => {
    expect(PROJECT).toContain("p.user_id = ? OR pm.user_id IS NOT NULL");
  });

  it("changes the ORDER BY and never the WHERE when a focus is sent", () => {
    const where = (sql: string) => sql.slice(sql.indexOf("WHERE c."), sql.indexOf("spent AS ("));
    expect(where(PROJECT).length).toBeGreaterThan(0);
    expect(where(FOCUSED)).toBe(where(PROJECT));
    expect(FOCUSED).toContain("ts_rank");
    expect(PROJECT).not.toContain("ts_rank");
  });
});
