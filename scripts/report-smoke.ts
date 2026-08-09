/**
 * Proves the reporting path end to end: a task moves through statuses, the
 * events land, and the report reconstructs duration, model and importance.
 */
import "./env";

import { translator } from "../lib/i18n";
import * as eventsRepo from "../lib/repositories/events";
import * as projectsRepo from "../lib/repositories/projects";
import * as usersRepo from "../lib/repositories/users";
import * as tasksRepo from "../lib/repositories/tasks";
import { renderMarkdown } from "../lib/services/report-markdown";
import { activityReport, timingFor } from "../lib/services/reports";
import * as taskService from "../lib/services/task-service";
import { resolvePeriod } from "../lib/util/time";

const MODEL = "claude-opus-5";

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

// clean up so the demo data stays honest
await projectsRepo.remove(user.id, project.id);
console.log("\nOK (cleaned up)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
