/**
 * The funnel, without opening psql.
 *
 * Nothing aggregated across accounts, so the only way to ask "did anybody
 * arrive this week, and did their agent come back" was a hand-written query
 * against production. That is a question worth asking after every change to the
 * landing page or the setup flow, and a question nobody asks is a change nobody
 * can tell worked.
 *
 * Read-only, and it prints no email, no username and no token. The interesting
 * numbers are counts.
 *
 *   pnpm funnel            the last 30 days
 *   pnpm funnel 7          the last 7
 */
import "./env";

import { all, one } from "../lib/db/client";

/**
 * The four steps, in the order somebody actually goes through them.
 *
 * The last one is the only one that means anything on its own. Registering is a
 * click; minting a token is a second click; a first call proves the setup
 * worked once. A token used again on a *later day* is the only evidence that
 * the habit stuck, which is the whole product claim.
 */
type Step = { step: string; n: number; note: string };

const days = () => {
  const raw = process.argv[2];
  if (raw === undefined) return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`not a number of days: ${raw}`);
    process.exit(1);
  }
  return n;
};

const count = async (sql: string, params: unknown[] = []) => {
  const row = await one<{ n: string }>(sql, params as never);
  return Number(row?.n ?? 0);
};

const pct = (part: number, whole: number) =>
  whole === 0 ? "  — " : `${String(Math.round((part / whole) * 100)).padStart(3)}%`;

async function main() {
  const window = days();
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();

  const registered = await count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", [since]);

  const minted = await count(
    `SELECT COUNT(DISTINCT u.id) AS n FROM users u
       JOIN api_tokens t ON t.user_id = u.id
      WHERE u.created_at >= ?`,
    [since],
  );

  const called = await count(
    `SELECT COUNT(DISTINCT u.id) AS n FROM users u
       JOIN api_tokens t ON t.user_id = u.id
      WHERE u.created_at >= ? AND t.last_used_at IS NOT NULL`,
    [since],
  );

  // "Came back" without a second timestamp to compare: a token first used on
  // one day and last used on a later one was used at least twice, on at least
  // two days. `created_at` is when the token was minted, which is the earliest
  // it could have been used.
  const returned = await count(
    `SELECT COUNT(DISTINCT u.id) AS n FROM users u
       JOIN api_tokens t ON t.user_id = u.id
      WHERE u.created_at >= ?
        AND t.last_used_at IS NOT NULL
        AND substr(t.last_used_at, 1, 10) > substr(t.created_at, 1, 10)`,
    [since],
  );

  const steps: Step[] = [
    { step: "registered", n: registered, note: "accounts created in the window" },
    { step: "minted a token", n: minted, note: "got as far as the Account page" },
    { step: "called once", n: called, note: "the setup actually worked" },
    { step: "came back later", n: returned, note: "the habit stuck — the number that matters" },
  ];

  console.log(`\nfunnel, last ${window} days (since ${since.slice(0, 10)})\n`);
  for (const s of steps) {
    console.log(
      `  ${s.step.padEnd(16)} ${String(s.n).padStart(5)}  ${pct(s.n, registered)}   ${s.note}`,
    );
  }

  // Which agent, because it decides where the next bit of work is worth doing:
  // a population that is all one client makes a client-specific investment
  // defensible, and a spread one makes it a trap.
  const clients = await all<{ client: string | null; n: string }>(
    `SELECT last_client_name AS client, COUNT(*) AS n
       FROM api_tokens
      WHERE last_used_at IS NOT NULL
      GROUP BY last_client_name
      ORDER BY COUNT(*) DESC`,
  );
  console.log("\nagents seen (all time, per token)\n");
  if (clients.length === 0) console.log("  none yet");
  for (const c of clients) {
    console.log(`  ${(c.client ?? "unreported").padEnd(24)} ${String(c.n).padStart(5)}`);
  }

  // What the accounts that stayed actually did. A log nobody writes to is the
  // failure mode this product is trying to avoid, so it is worth seeing.
  const written = await one<{ tasks: string; entries: string; handoffs: string; deadEnds: string }>(
    `SELECT
       (SELECT COUNT(*) FROM tasks   WHERE created_at >= ?) AS tasks,
       (SELECT COUNT(*) FROM entries WHERE created_at >= ?) AS entries,
       (SELECT COUNT(*) FROM entries WHERE created_at >= ? AND kind = 'handoff')  AS "handoffs",
       (SELECT COUNT(*) FROM entries WHERE created_at >= ? AND kind = 'dead_end') AS "deadEnds"`,
    [since, since, since, since],
  );
  console.log(`\nwritten in the window\n`);
  console.log(`  tasks            ${String(Number(written?.tasks ?? 0)).padStart(5)}`);
  console.log(`  log entries      ${String(Number(written?.entries ?? 0)).padStart(5)}`);
  console.log(`  of those, handoffs  ${String(Number(written?.handoffs ?? 0)).padStart(2)}`);
  console.log(`  of those, dead ends ${String(Number(written?.deadEnds ?? 0)).padStart(2)}\n`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
