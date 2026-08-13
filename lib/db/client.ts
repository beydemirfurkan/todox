import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Postgres over Neon's HTTP driver.
 *
 * HTTP rather than a socket pool because todox runs on serverless functions:
 * there is no connection to exhaust and no pool to warm. The cost is that
 * every call is a round trip, which is why the repositories load in batches
 * instead of per row -- an N+1 that was free against a local SQLite file is
 * genuinely slow across a network.
 */
let client: NeonQueryFunction<false, false> | null = null;

export function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and put your " +
        "Neon connection string in it.",
    );
  }
  return url;
}

function sql(): NeonQueryFunction<false, false> {
  client ??= neon(connectionString());
  return client;
}

/**
 * Queries are written with `?` placeholders and rewritten to `$1, $2, …` here.
 *
 * It keeps the SQL readable and, more importantly, keeps dynamic column lists
 * (`SET a = ?, b = ?`) simple to build. The rewrite is positional and naive,
 * so no query in this codebase may contain a literal `?` inside a string.
 */
function positional(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

export type Params = readonly unknown[];

export async function all<T>(text: string, params: Params = []): Promise<T[]> {
  return (await sql().query(positional(text), params as unknown[])) as T[];
}

export async function one<T>(text: string, params: Params = []): Promise<T | undefined> {
  const rows = await all<T>(text, params);
  return rows[0];
}

/** For statements whose result is not read. */
export async function run(text: string, params: Params = []): Promise<void> {
  await all(text, params);
}

/**
 * A statement that has not been sent yet.
 *
 * Repositories expose a `…Stmt` builder beside any write that a service may
 * need to run inside a transaction with another table's write. The SQL stays
 * with the table that owns it; only the sequencing moves.
 */
export type Statement = { text: string; params: Params };

export const runStmt = (s: Statement) => run(s.text, s.params);

/**
 * Builds a `SET a = ?, b = ?` fragment from a patch, keeping only the columns
 * named in `allowed`.
 *
 * Column names cannot be bound as parameters, so they are interpolated into
 * the SQL. That is safe only while the names come from us. Patches reach the
 * repositories from `const { id, ...patch } = params` at the RPC boundary, so
 * an unfiltered `Object.entries(patch)` puts caller-controlled text straight
 * into the statement -- `{"title = (SELECT password_hash FROM users), body":"x"}`
 * binds cleanly, because the placeholder count still matches.
 *
 * Iterating `allowed` rather than the patch's own keys is the point: an
 * unknown key cannot reach the SQL whatever it is called. Never assemble a SET
 * clause any other way.
 */
export function setClause(
  patch: Record<string, unknown>,
  allowed: readonly string[],
): { sql: string; values: unknown[] } {
  const columns = allowed.filter((c) => patch[c] !== undefined);
  return {
    sql: columns.map((c) => `${c} = ?`).join(", "),
    values: columns.map((c) => patch[c]),
  };
}

/**
 * Multiple statements, all-or-nothing, returning each one's rows.
 *
 * The driver takes a list of prepared queries rather than a callback, so no
 * JavaScript runs between them: a statement cannot use a value the previous one
 * returned. Where a write genuinely needs the id of the row just inserted, the
 * answer is one statement with a CTE, not this.
 */
export async function tx<T = unknown>(
  statements: readonly (Statement | { text: string; params?: readonly unknown[] } | undefined)[],
): Promise<T[][]> {
  const s = sql();
  const queries = statements.filter(
    (q): q is Statement | { text: string; params?: readonly unknown[] } => Boolean(q),
  );
  const results = await s.transaction(
    queries.map((q) =>
      s.query(positional(q.text), (q.params ?? []) as unknown[]),
    ),
  );
  return results as T[][];
}

/** DDL and anything else that must run verbatim, without placeholders. */
export async function exec(text: string): Promise<void> {
  await sql().query(text);
}

/** Group rows by a key, so batch loads can be handed back per parent id. */
export function groupBy<T, K extends string | number>(
  rows: T[],
  key: (row: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
}
