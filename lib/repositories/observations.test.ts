import { describe, expect, it } from "vitest";

import { OMITTED_FROM, QUERIES, promoteStmt } from "./observations";

const ALL = Object.entries(QUERIES);

/**
 * `lib/db/client.ts` rewrites `?` to `$n` positionally and does not parse
 * strings, so a question mark inside a quoted literal silently shifts every
 * parameter after it. Nothing fails to compile and nothing fails to run -- the
 * statement simply binds the wrong values, which for a WHERE on an account
 * means it runs as somebody else.
 */
describe("no question mark inside a string literal", () => {
  for (const [name, sql] of ALL) {
    it(name, () => {
      const literals = sql.match(/'[^']*'/g) ?? [];
      for (const literal of literals) expect(literal).not.toContain("?");
    });
  }
});

/**
 * The briefing's read. Two filters, and both are load-bearing rather than
 * tidiness: a promoted observation has already become an entry, so showing it
 * again is the duplication the two layers exist to prevent, and an expired one
 * is a row the sweep has simply not reached yet.
 */
describe("the briefing's read", () => {
  it("hides observations an agent has already promoted", () => {
    expect(QUERIES.page).toContain("promoted_at IS NULL");
  });

  it("hides observations past their retention", () => {
    expect(QUERIES.page).toContain("expires_at >");
  });

  it("scopes to one project", () => {
    expect(QUERIES.page).toMatch(/WHERE[\s\S]*project_id = \?/);
  });

  /**
   * The honest total comes back with the page rather than from a second query.
   * `count(*) OVER ()` is evaluated after the WHERE and before the LIMIT,
   * which is exactly the number the agent needs to know it was not given
   * everything -- and it costs nothing extra on the call every session opens
   * with.
   */
  it("counts what it is hiding, in the same round trip", () => {
    expect(QUERIES.page).toContain("count(*) OVER ()");
  });

  it("takes its three parameters in one order", () => {
    expect((QUERIES.page.match(/\?/g) ?? []).length).toBe(3);
  });
});

/**
 * One row per session per project. Without the conflict target every throttled
 * write during a session appends a row, and the table most at risk of being
 * noise becomes the noisiest one in the database.
 */
describe("the session upsert", () => {
  it("replaces the session's row rather than appending", () => {
    expect(QUERIES.record).toContain("ON CONFLICT (user_id, project_id, session_id)");
    expect(QUERIES.record).toContain("DO UPDATE");
  });

  /**
   * `started_at` is what the session opened with. An upsert that overwrote it
   * would make every session look like it began at its last write.
   */
  it("keeps the time the session actually started", () => {
    const update = QUERIES.record.slice(QUERIES.record.indexOf("DO UPDATE"));
    expect(update).not.toContain("started_at");
  });
});

/**
 * Promotion is one-way. Ownership is not asserted here -- that belongs in
 * `lib/services/ownership.ts` and nowhere else -- but re-promotion is, because
 * a second promotion would relabel a record an agent already turned into an
 * entry.
 */
describe("promoteStmt", () => {
  it("cannot promote the same observation twice", () => {
    expect(promoteStmt(1, "decision", "2026-09-02T00:00:00.000Z").text).toContain(
      "promoted_at IS NULL",
    );
  });

  it("records what it became, so the row explains itself later", () => {
    const stmt = promoteStmt(7, "dead_end", "2026-09-02T00:00:00.000Z");
    expect(stmt.text).toContain("promoted_as");
    expect(stmt.params).toContain("dead_end");
    expect(stmt.params).toContain(7);
  });
});

/**
 * What the agent was not shown. The count is the eligible total, so the
 * subtraction is the only arithmetic -- and it can never go negative, because
 * the total is taken from the same rows the LIMIT cut.
 */
describe("OMITTED_FROM", () => {
  it("is what the limit cut", () => {
    expect(OMITTED_FROM([{ total: 12 }, { total: 12 }])).toBe(10);
  });

  it("is zero when nothing was cut", () => {
    expect(OMITTED_FROM([{ total: 2 }, { total: 2 }])).toBe(0);
  });

  it("is zero when there was nothing to show", () => {
    expect(OMITTED_FROM([])).toBe(0);
  });
});
