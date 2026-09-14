/**
 * What search promises about its own query plans, and one thing about its
 * answers.
 *
 * The full-text arm has six GIN indexes and the substring arm has five
 * trigram ones, and none of them can fail a test by not being used: Postgres
 * ignores an index it cannot match, the answer stays byte for byte the same,
 * and the only trace is `EXPLAIN`. This repository has spent a day on exactly
 * that before (`services/search.ts` tells the story), so the plan is asserted
 * here rather than hoped for in production.
 *
 * Two of the five may legitimately be missing. The trigram indexes need
 * `pg_trgm`, which `migrate()` creates where it can and reports where it
 * cannot; on a database without it this suite says SKIP for that half and
 * passes, because a sequential scan there is the documented behaviour rather
 * than a regression. CI runs `postgres:18`, which has the extension, so the
 * indexed path is what CI proves.
 */
import "./env";

import { localDatabaseOnly } from "./local-only";

localDatabaseOnly("smoke:search");

import { one, run, tx } from "../lib/db/client";
import {
  CONFIGS,
  document,
  indexName,
  matches,
  SEARCHED,
  substring,
  trgmIndexName,
  TSQUERY,
  TSQUERY_FROM,
  type SearchedTable,
} from "../lib/db/fts";
import * as contextsRepo from "../lib/repositories/contexts";
import * as entriesRepo from "../lib/repositories/entries";
import * as projectsRepo from "../lib/repositories/projects";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import { escapeLike, search } from "../lib/services/search";
import { hashPassword } from "../lib/util/password";

const line = (s: string) => console.log(`\n--- ${s} ---`);

let failures = 0;
const expect = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

const rnd = () => Math.random().toString(36).slice(2, 10);

/** What the queries call each table, so the probe below reads as they do. */
const ALIAS: Record<SearchedTable, string> = { tasks: "t", entries: "e", contexts: "c" };

/**
 * The plan for one arm of one table's search, with sequential scans off.
 *
 * One arm on its own rather than the whole query, and the reason is what the
 * whole query's plan looks like on a table this size: the ownership joins
 * bring their own indexes, and with seq scans off the planner reaches for
 * `idx_contexts_user` and filters, which proves nothing about the search
 * indexes either way. The probe keeps exactly what matters -- the predicate
 * `search.ts` builds from `db/fts.ts`, fed from a one-row CTE named `q` the
 * way the real query feeds it -- and drops the joins that compete. What is
 * asserted is that the index is usable for that predicate; whether it is
 * chosen on a real corpus is `pnpm bench:memory`'s question.
 *
 * `SET LOCAL` inside the transaction because the pool hands each query
 * whatever connection is free; `tx` holds one for the whole list.
 */
async function planFor(
  table: SearchedTable,
  bindings: string,
  where: string,
  params: unknown[],
): Promise<string> {
  const alias = ALIAS[table];
  const [, rows] = await tx<{ "QUERY PLAN": string }>([
    { text: "SET LOCAL enable_seqscan = off" },
    {
      text: `EXPLAIN WITH q AS (SELECT ${bindings})
             SELECT ${alias}.id FROM q CROSS JOIN ${table} ${alias} WHERE ${where}`,
      params,
    },
  ]);
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

const fullTextPlan = (table: SearchedTable, query: string) =>
  planFor(table, `${TSQUERY} ${TSQUERY_FROM}`, matches(document(table, ALIAS[table])), [
    query,
    query,
  ]);

const substringPlan = (table: SearchedTable, query: string) =>
  planFor(table, "?::text AS pat", substring(table, ALIAS[table]), [`%${escapeLike(query)}%`]);

async function main() {
  const user = await usersRepo.create({
    username: `search-smoke-${rnd()}`,
    email: `search-smoke-${rnd()}@todox.local`,
    name: "search smoke",
    password_hash: await hashPassword("correct-horse"),
  });
  await usersRepo.markEmailVerified(user.id);

  const slug = `search-smoke-${rnd()}`;
  const project = await projectsRepo.create(user.id, { name: slug, slug, summary: "throwaway" });
  const marker = `zq${rnd()}`;
  const task = await tasksRepo.create({
    project_id: project.id,
    title: `rewrite the SET builder to use setClause${marker}`,
    body: "the patch's own keys reached the statement",
  });
  const entry = await entriesRepo.create({
    task_id: task.id,
    kind: "decision",
    body: `iterate COLUMNS, never the patch: setClause${marker} is the only builder`,
  });
  const note = await contextsRepo.create({
    user_id: user.id,
    project_id: project.id,
    kind: "convention",
    title: `never build a SET clause by hand (setClause${marker})`,
    body: "column names cannot be bound, so they are interpolated from an allow-list",
  });

  // ------------------------------------------------------------- 1. answers
  line("an identifier is found by its middle, which only the substring arm can do");

  const hits = await search(user.id, `Clause${marker}`);
  const found = (type: string, id: number) => hits.some((h) => h.type === type && h.id === id);
  expect("the task", found("task", task.id));
  expect("the entry", found("entry", entry.id));
  expect("the note", found("context", note.id));

  // --------------------------------------------------------------- 2. plans
  const trigram = await one("SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'");
  line(`the plans name their indexes (pg_trgm ${trigram ? "installed" : "absent"})`);

  for (const table of Object.keys(SEARCHED) as SearchedTable[]) {
    const fullText = await fullTextPlan(table, "setClause");
    let mismatch = false;
    for (const config of CONFIGS) {
      const name = indexName(table, config);
      const used = fullText.includes(name);
      mismatch ||= !used;
      expect(`${table}: full-text arm can use ${name}`, used);
    }
    if (mismatch) console.log(fullText);

    if (!trigram) {
      for (const column of SEARCHED[table])
        console.log(`SKIP  ${table}: ${trgmIndexName(table, column)} -- extension absent, sequential scan`);
      continue;
    }
    const sub = await substringPlan(table, "setClause");
    mismatch = false;
    for (const column of SEARCHED[table]) {
      const name = trgmIndexName(table, column);
      const used = sub.includes(name);
      mismatch ||= !used;
      expect(`${table}: substring arm can use ${name}`, used);
    }
    if (mismatch) console.log(sub);
  }

  // ------------------------------------------------------------- 3. cleanup
  await run("DELETE FROM users WHERE id = ?", [user.id]);
  expect(
    "deleting the account takes the project and everything under it",
    (await one("SELECT 1 AS present FROM projects WHERE id = ?", [project.id])) === undefined,
  );

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
