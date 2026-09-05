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
import { Blob, Chip, Counter, Empty, MarkdownPreview, Panel } from "../components";
import { privatePageMetadata } from "../metadata-shared";
import { CopyMarkdown } from "../features/copy-markdown";
import { IMPORTANCE_COLOR, KIND_COLOR, statusLabel } from "../kinds";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleReport"));
}


export const dynamic = "force-dynamic";

const PERIODS: PeriodName[] = ["today", "yesterday", "week", "last_week", "month"];

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
              label={
                // The denominator belongs on the tile, not in a footnote below
                // the fold. A task closed without ever being set to `doing`
                // contributes a clean zero to this figure, and until now the
                // headline rolled every one of those in and said nothing --
                // 43 of 78 completed tasks, measured in production.
                report.totals.unmeasured
                  ? `${t("totalsActive")} · ${t("totalsUnmeasured", { n: report.totals.unmeasured })}`
                  : t("totalsActive")
              }
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
                    {/* The slug, because the name is not unique and this row
                        is where that stops being harmless: two projects called
                        crm.marcaspio sit in production today, and in this list
                        they were two identical rows with different links. The
                        home page's cards have always shown both. */}
                    <span className="mono text-[11.5px] text-faint">{bp.slug}</span>
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
                <MarkdownPreview markdown={markdown} />
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
