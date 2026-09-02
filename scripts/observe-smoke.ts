/**
 * Exercises the automatic capture path end to end: an observation is written,
 * reaches a briefing, is promoted into the curated log, and stops coming back.
 *
 * Talks to the services directly, like the other smoke suites. These are
 * server-side rules and a real Postgres is the only thing that can prove most
 * of them -- `pnpm test` runs without a database, so what it checks about this
 * feature is the *shape* of the SQL. Everything below is the behaviour.
 *
 * One of these assertions is not about behaviour at all: the EXPLAIN at the
 * end. An index Postgres cannot use fails nothing, changes no answer and
 * leaves no trace outside a query plan -- this repository has already spent a
 * day on exactly that -- so the plan is asserted here rather than hoped for in
 * production.
 */
import "./env";

import { all, one, run, tx } from "../lib/db/client";
import * as entriesRepo from "../lib/repositories/entries";
import * as observationsRepo from "../lib/repositories/observations";
import * as projectsRepo from "../lib/repositories/projects";
import * as tasksRepo from "../lib/repositories/tasks";
import * as usersRepo from "../lib/repositories/users";
import { briefing } from "../lib/services/briefing";
import { NotYours } from "../lib/services/ownership";
import { invoke } from "../lib/services/rpc";
import { hashPassword } from "../lib/util/password";
import { now } from "../lib/util/time";

const line = (s: string) => console.log(`\n--- ${s} ---`);

let failures = 0;
const expect = (label: string, pass: boolean) => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
};

const rnd = () => Math.random().toString(36).slice(2, 10);

async function makeUser(prefix: string) {
  const user = await usersRepo.create({
    username: `${prefix}-${rnd()}`,
    email: `${prefix}-${rnd()}@todox.local`,
    name: `${prefix} ${rnd()}`,
    password_hash: await hashPassword("correct-horse"),
  });
  await usersRepo.markEmailVerified(user.id);
  return (await usersRepo.byId(user.id))!;
}

const SHA = (c: string) => c.repeat(40);

/** The params the stdio observer sends, with the bits a test wants to vary. */
const observation = (over: Record<string, unknown> = {}) => ({
  session_id: `session-${rnd()}`,
  client: "claude-code",
  branch: "feat/x",
  base_sha: SHA("a"),
  head_sha: SHA("b"),
  commits: 3,
  files_changed: 7,
  commit_subjects: "fix the thing\nand the other thing",
  ...over,
});

