/**
 * The text a row is searched by, written once because two places have to agree
 * on it character for character.
 *
 * Postgres only uses an expression index when the expression in the query
 * matches the one the index was built on. A mismatch is not an error and not a
 * warning: the index is silently ignored, the answer is identical, and the only
 * thing that changes is that the query got slow again. Nothing in a test suite
 * catches that -- `EXPLAIN` is the only witness -- which is exactly why the
 * expression does not get typed twice. `schema.ts` builds the indexes from
 * these functions and `services/search.ts` builds its `WHERE` from them, so
 * the two cannot drift apart without a compile error.
 *
 * This module deliberately holds no queries and touches no connection. It is
 * shared vocabulary, and `schema.ts` is where the SQL is.
 */

/**
 * Two configurations, because this log is written in two languages.
 *
 * There is no single one that works. `simple` does not stem at all, so
 * `kararların` does not match `karar` and `deploys` does not match `deploy`.
 * `english` stems the English half and leaves the Turkish alone; `turkish`
 * does the reverse -- both ship with Postgres, and picking either would halve
 * the corpus. So each document is indexed under both and a query is asked of
 * both.
 */
export const CONFIGS = ["english", "turkish"] as const;

export type FtsConfig = (typeof CONFIGS)[number];

/**
 * The columns that make up each searchable table's document.
 *
 * An entry has only a body; its title in a result is borrowed from the task it
 * hangs off, which is a join and therefore cannot be part of a single-table
 * index expression.
 */
export const SEARCHED = {
  tasks: ["title", "body"],
  entries: ["body"],
  contexts: ["title", "body"],
} as const;

export type SearchedTable = keyof typeof SEARCHED;

/**
 * One document from several columns, with `coalesce` because a NULL anywhere in
 * a concatenation makes the whole document NULL -- and `tasks.body` is
 * nullable, so without it every task that is only a title would be unsearchable.
 *
 * `alias` is what the query calls the table (`t`, `e`, `c`); the index is
 * created without one. Both forms resolve to the same attribute of the same
 * relation, so Postgres matches them -- the alias is not part of what has to
 * agree, but the column list and the separator are.
 */
export function document(table: SearchedTable, alias = ""): string {
  const qualify = (column: string) => (alias ? `${alias}.${column}` : column);
  return SEARCHED[table].map((c) => `coalesce(${qualify(c)}, '')`).join(` || ' ' || `);
}

/**
 * The config is interpolated rather than bound, and has to be: a text search
 * configuration cannot be a parameter, and `to_tsvector(text, text)` -- the
 * two-argument form with the config spelled out -- is the only one that is
 * IMMUTABLE and therefore the only one an index can be built on. The values
 * come from `CONFIGS` above and never from a caller.
 */
export const vector = (config: FtsConfig, doc: string): string =>
  `to_tsvector('${config}', ${doc})`;

/**
 * The parsed query, four ways, as the columns of a one-row CTE.
 *
 * Every caller names that CTE `q`, which is what `matches` and `rank` below
 * assume. The placeholders live in `TSQUERY_FROM`, and there are two of them:
 * the caller's raw query string, twice.
 *
 * Four columns because matching and ranking want different things. `en`/`tr`
 * are built from the stopword-stripped text and decide *whether* a row is a
 * hit; `en_all`/`tr_all` are built from the original and decide *where* it
 * sorts. Stripping is what makes the match mean something (see `TSQUERY_FROM`),
 * but it also shuffles the ranking, and that shuffle cost a question its place
 * in the top five when both were built the same way -- measured, and the reason
 * this is four columns rather than two. Ranking on everything the caller typed
 * is also the more honest of the two: a stopword contributes almost nothing to
 * `ts_rank`, so keeping it changes the order only where it was already close.
 *
 * `websearch_to_tsquery` is the parser that understands what a person types --
 * quoted phrases, `or`, a leading minus -- and never raises on malformed input,
 * which `to_tsquery` does. A search box that can be made to 500 is a search box
 * that will be.
 *
 * What it does not do is answer a question: it joins every term with AND, so
 * "why did we choose scrypt instead of bcrypt" only matches a document holding
 * *all* of `choos`, `scrypt`, `instead`, `bcrypt` -- and the note that answers
 * it contains two of them. Measured: 2 of 24 questions. So the conjunctions are
 * rewritten to disjunctions and `ts_rank` is left to do the ordering, which is
 * what it is for. Phrase operators from quoted input are `<->` and are
 * untouched, so "an exact phrase" still means one.
 *
 * Rewritten through `::text` because tsquery has no operator-swapping function.
 * Narrow, and safe: the value being rewritten is the *parser's own output*, not
 * the caller's string, so nothing user-supplied can change the shape of it.
 */
export const TSQUERY = `replace(websearch_to_tsquery('english', cleaned.text)::text, ' & ', ' | ')::tsquery AS en,
         replace(websearch_to_tsquery('turkish', cleaned.text)::text, ' & ', ' | ')::tsquery AS tr,
         replace(websearch_to_tsquery('english', cleaned.raw)::text, ' & ', ' | ')::tsquery AS en_all,
         replace(websearch_to_tsquery('turkish', cleaned.raw)::text, ' & ', ' | ')::tsquery AS tr_all`;

