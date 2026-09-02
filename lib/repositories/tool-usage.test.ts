import { describe, expect, it } from "vitest";

import { QUERIES } from "./tool-usage";

/**
 * The counter's SQL, checked without a database.
 *
 * Everything that can go wrong here is silent. A missing conflict target does
 * not error -- it writes a second row, and the table quietly becomes the event
 * log this design exists to avoid. A counter that reads `EXCLUDED.calls`
 * instead of its own column does not error either; it just stops counting past
 * one. Neither shows up as a failure anywhere, so it is asserted here.
 */

describe("no question mark inside a string literal", () => {
  // `lib/db/client.ts` rewrites `?` to `$n` positionally and does not parse
  // strings, so a literal containing one silently shifts every parameter after
  // it. Cheap to assert, and the reason the rule exists at all.
  for (const [name, sql] of Object.entries(QUERIES)) {
    it(name, () => {
      const literals = sql.match(/'[^']*'/g) ?? [];
      for (const literal of literals) expect(literal).not.toContain("?");
    });
  }
});

describe("the daily bucket", () => {
  it("upserts on the bucket rather than appending a row per call", () => {
    expect(QUERIES.record).toContain("ON CONFLICT (user_id, method, day) DO UPDATE");
  });

  it("counts calls from the row it is updating, not from the incoming one", () => {
    // EXCLUDED.calls is always 1, so reading it here would pin every bucket at
    // one call forever.
    expect(QUERIES.record).toContain("calls   = tool_usage.calls + 1");
  });

  it("counts errors from the incoming row, which is the only one that knows", () => {
    expect(QUERIES.record).toContain("errors  = tool_usage.errors + EXCLUDED.errors");
  });

  it("keeps the day's first call, so a bucket does not start at its last one", () => {
    const update = QUERIES.record.slice(QUERIES.record.indexOf("DO UPDATE"));
    expect(update).not.toContain("first_at");
  });

  it("takes its six parameters in one order", () => {
    expect(QUERIES.record.match(/\?/g)).toHaveLength(6);
    expect(QUERIES.record).toContain(
      "(user_id, method, day, calls, errors, first_at, last_at)",
    );
  });
});

describe("the report's read", () => {
  it("is a window, so it can use the day index", () => {
    expect(QUERIES.since).toContain("WHERE day >= ?");
  });

  it("aggregates per account and method rather than handing back every day", () => {
    expect(QUERIES.since).toContain("GROUP BY user_id, method");
    expect(QUERIES.since).toContain("sum(calls)");
    expect(QUERIES.since).toContain("sum(errors)");
  });

  it("carries no column that could identify a person or their work", () => {
    // The promise in docs/mcp.md is that nothing about the work itself leaves
    // the machine. A measurement query is where that gets broken by accident.
    for (const forbidden of ["body", "title", "path", "name", "email", "token"])
      expect(QUERIES.since).not.toContain(forbidden);
  });
});
