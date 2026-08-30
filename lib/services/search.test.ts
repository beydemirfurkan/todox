import { describe, expect, it } from "vitest";

import { SCHEMA } from "../db/schema";
import { escapeLike, QUERIES } from "./search";

/**
 * The query went into `%…%` and straight to ILIKE. Two characters in that
 * string mean something to ILIKE and nothing to the person typing them, so a
 * search for either matched every row in the account, and a search for a
 * literal one found nothing at all.
 */
describe("escapeLike", () => {
  it("escapes the wildcards", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("100%_sure")).toBe("100\\%\\_sure");
  });

  it("escapes the escape character itself, or the next one gets away", () => {
    expect(escapeLike("a\\%b")).toBe("a\\\\\\%b");
  });

  it("leaves an ordinary query alone", () => {
    expect(escapeLike("neon timeout")).toBe("neon timeout");
    expect(escapeLike("useEffect()")).toBe("useEffect()");
    // Turkish is the default language here; none of it is a wildcard.
    expect(escapeLike("şifre sıfırlama")).toBe("şifre sıfırlama");
  });
});

const TABLES = ["tasks", "entries", "contexts"] as const;

/**
 * Every `to_tsvector('cfg', …)` the query asks for, alias stripped so it can be
 * compared with the index, which is built without one.
 *
 * Balanced by counting rather than by regex: the documents are nested
 * `coalesce(…)` calls, and a pattern that stops at the first `)` compares a
 * prefix — which passes for two expressions that differ only in their tail.
 */
function vectorsIn(sql: string): string[] {
  const out: string[] = [];
  for (const config of ["english", "turkish"]) {
    const open = `to_tsvector('${config}', `;
    for (let at = sql.indexOf(open); at !== -1; at = sql.indexOf(open, at + 1)) {
      let depth = 0;
      let end = at + open.length - 2;
      do {
        depth += sql[end] === "(" ? 1 : sql[end] === ")" ? -1 : 0;
        end++;
      } while (depth > 0 && end < sql.length);
      out.push(sql.slice(at, end).replace(/\bcoalesce\([a-z]\./g, "coalesce("));
    }
  }
  return out;
}

/**
 * The failure this catches does not fail.
 *
 * Postgres uses an expression index only when the query's expression matches
 * the one the index was built on. A mismatch is not an error and not a
 * warning: the index is ignored, the answer is byte-for-byte identical, and
 * the only thing that changes is that search is slow again -- 5.7 seconds
 * rather than 0.16 on the corpus this was measured against. `EXPLAIN` is the
 * only other witness, and nobody runs `EXPLAIN` on a green test suite.
 *
 * Both sides are generated from `db/fts.ts` so they cannot drift by accident.
 * This asserts the generated strings actually agree, which is the part a
 * shared helper does not prove on its own -- somebody hand-writing either an
 * index or a `WHERE` is exactly how this gets undone.
 */
describe("the index and the query ask for the same expression", () => {
  for (const table of TABLES) {
    it(`${table}: every vector it matches on is indexed`, () => {
      const vectors = vectorsIn(QUERIES[table]);
      // english and turkish, in both `MATCHES` and `RANK`.
      expect(vectors.length).toBeGreaterThanOrEqual(4);
      for (const vector of new Set(vectors)) expect(SCHEMA).toContain(vector);
    });
  }

  it("indexes both configurations for every searchable table", () => {
    for (const table of TABLES)
      for (const config of ["english", "turkish"])
        expect(SCHEMA).toContain(`idx_${table}_fts_${config}`);
  });
});

/**
 * `lib/db/client.ts` rewrites `?` to `$n` positionally, and all three queries
 * are handed the *same* six-element array. A seventh placeholder in one of them
 * does not fail to compile and does not fail to run -- it shifts every
 * parameter after it, so the search runs as somebody else's user id.
 */
describe("all three queries take the same parameters", () => {
  const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

  it("six, in the same order, everywhere", () => {
    for (const table of TABLES) expect(placeholders(QUERIES[table])).toBe(6);
  });
});

/**
 * The rule that has teeth: ownership is asserted in *both* arms of the union.
 *
 * Dropping it from one leaks nothing -- the union feeds a join that re-derives
 * the row -- so no test of the results would notice. What it does is make every
 * account's search scan every other account's rows, which shows up as a slow
 * query on somebody else's machine long after the change.
 */
describe("both arms are scoped to the reader", () => {
  const OWNERSHIP = {
    tasks: "WHERE (p.user_id = q.uid OR pm.user_id IS NOT NULL)",
    entries: "WHERE (p.user_id = q.uid OR pm.user_id IS NOT NULL)",
    contexts: "WHERE (c.project_id IS NULL AND c.user_id = q.uid",
  } as const;

  for (const table of TABLES) {
    it(`${table}: twice, once per arm`, () => {
      expect(QUERIES[table].split(OWNERSHIP[table])).toHaveLength(3);
    });
  }

  it("keeps the two arms apart, which is what lets the index be used", () => {
    // One `OR` spanning full-text and ILIKE is what the union replaced: a
    // single un-indexable branch makes the whole disjunction un-indexable.
    for (const table of TABLES) {
      expect(QUERIES[table]).toContain("UNION ALL");
      expect(QUERIES[table]).not.toMatch(/@@ q\.(en|tr)[^)]*\bILIKE\b/);
    }
  });
});

/**
 * Matching and ranking read different columns, and it is not an accident.
 *
 * `en`/`tr` come from the stopword-stripped query and decide whether a row is
 * a hit; `en_all`/`tr_all` come from what the caller actually typed and decide
 * where it sorts. Collapsing them back to one pair is the obvious tidy-up and
 * it costs one of two things depending on which pair survives: the stripped one
 * shuffles the ranking and drops a question out of the top five, and the raw
 * one brings back the defect this split exists for -- five questions the corpus
 * cannot answer returning 107 records between them, every one matched on the
 * word "a". Neither failure is visible in a passing test suite, so this is the
 * guard.
 */
describe("the query it matches on is not the query it ranks by", () => {
  for (const table of TABLES) {
    it(`${table}: matches on the stripped query, ranks on the whole one`, () => {
      expect(QUERIES[table]).toMatch(/@@ q\.en\b/);
      expect(QUERIES[table]).toMatch(/@@ q\.tr\b/);
      expect(QUERIES[table]).toContain("q.en_all");
      expect(QUERIES[table]).toContain("q.tr_all");
      // The match must never read the unstripped query.
      expect(QUERIES[table]).not.toMatch(/@@ q\.(en|tr)_all/);
    });

    it(`${table}: strips the stopwords before either is built`, () => {
      // Without this the two pairs are the same query twice over.
      expect(QUERIES[table]).toContain("ts_debug('english'");
      expect(QUERIES[table]).toContain("ts_debug('turkish'");
      expect(QUERIES[table]).toContain("WITH ORDINALITY");
    });
  }
});