/**
 * Where `TSQUERY` reads its text from, and the reason it is not just `?`.
 *
 * A word that one language treats as noise is a word the other treats as
 * content, and asking both configurations at once meant the noise won. `why`,
 * `is`, `on` and `a` are not Turkish stopwords, so
 * `websearch_to_tsquery('turkish', 'why is search slow on a big log')` keeps
 * all four; the conjunction-to-disjunction rewrite above then turns them into
 * an OR, and every document containing the word "a" is a match. Measured on
 * 5,000 notes: 5,000 of them matched, and the planner was right to ignore the
 * index for it.
 *
 * Recall never noticed, which is why this survived two rounds of measuring it.
 * The right row was still in the top five, because `ts_rank` scores a stopword
 * hit near zero. What recall does not say is how much came back *with* it, and
 * that is where this shows: five questions about subjects the corpus has never
 * heard of returned **107 records** between them, every one of them matched on
 * a word like "a". After stripping, 2 -- with recall unchanged at 16/24 and
 * 18/24. `pnpm bench:memory` reports both numbers now, because a log that
 * answers a question it cannot answer is worse than one that says nothing: the
 * agent has no way to tell the difference and every reason to trust it.
 *
 * Speed is the smaller half of it and honesty requires saying so. `EXPLAIN`
 * goes from a sequential scan to a `Bitmap Index Scan` on both configurations,
 * which is what makes the indexes in `schema.ts` worth having at all; end to
 * end on the corpora measured here the wall clock barely moved, because the
 * substring arm is still a sequential scan (todox #163) and `ts_debug` costs
 * about 4ms of its own.
 *
 * So a token that either configuration calls a stopword is dropped before
 * either query is built. `ts_debug` is the only thing that will say which those
 * are, and it emits *every* token including whitespace and punctuation, so
 * reassembling the ones that survive gives back the original string minus the
 * noise -- quotes, hyphens and all. That matters: the rest of the query's
 * syntax is a documented feature, and tokenising it away to strip four words
 * would cost phrases and negation to buy speed.
 *
 * `WITH ORDINALITY` rather than `row_number()`: the two calls have to line up
 * token for token, and while both parse the same text with the same
 * configuration-independent parser, "the rows will come back in the same order"
 * is an assumption where an ordinal is a guarantee.
 *
 * One known cost, and it is small: a stopword inside a quoted phrase is removed
 * rather than kept as a positional gap, so `"an exact phrase"` matches `exact
 * <-> phrase` instead of `exact <2> phrase`. Looser, in a search that is
 * deliberately loose everywhere else.
 */
export const TSQUERY_FROM = `FROM (
           SELECT coalesce(string_agg(eng.token, '' ORDER BY eng.ord)
                             FILTER (WHERE (eng.lexemes IS NULL OR eng.lexemes <> '{}')
                                       AND (tur.lexemes IS NULL OR tur.lexemes <> '{}')), '') AS text,
                  coalesce(string_agg(eng.token, '' ORDER BY eng.ord), '') AS raw
             FROM ts_debug('english', ?) WITH ORDINALITY AS eng(alias, description, token, dictionaries, dictionary, lexemes, ord)
             JOIN ts_debug('turkish', ?) WITH ORDINALITY AS tur(alias, description, token, dictionaries, dictionary, lexemes, ord)
               ON tur.ord = eng.ord
         ) cleaned`;

/** Does this document match either way of asking? Needs `q` in scope. */
export const matches = (doc: string): string =>
  `(${vector("english", doc)} @@ q.en OR ${vector("turkish", doc)} @@ q.tr)`;

/**
 * How well it matches, taking the better of the two configurations. Needs `q`
 * in scope. Zero for a document that matches neither, which is what lets a
 * ranked ordering fall back to whatever it was sorted by before.
 */
export const rank = (doc: string): string =>
  `greatest(ts_rank(${vector("english", doc)}, q.en_all), ts_rank(${vector("turkish", doc)}, q.tr_all))`;

/** `idx_tasks_fts_english` and its five siblings, named the same way twice. */
export const indexName = (table: SearchedTable, config: FtsConfig): string =>
  `idx_${table}_fts_${config}`;

/**
 * The six GIN indexes, generated so that adding a searchable column to
 * `SEARCHED` above rebuilds them rather than leaving them describing the old
 * document.
 *
 * `IF NOT EXISTS` like everything else in the schema, and not `CONCURRENTLY`:
 * `db:migrate` is a deliberate deploy step that runs statements in a batch, and
 * `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
 */
export const FTS_INDEXES: string = (Object.keys(SEARCHED) as SearchedTable[])
  .flatMap((table) =>
    CONFIGS.map(
      (config) =>
        `CREATE INDEX IF NOT EXISTS ${indexName(table, config)}\n` +
        `  ON ${table} USING GIN (${vector(config, document(table))});`,
    ),
  )
  .join("\n");
