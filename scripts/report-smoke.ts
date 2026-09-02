/**
 * Proves the reporting path end to end: a task moves through statuses, the
 * events land, and the report reconstructs duration, model and importance.
 */
import "./env";

import { localDatabaseOnly } from "./local-only";

localDatabaseOnly("smoke:report");

import { run } from "../lib/db/client";
import { translator } from "../lib/i18n";
import * as entriesRepo from "../lib/repositories/entries";
import * as eventsRepo from "../lib/repositories/events";
import * as projectsRepo from "../lib/repositories/projects";
import * as usersRepo from "../lib/repositories/users";
import * as tasksRepo from "../lib/repositories/tasks";
import { renderMarkdown } from "../lib/services/report-markdown";
import { activityReport, timingFor } from "../lib/services/reports";
import * as taskService from "../lib/services/task-service";
import { resolvePeriod } from "../lib/util/time";

const MODEL = "claude-opus-5";

/**
 * Most of this file prints what happened and lets a reader judge it. These two
 * cannot be judged by reading: both failures produce a report that looks
 * entirely normal and is quietly wrong, so they have to fail the run.
 */
function assert(claim: boolean, what: string) {
  console.log(`${claim ? "PASS" : "FAIL"}  ${what}`);
  if (!claim) throw new Error(what);
}

async function main() {
const user = await usersRepo.byUsername("demo");
if (!user) throw new Error("run `pnpm seed` first: this check needs the demo account");

const project =
  (await projectsRepo.bySlug(user.id, "report-smoke")) ??
  (await projectsRepo.create(user.id, { name: "report smoke", slug: "report-smoke" }));

const task = await taskService.create({
  project_id: project.id,
  title: "REPORT-SMOKE: measure a task from start to finish",
  body: "Should show up as completed, with a duration and a model.",
  priority: 1,
  model: MODEL,
});

await taskService.update(task.id, { status: "doing" }, { model: MODEL });
await taskService.addEntry({
  task_id: task.id,
  kind: "decision",
  body: "REPORT-SMOKE: chose the event-log approach over inferring from updated_at.",
  model: MODEL,
});
await taskService.addEntry({
  task_id: task.id,
  kind: "dead_end",
  body: "REPORT-SMOKE: deriving duration from updated_at — every edit reset it.",
  model: MODEL,
});
await taskService.update(task.id, { status: "done" }, { model: MODEL });

const events = await eventsRepo.listByTask(task.id);
console.log("events:", events.map((e) => `${e.from_status ?? "-"}>${e.to_status}`).join(" "));

const timing = timingFor((await tasksRepo.byId(task.id))!, events);
console.log("started_at set:", Boolean(timing.started_at));
console.log("closed_at set:", Boolean(timing.closed_at));
console.log("active_ms is a number:", typeof timing.active_ms === "number");
console.log("lead_ms is a number:", typeof timing.lead_ms === "number");

const report = await activityReport(user.id, resolvePeriod("today"));
const row = report.completed.find((r) => r.id === task.id);
console.log("\nappears in today's completed:", Boolean(row));
console.log("importance:", row?.importance);
console.log("models:", row?.models);
console.log("dead ends captured:", row?.dead_ends.length);
console.log("by_model:", report.by_model.filter((m) => m.model === MODEL));

console.log("\n--- markdown (tr) ---");
console.log(
  renderMarkdown(report, translator("tr"))
    .split("\n")
    .slice(0, 14)
    .join("\n"),
);

console.log("\n--- a task that opens already finished still counts as finished ---");
// `create_task` takes a status, and an agent recording work it has just done
// passes `done`. That task never transitions, so nothing else would ever set
// `closed_at`, and it used to be missing from the closed side of every report.
const bornDone = await taskService.create({
  project_id: project.id,
  title: "REPORT-SMOKE: recorded after the fact",
  status: "done",
  model: MODEL,
});
assert(Boolean(bornDone.closed_at), "closed_at is set at creation, not left null");
const withBornDone = await activityReport(user.id, resolvePeriod("today"));
assert(
  withBornDone.completed.some((r) => r.id === bornDone.id),
  "and it reaches today's completed list",
);

console.log("\n--- a row on a period boundary belongs to one day, not two ---");
// `resolvePeriod` hands back a half-open window, so yesterday's `to` is today's
// `from` -- the same instant. Read with an inclusive comparison, anything
// written exactly then was counted twice, once in each report.
const today = resolvePeriod("today");
const yesterday = resolvePeriod("yesterday");
assert(yesterday.to === today.from, "the two windows really do meet at one instant");

await run(
  `INSERT INTO entries (task_id, kind, body, author, model, user_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [bornDone.id, "note", "REPORT-SMOKE: written on the boundary", "agent", MODEL, null, today.from],
);

const onTheEdge = (rows: { body: string }[]) =>
  rows.filter((r) => r.body.includes("written on the boundary")).length;
assert(
  onTheEdge(await entriesRepo.listByTasksBetween([bornDone.id], yesterday.from, yesterday.to)) === 0,
  "the window that ends at that instant does not include it",
);
assert(
  onTheEdge(await entriesRepo.listByTasksBetween([bornDone.id], today.from, today.to)) === 1,
  "the window that starts at that instant does, exactly once",
);

// `activeBetween` compares four columns of its own, and an entry on the
// boundary does not exercise them -- the task has to sit on it. Forced through
// SQL because nothing in the app can create a row in the past.
const onBoundary = await taskService.create({
  project_id: project.id,
  title: "REPORT-SMOKE: opened and closed on the boundary",
  model: MODEL,
});
await run("UPDATE tasks SET created_at = ?, closed_at = ? WHERE id = ?", [
  today.from,
  today.from,
  onBoundary.id,
]);

const yesterdaysTasks = await tasksRepo.activeBetween(user.id, yesterday.from, yesterday.to);
const todaysTasks = await tasksRepo.activeBetween(user.id, today.from, today.to);
assert(
  todaysTasks.some((t) => t.id === onBoundary.id),
  "a task stamped on the boundary is active in the window that starts there",
);
assert(
  !yesterdaysTasks.some((t) => t.id === onBoundary.id),
  "and not in the one that ends there",
);

// clean up so the demo data stays honest
await projectsRepo.remove(user.id, project.id);
console.log("\nOK (cleaned up)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
