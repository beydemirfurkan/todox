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
