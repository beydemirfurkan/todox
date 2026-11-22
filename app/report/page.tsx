import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { duration, type T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import { periodLabel } from "@/lib/services/report-markdown";
import { activityReport, type ReportEntry, type TaskReport } from "@/lib/services/reports";
import {
  Counter,
  Empty,
  IconTile,
  Panel,
  ShareBars,
  StatBadges,
} from "../components";
import { RevealCurrent } from "../features/reveal-current";
import { Daily } from "./daily";
import { privatePageMetadata } from "../metadata-shared";
import { CopyMarkdown } from "../features/copy-markdown";
import { MarkdownOnDemand } from "../features/markdown-on-demand";
import { markdownHref, readReportInput, REPORT_PERIODS } from "./report-input";
import { KIND_COLOR, statusLabel } from "../kinds";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleReport"));
}

export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const user = await requireUser();
  const { t } = await getT();
  const sp = await searchParams;
  const input = await readReportInput(user.id, {
    period: Array.isArray(sp.period) ? sp.period[0] : sp.period,
    project: Array.isArray(sp.project) ? sp.project[0] : sp.project,
  });
  if (!input) notFound();
  const { period, projectRef } = input;
  const report = await activityReport(user.id, input.window, { projectId: input.projectId });
  const markdownUrl = markdownHref(input);

  return (
    <div className="space-y-6">
      <div className="pop prose">
        <h1 className="display text-[33px] leading-[1.1] font-bold">{t("reportTitle")}</h1>
        {/* Only when the window is empty.
            Explaining that the report comes from the log rather than from
            commits is the argument for reading it, and it is worth making to
            somebody who has nothing to read yet. Above forty-five finished
            tasks it is a paragraph between the reader and their numbers. */}
        {report.totals.touched === 0 && (
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{t("reportIntro")}</p>
        )}
      </div>

      {/* One row that scrolls sideways on a phone, like a segmented filter
          in an app; it wraps from `sm` where there is room. */}
      <nav
        aria-label={t("reportTitle")}
        className="pop no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>a]:shrink-0"
      >
        {REPORT_PERIODS.map((p) => (
          <Link
            key={p}
            // Carry the project through: switching period used to silently
            // widen the report back out to every project.
            href={
              projectRef
                ? `/report?period=${p}&project=${encodeURIComponent(projectRef)}`
                : `/report?period=${p}`
            }
            aria-current={p === period ? "page" : undefined}
            className="pill seg"
          >
            {periodLabel(p, t)}
          </Link>
        ))}
        <RevealCurrent />
      </nav>

      {report.totals.touched === 0 ? (
        <Panel delay={40}>
          <Empty>{t("noActivity")}</Empty>
        </Panel>
      ) : (
        <>
          <StatBadges
            label={t("reportTitle")}
            className="pop"
            stats={[
              { label: t("totalsCompleted"), value: report.totals.completed, mark: "var(--ok)" },
              { label: t("totalsCreated"), value: report.totals.created, mark: "var(--k-decision)" },
              { label: t("totalsTouched"), value: report.totals.touched, mark: "var(--k-note)" },
              {
                value: duration(report.totals.active_ms, t),
                mark: "var(--accent)",
                label:
                  // The denominator belongs on the tile, not in a footnote below
                  // the fold. A task closed without ever being set to `doing`
                  // contributes a clean zero to this figure, and until now the
                  // headline rolled every one of those in and said nothing --
                  // 43 of 78 completed tasks, measured in production.
                  [
                    t("totalsActive"),
                    report.totals.unmeasured
                      ? t("totalsUnmeasured", { n: report.totals.unmeasured })
                      : null,
                    // The other caveat: what was cut, not what was never there.
                    report.totals.discounted_ms
                      ? t("totalsDiscounted", { d: duration(report.totals.discounted_ms, t) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
              },
            ]}
          />

          {report.by_day.length > 1 && <Daily report={report} t={t} />}

          {(report.by_project.length > 1 || report.by_model.length > 0) && (
            <div
              className={`grid gap-5 ${report.by_project.length > 1 && report.by_model.length > 0 ? "lg:grid-cols-2" : ""}`}
            >
              {report.by_project.length > 1 && (
                <Panel delay={80} title={t("byProject")}>
                  <ShareBars
                    color="var(--accent)"
                    rows={report.by_project.map((bp) => ({
                      key: bp.slug,
                      // The slug beside the name: names are not unique, and two
                      // identical rows with different links are a trap.
                      label: (
                        <Link href={`/p/${bp.slug}`} className="hover:underline">
                          {bp.name}
                          {bp.slug !== bp.name && <span className="text-small text-faint"> {bp.slug}</span>}
                        </Link>
                      ),
                      value: bp.active_ms || bp.touched,
                      text: `${bp.completed} ${t("totalsCompleted")} · ${bp.touched} ${t("totalsTouched")} · ${duration(bp.active_ms, t)}`,
                    }))}
                  />
                </Panel>
              )}
              {report.by_model.length > 0 && (
                <Panel delay={100} title={t("byModel")}>
                  <ShareBars
                    color="var(--k-decision)"
                    rows={report.by_model.map((m) => ({
                      key: m.model,
                      label: <code className="mono text-[13px] break-all">{m.model}</code>,
                      value: m.entries,
                      text: `${m.entries} ${t("totalsEntries")} · ${m.tasks} ${t("task")}`,
                    }))}
                  />
                </Panel>
              )}
            </div>
          )}

          {report.completed.length > 0 && (
            <Panel
              delay={120}
              title={t("completedTasks")}
              right={<Counter n={report.completed.length} label={t("completedTasks")} />}
            >
              <ul className="-mx-2 flex flex-col">
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
              <ul className="-mx-2 flex flex-col">
                {report.in_progress.map((task) => (
                  <TaskRow key={task.id} task={task} statusText={statusLabel(t, task.status)} t={t} />
                ))}
              </ul>
            </Panel>
          )}

          <div className="flex flex-col gap-5">
            <EntryList
              delay={200}
              title={t("decisionsMade")}
              color={KIND_COLOR.decision}
              items={report.decisions}
              t={t}
            />
            <EntryList
              delay={220}
              title={t("deadEndsHit")}
              color={KIND_COLOR.dead_end}
              items={report.dead_ends}
              t={t}
            />
            <EntryList
              delay={240}
              title={t("questionsRaised")}
              color={KIND_COLOR.question}
              items={report.open_questions}
              t={t}
            />
          </div>

          <Panel delay={300} title="markdown">
            <div className="flex flex-wrap items-start gap-4">
              <IconTile name="doc" color="var(--k-handoff)" />
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-[14px] text-muted">{t("reportForManager")}</p>
                <CopyMarkdown
                  href={markdownUrl}
                  label={t("copyReport")}
                  copiedLabel={t("reportCopied")}
                  failedLabel={t("reportCopyFailed")}
                />
                <MarkdownOnDemand
                  href={markdownUrl}
                  summary={t("reportPreview")}
                  loadingLabel={t("loadingPage")}
                  failedLabel={t("reportPreviewFailed")}
                />
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

/**
 * A task in the report as one calm row: the title, then a single line of
 * what the period says about it. It was a card with the id, a dotted
 * underline, three chips ("todox", "normal", "done") and a mono line of
 * labelled figures, sixty times over. What it dropped carries nothing here:
 * "done" under a heading that says completed, "normal" on almost every task,
 * and a "worked ~0m" that only meant nobody measured it.
 */
function TaskRow({ task, statusText, t }: { task: TaskReport; statusText?: string; t: T }) {
  const facts = reportFacts(task, t);
  return (
    <li className="border-t border-rule first:border-t-0">
      <Link href={`/p/${task.project_slug}/t/${task.id}`} className="report-row">
        <span className="flex min-w-[min(16rem,100%)] flex-1 flex-col gap-1">
          <span className="text-[15px] leading-snug break-words text-ink">{task.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-faint">
            <span className="text-muted">{task.project_name}</span>
            {statusText && <Dotted>{statusText}</Dotted>}
            {facts.map((fact) => (
              <Dotted key={fact.key} title={fact.title}>
                {fact.text}
              </Dotted>
            ))}
          </span>
        </span>
        {task.importance === "high" && <span className="important-badge shrink-0">{t("todayImportant")}</span>}
      </Link>
    </li>
  );
}

const MINUTE_MS = 60_000;

function Dotted({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-2">
      <span aria-hidden="true">·</span>
      {children}
    </span>
  );
}

interface ReportFact {
  key: string;
  text: string;
  title?: string;
}

/** Only the figures that say something: a zero that means "not measured" is left out. */
function reportFacts(task: TaskReport, t: T): ReportFact[] {
  const facts: ReportFact[] = [];
  if (task.active_ms_in_period >= MINUTE_MS) {
    // The tilde is a hint, never the message: the title and the words say it.
    const approx = task.partial ? "~" : "";
    const discounted = task.discounted_ms_in_period
      ? ` (${t("discountedSuffix", { d: duration(task.discounted_ms_in_period, t) })})`
      : "";
    facts.push({
      key: "worked",
      text: `${t("activeTime")} ${approx}${duration(task.active_ms_in_period, t)}${discounted}`,
      title: task.partial ? t("approxWhy") : undefined,
    });
  }
  if (task.lead_ms) facts.push({ key: "lead", text: `${t("leadTime")} ${duration(task.lead_ms, t)}` });
  if (task.models.length) facts.push({ key: "models", text: task.models.join(", ") });
  if (task.dead_ends.length) {
    facts.push({ key: "dead", text: `${task.dead_ends.length} ${t("deadEndCountPlural")}` });
  }
  return facts;
}

/**
 * The report's own summary of a kind of entry.
 *
 * `body` arrives cut to a summary from `activityReport`, so this is the one
 * render of an entry that is not the whole thing -- the link is how the reader
 * gets the rest, and it is the reason the cut is worth making. The same markup
 * on the share page is the full body and has no link.
 */
function EntryList({
  title,
  color,
  items,
  delay,
  t,
}: {
  title: string;
  color: string;
  items: ReportEntry[];
  delay: number;
  t: T;
}) {
  if (items.length === 0) return null;
  return (
    <Panel delay={delay} title={title} right={<Counter n={items.length} label={title} />}>
      <ul className="flex flex-col gap-3">
        {items.slice(0, VISIBLE_ENTRIES).map((item, i) => (
          <EntryItem key={`${item.task_id}-${i}`} item={item} color={color} />
        ))}
      </ul>
      {items.length > VISIBLE_ENTRIES && (
        <details className="more-list mt-3">
          <summary className="link-more inline-block text-small">
            <span className="when-closed">{t("showMoreCount", { n: items.length - VISIBLE_ENTRIES })}</span>
            <span className="when-open">{t("showFewer")}</span>
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {items.slice(VISIBLE_ENTRIES).map((item, i) => (
              <EntryItem key={`${item.task_id}-more-${i}`} item={item} color={color} />
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/** Enough to see what kind of period it was; the rest is one click away. */
const VISIBLE_ENTRIES = 5;

/**
 * One entry: the task it belongs to, then three lines of what it said. A
 * body used to be printed whole, so one decision with a pasted id list was a
 * screen tall and the panel beside it stretched to match, empty.
 */
function EntryItem({ item, color }: { item: ReportEntry; color: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="mt-1.5 size-3 shrink-0 rounded-full border-[1.5px]"
        style={{ background: color, borderColor: "var(--edge-dark)" }}
      />
      <span className="min-w-0 flex-1">
        {item.project_slug ? (
          <Link
            href={`/p/${item.project_slug}/t/${item.task_id}`}
            className="text-[14px] font-medium break-words text-ink hover:underline"
          >
            {item.task}
          </Link>
        ) : (
          <span className="text-[14px] font-medium break-words text-ink">{item.task}</span>
        )}
        {/* Paragraphs are kept and long paths still break, as on the share
            page; the clamp is what keeps one entry from becoming a screen. */}
        <p className="line-clamp-3 text-[14px] leading-relaxed break-words whitespace-pre-wrap text-muted">
          {item.truncated ? `${item.body}…` : item.body}
        </p>
      </span>
    </li>
  );
}
