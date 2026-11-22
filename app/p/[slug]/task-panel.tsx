import Link from "next/link";

import { ENTRY_KINDS, STATUSES } from "@/lib/constants";
import { ago, type T } from "@/lib/i18n";
import * as entriesRepo from "@/lib/repositories/entries";
import * as refsRepo from "@/lib/repositories/refs";
import type { Task } from "@/lib/types";

import { addEntryAction, setStatusAction } from "../../actions";
import { Chip, EntryBody, ExpandableText, RefBadge, StatusDot } from "../../components";
import { LogComposer, type KindStrings } from "../../features/log-composer";
import { KIND_COLOR, kindHint, kindLabel, kindPlaceholder, statusLabel } from "../../kinds";
import { byline } from "./t/[id]/byline";

/**
 * Entries the panel carries: the end of the log, which is where a task is.
 *
 * The panel answers "what is this and where did it stop" beside the board; the
 * whole history is the task's own page, one link away, and the count of what
 * is not here is printed rather than implied.
 */
const PANEL_ENTRIES = 4;

/**
 * One task, read beside the board.
 *
 * Reading a task used to mean leaving the list for its page and coming back.
 * This is the same record at panel width: what it is, its status as a control,
 * the newest of its log, a place to add to it, and the files it is tied to.
 * Editing the title and body, deleting entries and linking files stay on the
 * full page, which exists and is linked from the top.
 */
export async function TaskPanel({ task, slug, t }: { task: Task; slug: string; t: T }) {
  const taskHref = `/p/${slug}/t/${task.id}`;
  const [log, refRows] = await Promise.all([
    entriesRepo.pageByTask(task.id, PANEL_ENTRIES),
    refsRepo.listByTask(task.id),
  ]);
  const earlier = log.total - log.rows.length;

  const kindStrings = Object.fromEntries(
    ENTRY_KINDS.map((kind) => [
      kind,
      {
        label: kindLabel(t, kind),
        hint: kindHint(t, kind),
        placeholder: kindPlaceholder(t, kind),
      },
    ]),
  ) as KindStrings;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <StatusDot status={task.status} t={t} />
        <span className="mono text-meta text-faint">
          #{task.id} · {t("updated")} {ago(task.updated_at, t)}
        </span>
        <Link href={taskHref} className="link-more ml-auto text-meta">
          {t("openFullPage")}
        </Link>
      </div>

      {/* Clamped: a title can be a paragraph, and at panel width that pushed
          the status buttons and the log off the first screen. The whole of it
          is on the task's page, and in the tooltip. */}
      <h2
        className="display line-clamp-3 text-[17px] leading-snug font-bold break-words"
        title={task.title}
      >
        {task.title}
      </h2>

      {/* One form, one button per status: the button that was pressed is the
          value, so it needs no script, and the current status stays focusable
          and says so with `aria-pressed` rather than going `disabled`. */}
      <form action={setStatusAction}>
        <input type="hidden" name="task_id" value={task.id} />
        <fieldset className="border-0 p-0">
          <legend className="sr-only">{t("statusLabel")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((status) => (
              <button
                key={status}
                type="submit"
                name="status"
                value={status}
                aria-pressed={task.status === status}
                className="pill seg"
              >
                {statusLabel(t, status)}
              </button>
            ))}
          </div>
        </fieldset>
      </form>

      {task.body && (
        <ExpandableText
          text={task.body}
          more={t("showMore")}
          less={t("showLess")}
          className="text-small leading-relaxed text-muted"
        />
      )}

      <section aria-labelledby="panel-log" className="space-y-2">
        <h3 id="panel-log" className="display text-[15px] font-bold">
          {t("theLog")}
        </h3>
        {log.rows.length === 0 && <p className="text-small text-muted">{t("logEmpty")}</p>}
        {earlier > 0 && (
          <Link href={taskHref} className="link-more text-meta">
            {t("earlierEntries", { n: earlier })}
          </Link>
        )}
        <ol className="divide-y divide-[var(--rule)]">
          {log.rows.map((entry) => (
            <li key={entry.id} className="min-w-0 py-3 first:pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Chip color={KIND_COLOR[entry.kind]} title={kindHint(t, entry.kind)}>
                  {kindLabel(t, entry.kind)}
                </Chip>
                <span className="mono text-meta text-faint">
                  {byline(t, entry)}
                  {ago(entry.created_at, t)}
                </span>
              </div>
              <EntryBody body={entry.body} more={t("showMore")} less={t("showLess")} />
            </li>
          ))}
        </ol>
        <LogComposer
          taskId={task.id}
          action={addEntryAction}
          strings={kindStrings}
          groupLabel={t("kindsSummary")}
          bodyLabel={t("theLog")}
          submitLabel={t("append")}
          pendingLabel={t("working")}
        />
      </section>

      {refRows.length > 0 && (
        <section aria-labelledby="panel-files" className="space-y-2">
          <h3 id="panel-files" className="display text-[15px] font-bold">
            {t("filesInPlay")}
          </h3>
          <ul className="space-y-1.5">
            {refRows.map((ref) => (
              <li key={ref.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="mono min-w-0 text-meta break-all">{ref.path}</span>
                <RefBadge status={refsRepo.freshness(ref)} t={t} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
