import { Pool } from "pg";

import { logError } from "../server/log";
import { TooSlow } from "../services/errors";

/**
 * Postgres over a socket pool.
 *
 * This spoke HTTP while the database was a managed service on the other side of
 * the internet: on serverless functions there was no connection to exhaust and
 * no pool to warm, so a round trip per statement was the honest shape. The
 * database now runs beside the app, so a pool is both possible and cheaper --
 * a connection is opened once and reused.
 *
 * The repositories still load in batches. That was written to survive a
 * network round trip per query and is no longer forced, but an N+1 is a bad
 * habit at any latency and the helpers already exist.
 */
let pool: Pool | null = null;

export function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and put your " +
        "Postgres connection string in it.",
    );
  }
  return url;
}

/**
 * One pool for the process.
 *
 * `max` is deliberately small: this app answers a request with several short
 * statements rather than one long one, so throughput comes from reusing a few
 * connections quickly, not from holding many open. Postgres' own default limit
 * is 100 for the whole server, and a pool per replica adds up faster than
 * people expect.
 */
function db(): Pool {
  pool ??= new Pool({
    connectionString: connectionString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // A statement that has not answered in 25s is not going to; failing the
    // request beats holding a connection that the next one needs.
    //
    // Under `maxDuration` on the agent routes (30s), deliberately. At 30 both
    // ended at the same instant, so the platform killed the function while
    // Postgres was still running the query and the connection stayed checked
    // out until the server got round to it. Ten of those exhaust a pool of ten
    // -- and `/api/health` takes a connection too, so the health check began
    // failing at exactly the moment the pool did, which reads to an
    // orchestrator as an unhealthy container and restarts a process that was
    // fine. The statement has to lose the race for the request to be the thing
    // that fails.
    statement_timeout: 25_000,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/**
 * Close the pool. For scripts, which otherwise sit with an idle connection
 * open and never exit; the server wants the pool to outlive every request.
 */
export async function disconnect(): Promise<void> {
  await pool?.end();
  pool = null;
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

/**
 * SQLSTATE `57014` is `query_canceled`, which under the `statement_timeout` set
 * above is what a statement that will not finish comes back as.
 *
 * Narrow on purpose, and exported so a test can hold it to that: the failure
 * mode of a translation like this one is widening, and a unique-violation that
 * starts reading as "your question was too big" sends the caller to fix the
 * wrong thing.
 */
export const isTimeout = (e: unknown): boolean =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "57014";

/**
 * Re-throws, naming the one failure a caller can do something about.
 *
 * The message is written for the agent that receives it, because both
 * transports hand it straight back. `search` over a whole log and
 * `activity_report` with no window are the two calls that reach 25 seconds, and
 * both have a smaller version of the same question.
 */
function rethrow(e: unknown): never {
  if (!isTimeout(e)) throw e;
  throw new TooSlow(
    "that query ran longer than the server allows and was stopped. The same call " +
      "will time out again -- ask a smaller question instead: a more specific search " +
      "term, a shorter report period, or a lower limit.",
  );
}

export async function all<T>(text: string, params: Params = []): Promise<T[]> {
  try {
    const result = await db().query(positional(text), params as unknown[]);
    return result.rows as T[];
  } catch (e) {
    rethrow(e);
  }
}

export async function one<T>(text: string, params: Params = []): Promise<T | undefined> {
  const rows = await all<T>(text, params);
  return rows[0];
}

/**
 * A write, answering how many rows it changed.
 *
 * It used to return nothing, which made a whole class of bug invisible: a
 * write scoped `WHERE id = ? AND user_id = ?` that matches no row is
 * indistinguishable from one that worked, so the caller reports success and
 * the row is untouched. `update_project` and `delete_project` did exactly
 * that to a collaborator -- the agent was told the project was deleted.
 *
 * The count is not delegated to `all()`, which projects `result.rows` and
 * drops `rowCount`; an UPDATE or DELETE without RETURNING has no rows to
 * project, so that path can only ever answer zero.
 *
 * Callers may still ignore the number. Ownership belongs in `ownership.ts`
 * and is checked before the write -- this is the second line, not the first.
 */
export async function run(text: string, params: Params = []): Promise<number> {
  try {
    const result = await db().query(positional(text), params as unknown[]);
    return result.rowCount ?? 0;
  } catch (e) {
    rethrow(e);
  }
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
 * Still a list of prepared statements rather than a callback, so no JavaScript
 * runs between them: a statement cannot use a value the previous one returned.
 * Where a write genuinely needs the id of the row just inserted, the answer is
 * one statement with a CTE, not this.
 *
 * That used to be forced by the HTTP driver and is now a deliberate shape. A
 * real BEGIN/COMMIT could take a callback and let arbitrary code run mid
 * transaction — which is exactly how a transaction ends up held open across an
 * await on something that is not the database. Callers already write to this
 * contract, `tasks.create` is a CTE because of it, and `AGENTS.md` documents
 * it; the constraint outlived its cause on purpose.
 *
 * One connection for the whole transaction, checked out explicitly: `pool.query`
 * may hand each call a different connection, which would put BEGIN and COMMIT
 * on separate sessions and silently commit nothing.
 */
export async function tx<T = unknown>(
  statements: { text: string; params?: Params }[],
): Promise<T[][]> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const results: T[][] = [];
    for (const q of statements) {
      const result = await client.query(positional(q.text), (q.params ?? []) as unknown[]);
      results.push(result.rows as T[]);
    }
    await client.query("COMMIT");
    return results;
  } catch (error) {
    // The rollback can fail too, when the connection is what broke. The
    // original error is the one the caller needs, so this one is logged rather
    // than thrown over the top of it.
    await client
      .query("ROLLBACK")
      .catch((rollbackError) => logError("db.rollbackFailed", rollbackError));
    rethrow(error);
  } finally {
    client.release();
  }
}

/** DDL and anything else that must run verbatim, without placeholders. */
export async function exec(text: string): Promise<void> {
  await db().query(text);
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
