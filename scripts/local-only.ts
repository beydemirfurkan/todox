/**
 * The guard that stops a test suite writing to somebody's real database.
 *
 * This is not hypothetical. On 2026-08-15 the MCP smoke suite ran against
 * production: it left two accounts (`smoke-agent`, `smoke-intruder`), six API
 * tokens and three context notes titled SMOKE-EVERYWHERE, and nothing anywhere
 * said so. The rows were found three weeks later while reading the funnel,
 * where they had been quietly counted as two people who registered and never
 * came back -- so the one number the product is judged on, whether the habit
 * sticks, read 33% when it was really 43%.
 *
 * The suites reach the database directly rather than only over HTTP, so
 * `TODOX_URL` is the wrong thing to check: `ensureUser` calls the users
 * repository, which follows `DATABASE_URL`. A developer whose `.env.local`
 * points at the server -- the normal state for anyone who has ever debugged
 * production -- is one `pnpm smoke:mcp` away from repeating it.
 *
 * Deliberately a refusal rather than a warning. A warning scrolls past in a
 * suite that prints a hundred lines, and the damage is already done by the
 * time anybody reads it.
 */

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  // The service name a container gets on a compose or Actions network. CI runs
  // on localhost today, but a suite that refuses to run in CI is worse than no
  // guard at all, so the obvious aliases are allowed rather than discovered
  // the hard way.
  "postgres",
  "db",
]);

/** The opt-in, spelled so it cannot be set by accident or by a shell default. */
export const OVERRIDE = "TODOX_SMOKE_ALLOW_REMOTE";
const OVERRIDE_VALUE = "i-know-this-is-not-local";

/**
 * Whether a connection string points somewhere this suite may write.
 *
 * Exported for its own test: the decision is one line of parsing and one set
 * lookup, and both of them are the kind of thing that is easy to get subtly
 * wrong and impossible to notice afterwards.
 */
export function isLocalDatabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    // A URL with no host at all -- a unix socket path, say -- is not something
    // this can reason about, and "cannot tell" has to mean "do not write".
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Refuse to continue unless the database is local.
 *
 * Called at the top of every suite that creates accounts, before anything is
 * read or written.
 */
export function localDatabaseOnly(suite: string): void {
  const url = process.env.DATABASE_URL;

  if (isLocalDatabase(url)) return;

  if (process.env[OVERRIDE] === OVERRIDE_VALUE) {
    console.warn(
      `\n${suite}: writing to a non-local database because ${OVERRIDE} is set.\n` +
        `This suite creates accounts and leaves rows behind.\n`,
    );
    return;
  }

  const where = describe(url);
  console.error(
    `\n${suite} refuses to run against ${where}.\n\n` +
      `It creates accounts, tokens and notes, and it does not clean up after\n` +
      `itself completely. Running it against a database people use leaves rows\n` +
      `that look like real signups -- which is how the funnel came to under-\n` +
      `report retention by ten points for three weeks.\n\n` +
      `Point DATABASE_URL at a local Postgres:\n\n` +
      `  docker run -d --name todox-pg -p 5432:5432 \\\n` +
      `    -e POSTGRES_PASSWORD=todox -e POSTGRES_USER=todox \\\n` +
      `    -e POSTGRES_DB=todox postgres:18\n\n` +
      `If you genuinely mean to write to this one, set\n` +
      `  ${OVERRIDE}=${OVERRIDE_VALUE}\n`,
  );
  process.exit(1);
}

/** The host, and nothing else: a connection string carries a password. */
function describe(url: string | undefined): string {
  if (!url) return "no DATABASE_URL at all";
  try {
    return new URL(url).hostname;
  } catch {
    return "a DATABASE_URL that is not a URL";
  }
}
