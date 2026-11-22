import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { duration, translator, type Key, type T } from "@/lib/i18n";
import { getT, getTz } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import { resolve } from "@/lib/services/project-resolver";
import { periodLabel, renderMarkdown } from "@/lib/services/report-markdown";
import { activityReport, type ReportEntry, type TaskReport } from "@/lib/services/reports";
import { resolvePeriod, type PeriodName } from "@/lib/util/time";
import {
  Chip,
  Counter,
  Empty,
  IconTile,
  MarkdownPreview,
  Panel,
  ShareBars,
  StatBadges,
} from "../components";
import { Daily } from "./daily";
import { privatePageMetadata } from "../metadata-shared";
import { CopyMarkdown } from "../features/copy-markdown";
import { IMPORTANCE_COLOR, KIND_COLOR, statusLabel } from "../kinds";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleReport"));
}


export const dynamic = "force-dynamic";

const PERIODS: PeriodName[] = ["today", "yesterday", "week", "last_week", "month", "last_30_days"];

/**
 * The pills, and nothing else.
 *
 * `"all"` used to be accepted here while being left out of `PERIODS`, so it had
 * no button and was still one URL edit away. `resolvePeriod` turns it into
 * `new Date(0)`, and the read behind it is a four-way join with no LIMIT whose
 * every decision, dead end and question body then goes into the response --
 * an account's entire history, on a `force-dynamic` page, out of a pool of ten.
 *
 * Not capped instead, deliberately: a report's numbers have to be right, and a
 * truncated input makes "you closed five tasks" a guess. The window is the
 * thing to bound, so an unbounded one is simply not offered. `activity_report`
 * still takes `all` for an agent that asks for it on purpose.
 */
const isPeriod = (v: unknown): v is PeriodName =>
  typeof v === "string" && (PERIODS as string[]).includes(v);

export default async function ReportPage({ searchParams }: PageProps<"/report">) {
  const user = await requireUser();
  const { lang, t } = await getT();
  const sp = await searchParams;
  const raw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period: PeriodName = isPeriod(raw) ? raw : "today";
  const projectRef = Array.isArray(sp.project) ? sp.project[0] : sp.project;

  const window = resolvePeriod(period, { tz: await getTz() });
  // `mustResolve` throws for an unknown reference, which is the right answer to
  // an agent and the wrong one to a browser: a bookmark pointing at a renamed
  // project rendered "Application error: a server-side exception has occurred".
  // The sibling pages have always answered 404 here.
  const projectId = projectRef ? (await resolve(user.id, projectRef))?.id : undefined;
  if (projectRef && projectId === undefined) notFound();
  const report = await activityReport(user.id, window, { projectId });
  const markdown = renderMarkdown(report, translator(lang));

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

      <nav aria-label={t("reportTitle")} className="pop flex flex-wrap gap-2">
        {PERIODS.map((p) => (
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
                          {bp.name} <span className="mono text-meta text-faint">{bp.slug}</span>
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
                  markdown={markdown}
                  label={t("copyReport")}
                  copiedLabel={t("reportCopied")}
                />
                <MarkdownPreview markdown={markdown} />
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function TaskRow({ task, t }: { task: TaskReport; t: T }) {
  // The glyph is a hint, not the message. It marked a figure the report cannot
  // stand behind -- a backfilled task, or one closed without ever being in
  // flight -- and said so nowhere: no legend, no title, nothing a screen
  // reader reaches. Colour and glyphs never carry meaning alone here.
  const approx = task.partial;
  return (
    <li className="sticker-flat p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mono text-[12px] text-faint">#{task.id}</span>
        <Link
          href={`/p/${task.project_slug}/t/${task.id}`}
          className="min-w-0 text-[15px] font-medium break-words underline decoration-dotted underline-offset-2"
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
        <span title={approx ? t("approxWhy") : undefined}>
          {t("activeTime")}: {approx && <span aria-hidden="true">~</span>}
          {duration(task.active_ms_in_period, t)}
          {approx && <span className="sr-only"> ({t("approxWhy")})</span>}
          {task.discounted_ms_in_period > 0 && (
            <span title={t("discountedNote")}>
              {" "}
              ({t("discountedSuffix", { d: duration(task.discounted_ms_in_period, t) })})
            </span>
          )}
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
      <ul className="space-y-2.5">
        {items.map((item, i) => (
          <li key={`${item.task_id}-${i}`} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-1.5 size-3 shrink-0 rounded-full border-[1.5px] border-line"
              style={{ background: color, borderColor: "var(--edge-dark)" }}
            />
            <span className="min-w-0">
              <span className="display text-[13px] font-bold break-words">{item.task}</span>
              {/* Both classes, and for the reasons the sibling render on the
                  share page has always had them: a body is paragraphs, which
                  is what `pre-wrap` keeps, and it carries paths, urls and
                  commit hashes, which `pre-wrap` alone refuses to break. This
                  copy had neither, so every body arrived here as one slab and
                  a long link pushed it out of the card. */}
              <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap text-muted">
                {item.truncated ? `${item.body}…` : item.body}
              </p>
              {item.truncated && item.project_slug && (
                <Link
                  href={`/p/${item.project_slug}/t/${item.task_id}`}
                  className="link-more mt-1.5 inline-block"
                >
                  {t("readEntryInFull")}
                  {/* Every one of these links says the same three words. */}
                  <span className="sr-only"> — {item.task}</span>
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
