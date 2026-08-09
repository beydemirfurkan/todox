import { duration, type Key, type T } from "../i18n";
import type { ActivityReport, TaskReport } from "./reports";

const PERIOD_KEY: Record<string, Key> = {
  today: "periodToday",
  yesterday: "periodYesterday",
  week: "periodWeek",
  last_week: "periodLastWeek",
  month: "periodMonth",
  all: "periodAll",
};

export function periodLabel(label: string, t: T) {
  const key = PERIOD_KEY[label];
  return key ? t(key) : label;
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * Markdown built to be pasted into a status update as-is: headline numbers
 * first, then the finished work with what it cost, then the friction. Nothing
 * here is inferred from commits -- it all comes off the log.
 */
export function renderMarkdown(r: ActivityReport, t: T): string {
  const out: string[] = [];
  const p = periodLabel(r.period.label, t);

  out.push(`# ${t("reportTitle")} — ${p}`);
  out.push("");
  out.push(`_${day(r.period.from)} → ${day(r.period.to)}_`);
  out.push("");

  if (r.totals.touched === 0) {
    out.push(t("noActivity"));
    return out.join("\n");
  }

  out.push(
    `**${r.totals.completed}** ${t("totalsCompleted")} · ` +
      `**${r.totals.created}** ${t("totalsCreated")} · ` +
      `**${r.totals.touched}** ${t("totalsTouched")} · ` +
      `**${duration(r.totals.active_ms, t)}** ${t("totalsActive")}`,
  );
  out.push("");

  if (r.by_project.length > 1) {
    out.push(`## ${t("byProject")}`);
    out.push("");
    for (const bp of r.by_project) {
      out.push(
        `- **${bp.name}** — ${bp.completed} ${t("totalsCompleted")}, ` +
          `${bp.touched} ${t("totalsTouched")}, ${duration(bp.active_ms, t)}`,
      );
    }
    out.push("");
  }

  if (r.completed.length) {
    out.push(`## ${t("completedTasks")}`);
    out.push("");
    for (const task of r.completed) out.push(...taskLines(task, t));
    out.push("");
  }

  if (r.in_progress.length) {
    out.push(`## ${t("inProgressTasks")}`);
    out.push("");
    for (const task of r.in_progress) {
      out.push(
        `- **${task.title}** (${task.project_slug}) — ${t(`st_${task.status}` as Key)}, ` +
          `${t("activeTime")} ${duration(task.active_ms, t)}`,
      );
    }
    out.push("");
  }

  if (r.decisions.length) {
    out.push(`## ${t("decisionsMade")}`);
    out.push("");
    for (const d of r.decisions) out.push(`- **${d.task}** — ${d.body}`);
    out.push("");
  }

  if (r.dead_ends.length) {
    out.push(`## ${t("deadEndsHit")}`);
    out.push("");
    for (const d of r.dead_ends) out.push(`- **${d.task}** — ${d.body}`);
    out.push("");
  }

  if (r.open_questions.length) {
    out.push(`## ${t("questionsRaised")}`);
    out.push("");
    for (const q of r.open_questions) out.push(`- **${q.task}** — ${q.body}`);
    out.push("");
  }

  if (r.by_model.length) {
    out.push(`## ${t("byModel")}`);
    out.push("");
    for (const m of r.by_model)
      out.push(`- \`${m.model}\` — ${m.entries} ${t("totalsEntries")}, ${m.tasks} ${t("task")}`);
    out.push("");
  }

  if (r.completed.some((c) => c.partial) || r.in_progress.some((c) => c.partial)) {
    out.push(`> ${t("partialNote")}`);
    out.push("");
  }

  return out.join("\n").trimEnd();
}

function taskLines(task: TaskReport, t: T): string[] {
  const tilde = task.partial ? "~" : "";
  const meta = [
    `${t("importance")}: ${t(`imp_${task.importance}` as Key)}`,
    `${t("activeTime")}: ${tilde}${duration(task.active_ms, t)}`,
    `${t("leadTime")}: ${duration(task.lead_ms, t)}`,
    task.models.length ? `${t("modelLabel")}: ${task.models.join(", ")}` : null,
  ].filter(Boolean);

  const lines = [`### ${task.title}`, "", `${task.project_slug} · ${meta.join(" · ")}`];

  if (task.body) lines.push("", task.body.trim());
  if (task.decisions.length) {
    lines.push("", `**${t("decisionsMade")}**`);
    for (const d of task.decisions) lines.push(`- ${d}`);
  }
  if (task.dead_ends.length) {
    lines.push("", `**${t("deadEndsHit")}**`);
    for (const d of task.dead_ends) lines.push(`- ${d}`);
  }
  lines.push("");
  return lines;
}
