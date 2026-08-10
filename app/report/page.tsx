import Link from "next/link";

import { duration, translator, type Key, type T } from "@/lib/i18n";
import { getT, getTz } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import { mustResolve } from "@/lib/services/project-resolver";
import { periodLabel, renderMarkdown } from "@/lib/services/report-markdown";
import { activityReport, type TaskReport } from "@/lib/services/reports";
import { resolvePeriod, type PeriodName } from "@/lib/util/time";
import { Blob, Chip, Counter, Empty, Panel } from "../components";
import { CopyMarkdown } from "../features/copy-markdown";
import { IMPORTANCE_COLOR, KIND_COLOR, statusLabel } from "../kinds";

export const dynamic = "force-dynamic";

const PERIODS: PeriodName[] = ["today", "yesterday", "week", "last_week", "month"];

const isPeriod = (v: unknown): v is PeriodName =>
  typeof v === "string" && (PERIODS as string[]).concat("all").includes(v);

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const user = await requireUser();
  const { lang, t } = await getT();
  const sp = await searchParams;
  const raw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period: PeriodName = isPeriod(raw) ? raw : "today";
  const projectRef = Array.isArray(sp.project) ? sp.project[0] : sp.project;

  const window = resolvePeriod(period, { tz: await getTz() });
  const projectId = projectRef ? (await mustResolve(user.id, projectRef)).id : undefined;
  const report = await activityReport(user.id, window, { projectId });
  const markdown = renderMarkdown(report, translator(lang));

  return (
    <div className="space-y-6">
      <div className="pop prose">
        <h1 className="display text-[33px] leading-[1.1] font-bold">{t("reportTitle")}</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t("reportIntro")}</p>
      </div>

      <nav aria-label={t("reportTitle")} className="pop flex flex-wrap gap-2">
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Link
              key={p}
              // Carry the project through: switching period used to silently
              // widen the report back out to every project.
              href={
                projectRef
                  ? `/report?period=${p}&project=${encodeURIComponent(projectRef)}`
                  : `/report?period=${p}`
              }
              aria-current={active ? "page" : undefined}
              className="pill"
              style={
                active
                  ? {
                      background: "var(--accent)",
                      color: "var(--on-fill)",
                      boxShadow: "3px 3px 0 var(--shadow-col)",
                    }
                  : { background: "var(--inset)", color: "var(--muted)" }
              }
            >
              {periodLabel(p, t)}
            </Link>
          );
        })}
      </nav>

      {report.totals.touched === 0 ? (
        <Panel delay={40}>
          <Empty mood="sleep">{t("noActivity")}</Empty>
        </Panel>
      ) : (
        <>
          <section
            className="pop grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            aria-label={t("reportTitle")}
          >
            <Stat n={report.totals.completed} label={t("totalsCompleted")} fill="var(--ok)" />
            <Stat n={report.totals.created} label={t("totalsCreated")} fill="var(--k-decision)" />
            <Stat n={report.totals.touched} label={t("totalsTouched")} fill="var(--k-note)" />
            <Stat
              text={duration(report.totals.active_ms, t)}
              label={t("totalsActive")}
              fill="var(--accent)"
            />
          </section>

          {report.by_project.length > 1 && (
            <Panel delay={80} title={t("byProject")}>
              <ul className="space-y-1.5">
                {report.by_project.map((bp) => (
                  <li key={bp.slug} className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/p/${bp.slug}`}
                      className="display text-[15px] font-bold underline decoration-dotted underline-offset-2"
                    >
                      {bp.name}
                    </Link>
                    <Chip color="var(--ok)">
                      {bp.completed} {t("totalsCompleted")}
                    </Chip>
                    <Chip>
                      {bp.touched} {t("totalsTouched")}
                    </Chip>
                    <span className="mono ml-auto text-[12px] text-muted">
                      {duration(bp.active_ms, t)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {report.completed.length > 0 && (
            <Panel
              delay={120}
              title={t("completedTasks")}
              right={<Counter n={report.completed.length} label={t("completedTasks")} />}
            >
              <ul className="space-y-3">
                {report.completed.map((task) => (
                  <TaskRow key={task.id} task={task} t={t} />
                ))}
              </ul>
            </Panel>
          )}

          {report.in_progress.length > 0 && (
            <Panel
              delay={160}
              title={t("inProgressTasks")}
              right={<Counter n={report.in_progress.length} label={t("inProgressTasks")} />}
            >
              <ul className="space-y-3">
                {report.in_progress.map((task) => (
                  <TaskRow key={task.id} task={task} t={t} />
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <EntryList
              delay={200}
              title={t("decisionsMade")}
              color={KIND_COLOR.decision}
              items={report.decisions}
            />
            <EntryList
              delay={220}
              title={t("deadEndsHit")}
              color={KIND_COLOR.dead_end}
              items={report.dead_ends}
            />
            <EntryList
              delay={240}
              title={t("questionsRaised")}
              color={KIND_COLOR.question}
              items={report.open_questions}
            />
            {report.by_model.length > 0 && (
              <Panel delay={260} title={t("byModel")}>
                <ul className="space-y-1.5">
                  {report.by_model.map((m) => (
                    <li key={m.model} className="flex flex-wrap items-center gap-2">
                      <code className="mono rounded border-[1.5px] border-line bg-inset px-1.5 text-[12.5px] break-all">
                        {m.model}
                      </code>
                      <span className="text-[13.5px] text-muted">
                        {m.entries} {t("totalsEntries")} · {m.tasks} {t("task")}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>

          <Panel delay={300} title="markdown">
            <div className="flex flex-wrap items-start gap-4">
              <Blob mood="happy" size={46} fill="var(--k-handoff)" className="shrink-0" />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-[14px] text-muted">{t("reportForManager")}</p>
                <CopyMarkdown
                  markdown={markdown}
                  label={t("copyReport")}
                  copiedLabel={t("reportCopied")}
                />
                {/* `break-words`, not `break-all`: a long path or URL has to
                    give way, but ordinary prose should still break at spaces. */}
                <pre className="mono max-h-80 overflow-auto rounded-[10px] border-[1.5px] border-line bg-inset p-3 text-[12.5px] break-words whitespace-pre-wrap">
                  {markdown}
                </pre>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function Stat({
  n,
  text,
  label,
  fill,
}: {
  n?: number;
  text?: string;
  label: string;
  fill: string;
}) {
  return (
    <div className="sticker p-4">
      <div
        className="on-fill display inline-block rounded-full border-[1.5px] border-line px-2.5 pt-[2px] pb-[3px] text-[22px] leading-none font-bold"
        style={{ background: fill, borderColor: "var(--edge-dark)" }}
      >
        {text ?? n}
      </div>
      <p className="mt-2 text-[13.5px] text-muted">{label}</p>
    </div>
  );
}

function TaskRow({ task, t }: { task: TaskReport; t: T }) {
  const tilde = task.partial ? "~" : "";
  return (
    <li className="sticker-flat p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mono text-[12px] text-faint">#{task.id}</span>
        <Link
          href={`/p/${task.project_slug}/t/${task.id}`}
          className="text-[15px] font-medium underline decoration-dotted underline-offset-2"
        >
          {task.title}
        </Link>
        <Chip>{task.project_slug}</Chip>
        {/* "normal" used to pass var(--card) here, which paints --on-fill on
            the card colour: 1.16:1, i.e. an invisible word. */}
        <Chip color={IMPORTANCE_COLOR[task.importance]}>
          {t(`imp_${task.importance}` as Key)}
        </Chip>
        <Chip>{statusLabel(t, task.status)}</Chip>
      </div>

      <div className="mono mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>
          {t("activeTime")}: {tilde}
          {duration(task.active_ms_in_period, t)}
        </span>
        <span>
          {t("leadTime")}: {duration(task.lead_ms, t)}
        </span>
        {task.models.length > 0 && (
          <span>
            {t("modelLabel")}: {task.models.join(", ")}
          </span>
        )}
        {task.dead_ends.length > 0 && (
          <span>
            {task.dead_ends.length} {t("deadEndCountPlural")}
          </span>
        )}
      </div>
    </li>
  );
}

function EntryList({
  title,
  color,
  items,
  delay,
}: {
  title: string;
  color: string;
  items: { task_id: number; task: string; body: string }[];
  delay: number;
}) {
  if (items.length === 0) return null;
  return (
    <Panel delay={delay} title={title} right={<Counter n={items.length} label={title} />}>
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={`${item.task_id}-${i}`} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-3 shrink-0 rounded-full border-[1.5px] border-line"
              style={{ background: color, borderColor: "var(--edge-dark)" }}
            />
            <span className="min-w-0">
              <span className="display text-[13px] font-bold">{item.task}</span>
              <p className="text-[14px] leading-relaxed text-muted">{item.body}</p>
            </span>
          </li>
        ))}
      </ul>
        </Panel>
  );
}
