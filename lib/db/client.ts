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

/** Multiple statements, all-or-nothing. */
export async function tx(statements: { text: string; params?: Params }[]) {
  const s = sql();
  await s.transaction(
    statements.map((q) => s.query(positional(q.text), (q.params ?? []) as unknown[])),
  );
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
