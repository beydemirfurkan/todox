import { describe, expect, it } from "vitest";

import { MIN_SUBSTRING_CHARS, SEARCHED, TRGM_INDEXES, TSQUERY } from "../db/fts";
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
 * The substring arm's witness, held the same way. A trigram index is not an
 * expression index, so nothing here has to match character for character --
 * but the index is per column, and a column the predicate reads without an
 * index of its own is a sequential scan that fails nothing. Both lists come
 * from `SEARCHED`; this asserts they still do.
 */
describe("the substring arm has a trigram index per column it reads", () => {
  for (const table of TABLES) {
    it(`${table}: one ILIKE per searched column, each indexed`, () => {
      const columns = [...QUERIES[table].matchAll(/\b[a-z]\.([a-z_]+) ILIKE q\.pat/g)].map(
        (m) => m[1],
      );
      expect(columns).toEqual([...SEARCHED[table]]);
      for (const column of columns)
        expect(TRGM_INDEXES).toContainEqual(
          expect.stringContaining(`ON ${table} USING GIN (${column} gin_trgm_ops)`),
        );
    });
  }

  /**
   * The indexes need an extension the schema cannot assume, so `migrate()`
   * runs them on their own after trying to create it. Splicing them into
   * `SCHEMA` would make every self-hosted `db:migrate` without `pg_trgm` fail
   * at the first of them -- and, being the last statements, silently after
   * every table had already been created.
   */
  it("keeps the trigram indexes out of the schema string", () => {
    expect(SCHEMA).not.toContain("gin_trgm_ops");
    expect(SCHEMA).not.toContain("pg_trgm");
    expect(TRGM_INDEXES).toHaveLength(
      TABLES.reduce((n, table) => n + SEARCHED[table].length, 0),
    );
  });
});

/**
 * `lib/db/client.ts` rewrites `?` to `$n` positionally, and all three queries
 * are handed the *same* array. An extra placeholder in one of them does not
 * fail to compile and does not fail to run -- it shifts every parameter after
 * it, so the search runs as somebody else's user id.
 */
describe("all three queries take the same parameters", () => {
  const placeholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

  it("seven, in the same order, everywhere", () => {
    for (const table of TABLES) expect(placeholders(QUERIES[table])).toBe(7);
  });
});

/**
 * Two ways a short or empty query used to leak through.
 *
 * The snippet was highlighted against the raw query with the `simple`
 * configuration, which has no stopword list: every "of" in the document was
 * bolded and the densest fragment in function words won. And the substring
 * arm ran `ILIKE '%of%'` for a query that, stripped, was nothing -- every row
 * containing those two letters, scored zero, filling the limit. Both are
 * fixed at the source of the query text, so this asserts the SQL reads it.
 */
describe("what a short or stopword-only query may not do", () => {
  it("exposes the stripped query as a column of q", () => {
    expect(TSQUERY).toMatch(/cleaned\.text AS text/);
  });

  for (const table of TABLES) {
    it(`${table}: highlights against the stripped query, never the raw one`, () => {
      expect(QUERIES[table]).toContain("plainto_tsquery('simple', q.text)");
      expect(QUERIES[table]).not.toContain("plainto_tsquery('simple', ?)");
      // The outer select has to be able to see q for that to work.
      expect(QUERIES[table]).toMatch(/FROM top CROSS JOIN q\b/);
    });

    it(`${table}: turns the substring arm off under ${MIN_SUBSTRING_CHARS} stripped characters`, () => {
      expect(QUERIES[table]).toContain(
        `CASE WHEN length(btrim(cleaned.text)) >= ${MIN_SUBSTRING_CHARS} THEN ?::text END AS pat`,
      );
    });
  }
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
