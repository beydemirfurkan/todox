/**
 * What an agent actually reached for, without opening psql.
 *
 * `pnpm funnel` measures everything up to the first call: an account arrived, a
 * token was minted, the setup worked once, the agent came back on a later day.
 * It cannot see inside a session, and the inside of a session is where the
 * expensive question lives -- two accounts in production keep calling the API
 * and have written nothing for weeks.
 *
 * This answers that one question and does not try to answer others. Read-only,
 * and it prints no email, no username, no project and no path: a method name
 * and a count.
 *
 *   pnpm usage             the last 30 days
 *   pnpm usage 7           the last 7
 */
import "./env";

import * as toolUsage from "../lib/repositories/tool-usage";
import type { MethodName } from "../lib/services/rpc-schemas";

/**
 * What a call meant, which is not the same as what it did to the database.
 *
 * `automatic` is the distinction that makes this script worth running. The
 * stdio process fires `recordObservation` and `recordClientInfo` for itself,
 * and `reportRefs` is the client answering a question it was asked -- none of
 * them are an agent deciding to write something down. Counting them as writes
 * would show a healthy write rate for exactly the account that has written
 * nothing, which is the failure this exists to find.
 *
 * `satisfies Record<MethodName, Kind>` rather than a lookup with a default: a
 * new method has to be classified here or `tsc --noEmit` fails, and CI runs it.
 * A silent default is how a new write ends up counted as a read.
 */
type Kind = "read" | "write" | "automatic";

const KIND = {
  getContext: "read",
  getContextNote: "read",
  getTask: "read",
  getFileContext: "read",
  listTasks: "read",
  listProjects: "read",
  search: "read",
  activityReport: "read",

  createTask: "write",
  updateTask: "write",
  logEntry: "write",
  addContext: "write",
  updateContext: "write",
  deleteContext: "write",
  deleteEntry: "write",
  createProject: "write",
  updateProject: "write",
  deleteProject: "write",
  mergeProjects: "write",
  linkFiles: "write",
  unlinkRef: "write",
  acceptRef: "write",

  recordObservation: "automatic",
  recordClientInfo: "automatic",
  reportRefs: "automatic",
} satisfies Record<MethodName, Kind>;

const kindOf = (method: string): Kind | "unknown" =>
  method in KIND ? KIND[method as MethodName] : "unknown";

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

const pad = (n: number, width = 6) => String(n).padStart(width);

async function main() {
  const window = days();
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await toolUsage.since(since);

  console.log(`\ntool usage, last ${window} days (since ${since})\n`);

  if (rows.length === 0) {
    console.log("  nothing counted yet.\n");
    console.log("  If the table was added after these calls were made, that is");
    console.log("  expected: nothing is backfilled, because nothing was kept.\n");
    process.exit(0);
  }

  const accounts = [...new Set(rows.map((r) => r.user_id))];

  for (const userId of accounts) {
    const mine = rows.filter((r) => r.user_id === userId);
    const total = (kind: Kind) =>
      mine.filter((r) => kindOf(r.method) === kind).reduce((sum, r) => sum + Number(r.calls), 0);

    const reads = total("read");
    const writes = total("write");
    const errors = mine.reduce((sum, r) => sum + Number(r.errors), 0);
    const last = mine.reduce((latest, r) => (r.last_at > latest ? r.last_at : latest), "");

    console.log(`  account ${userId}   last call ${last.slice(0, 10)}`);
    console.log(
      `    reads ${pad(reads)}   writes ${pad(writes)}   errors ${pad(errors)}`,
    );

    // The one line this script exists to print.
    if (reads > 0 && writes === 0)
      console.log(
        `    ^ read ${reads} times and wrote nothing.` +
          (errors > 0 ? ` ${errors} calls were refused.` : " Nothing was refused."),
      );

    for (const r of [...mine].sort((a, b) => Number(b.calls) - Number(a.calls))) {
      const marker = kindOf(r.method) === "automatic" ? "·" : " ";
      const failed = Number(r.errors) > 0 ? `   ${r.errors} refused` : "";
      console.log(`    ${marker} ${r.method.padEnd(20)} ${pad(Number(r.calls))}${failed}`);
    }
    console.log("");
  }

  console.log("  · marks a call the client makes for itself, not an agent writing.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