async function main() {
  const owner = await makeUser("owner");
  const stranger = await makeUser("stranger");

  const slug = `observe-smoke-${rnd()}`;
  const project = await projectsRepo.create(owner.id, {
    name: slug,
    slug,
    summary: "throwaway",
  });

  const task = await tasksRepo.create({
    project_id: project.id,
    title: "something to promote onto",
    body: "b",
  });

  const briefFor = (userId: number) => briefing(userId, project);

  // ---------------------------------------------------------------- 1. write
  line("an observation is written and reaches the briefing");

  const written = await invoke({ userId: owner.id }, "recordObservation", {
    project: slug,
    ...observation(),
  });
  expect("the call succeeds", (written as { ok: boolean }).ok === true);
  expect(
    "and reports no earlier head, because this is the first",
    (written as { last_head_sha: string | null }).last_head_sha === null,
  );

  const first = await briefFor(owner.id);
  expect("the briefing carries it", first.observations.length === 1);
  expect("with the commit count", first.observations[0]?.commits === 3);
  expect("and the branch", first.observations[0]?.branch === "feat/x");
  expect("and nothing is omitted", first.observations_omitted === 0);
  expect(
    "and it did NOT land in the curated log",
    (await entriesRepo.listByTask(task.id)).length === 0,
  );

  // ------------------------------------------------------- 2. the last head
  line("the reply carries the last head, so a later session can widen");

  const second = await invoke({ userId: owner.id }, "recordObservation", {
    project: slug,
    ...observation({ session_id: `session-${rnd()}`, base_sha: SHA("b"), head_sha: SHA("c") }),
  });
  expect(
    "the second session is told where the first stopped",
    (second as { last_head_sha: string | null }).last_head_sha === SHA("b"),
  );

  // ---------------------------------------------------------------- 3. upsert
  line("one row per session per project");

  const sticky = `session-${rnd()}`;
  await invoke({ userId: owner.id }, "recordObservation", {
    project: slug,
    ...observation({ session_id: sticky, commits: 1 }),
  });
  await invoke({ userId: owner.id }, "recordObservation", {
    project: slug,
    ...observation({ session_id: sticky, commits: 9 }),
  });

  const rows = await all<{ commits: number }>(
    "SELECT commits FROM observations WHERE project_id = ? AND session_id = ?",
    [project.id, sticky],
  );
  expect("two writes leave one row", rows.length === 1);
  expect("carrying the newer count", rows[0]?.commits === 9);

  const racy = `session-${rnd()}`;
  await Promise.all([
    invoke({ userId: owner.id }, "recordObservation", {
      project: slug,
      ...observation({ session_id: racy, commits: 2 }),
    }),
    invoke({ userId: owner.id }, "recordObservation", {
      project: slug,
      ...observation({ session_id: racy, commits: 4 }),
    }),
  ]);
  expect(
    "and two at once still leave one",
    (
      await all("SELECT 1 FROM observations WHERE project_id = ? AND session_id = ?", [
        project.id,
        racy,
      ])
    ).length === 1,
  );

  // ------------------------------------------------------------- 4. promotion
  line("promoting one writes a real record and stops it coming back");

  const before = await briefFor(owner.id);
  const target = before.observations[0]!.id;
  const shown = before.observations.length;

  const entry = await invoke({ userId: owner.id }, "logEntry", {
    task_id: task.id,
    kind: "decision",
    body: "we kept the CTE, because tx() runs nothing between statements",
    from_observation_id: target,
  });
  expect("the entry is written", (entry as { id: number }).id > 0);
  expect(
    "in the agent's own words, not the observation's",
    (entry as { body: string }).body.includes("CTE"),
  );

  const after = await briefFor(owner.id);
  expect("the observation is gone from the briefing", after.observations.length === shown - 1);
  expect(
    "and none of the remaining ones is it",
    !after.observations.some((o) => o.id === target),
  );
  expect(
    "the entry is in the log",
    (await entriesRepo.listByTask(task.id)).some((e) => e.kind === "decision"),
  );

  line("promotion is one-way");
  const marked = await one<{ promoted_as: string }>(
    "SELECT promoted_as FROM observations WHERE id = ?",
    [target],
  );
  expect("the row records what it became", marked?.promoted_as === "decision");

  // ------------------------------------------------------- 5. somebody else's
  line("an observation belonging to somebody else");

  const strangerSlug = `stranger-${rnd()}`;
  const strangerProject = await projectsRepo.create(stranger.id, {
    name: strangerSlug,
    slug: strangerSlug,
    summary: "throwaway",
  });
  await invoke({ userId: stranger.id }, "recordObservation", {
    project: strangerSlug,
    ...observation(),
  });
  const theirs = (
    await all<{ id: number }>("SELECT id FROM observations WHERE project_id = ?", [
      strangerProject.id,
    ])
  )[0]!.id;

  const entriesBefore = (await entriesRepo.listByTask(task.id)).length;

  let refused: unknown;
  await invoke({ userId: owner.id }, "logEntry", {
    task_id: task.id,
    kind: "note",
    body: "trying to promote a row that is not mine",
    from_observation_id: theirs,
  }).catch((e) => {
    refused = e;
  });
  expect("log_entry is refused", refused instanceof NotYours);
  expect(
    "and the message does not confirm the id exists",
    String((refused as Error)?.message).includes("does not exist or is not yours"),
  );
  expect(
    "and no entry was written, so the transaction did not half-apply",
    (await entriesRepo.listByTask(task.id)).length === entriesBefore,
  );
  expect(
    "and their observation is untouched",
    (await one<{ promoted_at: string | null }>(
      "SELECT promoted_at FROM observations WHERE id = ?",
      [theirs],
    ))?.promoted_at === null,
  );

  let refusedContext: unknown;
  await invoke({ userId: owner.id }, "addContext", {
    project: slug,
    kind: "gotcha",
    title: "not mine",
    body: "b",
    from_observation_id: theirs,
  }).catch((e) => {
    refusedContext = e;
  });
  expect("add_context is refused too", refusedContext instanceof NotYours);

  expect(
    "and their observation never appears in this account's briefing",
    !(await briefFor(owner.id)).observations.some((o) => o.id === theirs),
  );

  // -------------------------------------------------------------- 6. retention
  line("retention");

  const expiring = await observationsRepo.record({
    user_id: owner.id,
    project_id: project.id,
    session_id: `expired-${rnd()}`,
    commits: 1,
    files_changed: 0,
  });
  const fresh = await one<{ expires_at: string }>(
    "SELECT expires_at FROM observations WHERE id = ?",
    [expiring.id],
  );
  expect(
    "expires_at is set from the server's clock, not the caller's",
    !!fresh && fresh.expires_at > now(),
  );

  await run("UPDATE observations SET expires_at = ? WHERE id = ?", [
    "2000-01-01T00:00:00.000Z",
    expiring.id,
  ]);
  expect(
    "an expired observation is not shown",
    !(await briefFor(owner.id)).observations.some((o) => o.id === expiring.id),
  );
  await observationsRepo.purgeExpired();
  expect(
    "and the sweep removes it",
    (await one("SELECT 1 FROM observations WHERE id = ?", [expiring.id])) === undefined,
  );

  // --------------------------------------------------------------- 7. the plan
  line("the briefing's index is one Postgres can actually use");

  /**
   * `SET LOCAL` inside the transaction, because the pool hands each query
   * whatever connection is free and a setting on one is not a setting on the
   * next. `tx` holds one connection for the whole list, which is what makes
   * this measurable at all.
   *
   * Sequential scans are turned off rather than the row count being inflated:
   * on a table this size a seq scan is the *correct* plan, so leaving the
   * planner free would prove nothing either way. What is being asserted is
   * that the index is usable -- that its shape matches the query's WHERE and
   * ORDER BY -- not that it is chosen today.
   */
  const [, plan] = await tx<{ "QUERY PLAN": string }>([
    { text: "SET LOCAL enable_seqscan = off" },
    {
      text: `EXPLAIN ${observationsRepo.QUERIES.page}`,
      params: [project.id, now(), 10],
    },
  ]);
  const explained = plan.map((r) => r["QUERY PLAN"]).join("\n");
  expect(
    "the plan names idx_observations_briefing",
    explained.includes("idx_observations_briefing"),
  );
  if (!explained.includes("idx_observations_briefing")) console.log(explained);

  // ---------------------------------------------------------------- 8. cascade
  line("nothing outlives what it belongs to");

  await run("DELETE FROM projects WHERE id = ?", [strangerProject.id]);
  expect(
    "deleting a project takes its observations",
    (await all("SELECT 1 FROM observations WHERE project_id = ?", [strangerProject.id]))
      .length === 0,
  );

  const ownerRows = await all("SELECT 1 FROM observations WHERE user_id = ?", [owner.id]);
  expect("the owner still has some to lose", ownerRows.length > 0);
  await run("DELETE FROM users WHERE id = ?", [owner.id]);
  expect(
    "deleting an account takes them too",
    (await all("SELECT 1 FROM observations WHERE user_id = ?", [owner.id])).length === 0,
  );

  await run("DELETE FROM users WHERE id = ?", [stranger.id]);

  console.log(failures === 0 ? "\nOK (cleaned up)" : `\n${failures} FAILURE(S)`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
