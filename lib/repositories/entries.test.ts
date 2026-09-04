import { describe, expect, it } from "vitest";

import { HEAD_CHARS, pageByTasksPerKindSql } from "./entries";

/**
 * The briefing's log query, asserted as text.
 *
 * `pnpm test` runs without a database, so the shape of this string is the only
 * thing CI checks on every push -- and the mistakes that live here are all
 * silent ones: a placeholder inside a literal binds the wrong values, a lost
 * cast fails only at the database, a dropped window frame returns a briefing
 * with no log at all. The same argument `observations.test.ts` makes, and the
 * reason that file exists.
 *
 * Behaviour against a real Postgres is `pnpm smoke:mcp` and `pnpm bench:memory`.
 * Both are needed: the bigint/text cast below was written correctly here and
 * still failed on the first real run.
 */
const SQL = pageByTasksPerKindSql(3, 4);

/**
 * `lib/db/client.ts` rewrites `?` to `$n` positionally and does not parse
 * strings, so a question mark inside a quoted literal silently shifts every
 * parameter after it.
 *
 * Live here rather than theoretical: this is the first query in the repository
 * that wants sentence punctuation. The natural way to write a head is to split
 * the body on its first sentence, which needs `[.!?]` -- and that `?` would
 * move every parameter after it by one. The head is the first LINE for exactly
 * this reason, and `chr(10)` rather than a backslash escape because the query
 * is a template literal and JavaScript would eat the escape first.
 */
describe("no question mark inside a string literal", () => {
  it("holds for the whole query", () => {
    const literals = SQL.match(/'[^']*'/g) ?? [];
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) expect(literal).not.toContain("?");
  });

  it("splits on a character code rather than an escape", () => {
    expect(SQL).toContain("chr(10)");
    expect(SQL).not.toContain("[.!?]");
  });
});

describe("the parameters it takes", () => {
  /**
   * Two for the head, one per task, one per kind, a pair per kind for the
   * per-kind ceiling, a pair per kind for the spend priority, and one for the
   * budget. Counted rather than trusted, because a placeholder added to the
   * text without a value added to the array is the failure this rewriting
   * cannot detect -- it just binds everything one position out, silently.
   */
  it("takes exactly the placeholders the caller binds", () => {
    const placeholders = (SQL.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(2 + 3 + 4 + 4 * 2 + 4 * 2 + 1);
  });

  it("never interpolates a count into the text", () => {
    expect(SQL).not.toContain(String(HEAD_CHARS));
  });

  it("asks for every task in one statement", () => {
    expect(pageByTasksPerKindSql(50, 4)).toContain("e.task_id IN (?,?,");
    expect(pageByTasksPerKindSql(50, 4).match(/SELECT id, task_id/g)).toHaveLength(1);
  });
});

describe("the cut", () => {
  /**
   * ROW_NUMBER() is bigint and the CASE's THEN parameters carry no type, so
   * Postgres infers them from `kind`, which is text. Without the cast the
   * comparison dies with "operator does not exist: bigint <= text" -- at the
   * database, where no test that mocks this module can see it.
   */
  it("casts the per-kind ceiling to an integer", () => {
    expect(SQL).toMatch(/END\)::int/);
  });

  it("keeps an answered question out before the ceiling is applied", () => {
    // Filtering afterwards would let three answered questions push the open one
    // past the per-kind ceiling, which is the cut this window is applying.
    const inner = SQL.slice(0, SQL.indexOf(") ranked"));
    expect(inner).toContain("a.answers_entry_id = e.id");
  });

  it("ranks newest first within a task and a kind", () => {
    expect(SQL).toContain("PARTITION BY e.task_id, e.kind ORDER BY e.id DESC");
  });
});

describe("the head", () => {
  it("marks a head it had to shorten", () => {
    expect(SQL).toContain("|| '…'");
  });

  it("drops a carriage return a Windows editor left behind", () => {
    // Otherwise every head written on Windows ends in an invisible character,
    // and a head is compared and displayed, not just read.
    expect(SQL).toContain("chr(13)");
  });
});

describe("the byte budget", () => {
  /**
   * The frame is the whole design and losing it is silent.
   *
   * `1 PRECEDING` compares what every row BEFORE this one cost, so the row
   * that crosses the line is still paid for and a briefing always carries at
   * least one body. `CURRENT ROW` has a cliff: `MAX.text` allows a 100 KB
   * entry, and one of those sorting first would answer with a briefing of
   * heads and nothing else. Nothing errors either way -- the payload just
   * quietly stops carrying the log.
   */
  it("charges for what came before, not including the row itself", () => {
    expect(SQL).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
  });

  it("counts bytes, not characters", () => {
    // Half this corpus is Turkish; length() undercounts it by 10-15%.
    expect(SQL).toContain("SUM(octet_length(body))");
    expect(SQL).not.toContain("SUM(length(body))");
  });

  it("spends one budget across the whole briefing, not one per task", () => {
    // A PARTITION BY here would give every open task its own budget, so fifty
    // tasks would cost fifty budgets and the ceiling would not be a ceiling.
    const window = SQL.slice(SQL.indexOf("SUM(octet_length"), SQL.indexOf("AS spent_before"));
    expect(window).not.toContain("PARTITION BY");
  });

  /**
   * Every task's newest of a kind is paid for before any task's second-newest.
   * Pure recency lets one busy task's fresh decisions eat the budget and
   * return every dead end in the project as a head.
   */
  it("spends round robin before it spends by recency", () => {
    const window = SQL.slice(SQL.indexOf("SUM(octet_length"), SQL.indexOf("AS spent_before"));
    expect(window.indexOf("in_kind ASC")).toBeLessThan(window.indexOf("id DESC"));
  });

  it("binds the budget rather than writing it into the text", () => {
    expect(SQL).toContain("coalesce(spent_before, 0) < ?");
  });
});
