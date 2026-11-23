import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ENTRY_KINDS, STATUSES, type EntryKind } from "@/lib/constants";
import { ago, duration, type T } from "@/lib/i18n";
import { byline } from "./byline";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import * as entryDeletions from "@/lib/repositories/entry-deletions";
import * as entriesRepo from "@/lib/repositories/entries";
import * as eventsRepo from "@/lib/repositories/events";
import * as projects from "@/lib/repositories/projects";
import * as refsRepo from "@/lib/repositories/refs";
import * as tasksRepo from "@/lib/repositories/tasks";
import { timingFor } from "@/lib/services/reports";
import type { Entry } from "@/lib/types";
import {
  addEntryAction,
  deleteEntryAction,
  linkFileAction,
  acceptRefAction,
  requestForAgentAction,
  setStatusAction,
  unlinkRefAction,
  updateTaskAction,
  withdrawAgentRequestAction,
} from "../../../../actions";
import {
  KIND_COLOR,
  kindHint,
  kindLabel,
  kindPlaceholder,
  priorityOptions,
  statusLabel,
} from "../../../../kinds";
import { projectColor } from "../../../../components/project-color";
import { LogComposer, type KindStrings } from "../../../../features/log-composer";
import { Picker } from "../../../../features/picker";
import { SubmitButton } from "../../../../features/submit";
import {
  Chip,
  Counter,
  currentTab,
  Empty,
  EntryBody,
  ExpandableText,
  Field,
  IconTile,
  Panel,
  RefBadge,
  type Tab,
  Tabs,
} from "../../../../components";
import { privatePageMetadata } from "../../../../metadata-shared";

export const dynamic = "force-dynamic";

/**
 * Entries of the log shown open. Older ones fold above them: the newest are
 * what somebody opening a task needs, and a long history pushed the composer
 * a screen away from them.
 */
const LOG_SHOWN = 8;

/**
 * Shared with `generateMetadata` below, which needs the same three rows. The
 * page is force-dynamic, so without `cache` opening one task would cost each
 * lookup twice.
 */
const currentUser = cache(requireUser);
const projectBySlug = cache((userId: number, slug: string) => projects.bySlug(userId, slug));
const taskById = cache((id: number) => tasksRepo.byId(id));


/**
 * The tab. A task is the thing people leave open while they work on it, and
 * every one of them read the landing page's tagline before.
 */
export async function generateMetadata({
  params,
}: PageProps<"/p/[slug]/t/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  const { t } = await getT();
  const user = await currentUser();
  const [project, task] = await Promise.all([
    projectBySlug(user.id, slug),
    taskById(Number(id)),
  ]);
  const owned = project && task && task.project_id === project.id;
  return privatePageMetadata(owned ? `${task.title} — ${t("siteName")}` : t("siteName"));
}

export default async function TaskPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]/t/[id]">) {
  const { slug, id } = await params;
  const user = await currentUser();
  const { t } = await getT();
  const [project, task] = await Promise.all([
    projectBySlug(user.id, slug),
    taskById(Number(id)),
  ]);
  if (!project || !task || task.project_id !== project.id) notFound();

  const [entries, refRows, deletions, events] = await Promise.all([
    entriesRepo.listByTask(task.id),
    refsRepo.listByTask(task.id),
    entryDeletions.listByTask(task.id),
    eventsRepo.listByTask(task.id),
  ]);
  const timing = timingFor(task, events, entries);
  // Who may delete is decided in lib/services/ownership.ts; this only hides
  // a control that would answer 404, it guards nothing.
  const isOwner = project.user_id === user.id;
  const canDelete = (e: { user_id?: number | null }) => isOwner || e.user_id === user.id;
  const timeline = [
    ...entries.map((e) => ({ type: "entry" as const, at: e.created_at, e })),
    ...deletions.map((d) => ({ type: "deleted" as const, at: d.created_at, d })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const refs = refRows.map((r) => ({ ...r, state: refsRepo.freshness(r) }));
  // A question stays open until some entry names it; only an open one offers
  // the answer form.
  const answered = new Set(entries.flatMap((e) => (e.answers_entry_id ? [e.answers_entry_id] : [])));

  const kindStrings = Object.fromEntries(
    ENTRY_KINDS.map((k) => [
      k,
      { label: kindLabel(t, k), hint: kindHint(t, k), placeholder: kindPlaceholder(t, k) },
    ]),
  ) as KindStrings;

  const tabs: Tab[] = [
    { id: "log", label: t("tabLog"), href: `/p/${slug}/t/${id}`, count: entries.length },
    {
      id: "files",
      label: t("tabFiles"),
      href: `/p/${slug}/t/${id}?t=files`,
      count: refs.length,
    },
  ];
  const tab = currentTab(tabs, (await searchParams).t);

  const leftOff = newestHandoff(entries);
  const earlier = timeline.slice(0, Math.max(0, timeline.length - LOG_SHOWN));
  const recent = timeline.slice(earlier.length);
  const renderItem = (item: TimelineItem, isLast: boolean) => (
    <TimelineRow
      key={item.type === "entry" ? item.e.id : `deleted-${item.d.id}`}
      item={item}
      isLast={isLast}
      canDelete={item.type === "entry" && canDelete(item.e)}
      isOpenQuestion={item.type === "entry" && item.e.kind === "question" && !answered.has(item.e.id)}
      t={t}
    />
  );

  return (
    <div className="flex flex-col gap-7">
      <Link href={`/p/${slug}`} className="link-more self-start text-small">
        ← {project.name}
      </Link>

      <header className="-mt-3 flex flex-col gap-4">
        <h1 className="display max-w-[32ch] text-[32px] leading-[1.15] break-words">
          {task.title}
        </h1>
        {/* One form, one button per status: the button pressed is the value,
            so it needs no script, and the current status stays focusable and
            says so with `aria-pressed` rather than going `disabled`. */}
        <form action={setStatusAction}>
          <input type="hidden" name="task_id" value={task.id} />
          <fieldset className="border-0 p-0">
            <legend className="sr-only">{t("statusLabel")}</legend>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="submit"
                  name="status"
                  value={status}
                  aria-pressed={task.status === status}
                  data-status={status}
                  className="status-choice"
                >
                  <span aria-hidden="true" className="status-choice-mark" />
                  {statusLabel(t, status)}
                </button>
              ))}
            </div>
          </fieldset>
        </form>
        <AgentQueueControl
          taskId={task.id}
          status={task.status}
          requestedAt={task.requested_at}
          t={t}
        />
      </header>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {leftOff && (
            <section aria-labelledby="left-off" className="left-off">
              <h2 id="left-off" className="flex flex-wrap items-baseline gap-x-2 text-small font-semibold text-[var(--k-handoff)]">
                {t("taskLeftOff")}
                <span className="font-normal text-faint">
                  {byline(t, leftOff)}
                  {ago(leftOff.created_at, t)}
                </span>
              </h2>
              <ExpandableText
                text={leftOff.body}
                more={t("showMore")}
                less={t("showLess")}
                className="text-body leading-relaxed text-ink"
              />
            </section>
          )}

          <section aria-labelledby="brief" className="flex flex-col gap-2">
            <h2 id="brief" className="text-small font-semibold text-muted">{t("taskBrief")}</h2>
            {/* Clamped: the brief sits between the reader and the history
                they came for, and the median body is 1,384 characters. */}
            {task.body ? (
              <ExpandableText
                text={task.body}
                more={t("showMore")}
                less={t("showLess")}
                className="prose text-body leading-relaxed text-muted"
              />
            ) : (
              <p className="text-small text-muted">{t("taskNoBrief")}</p>
            )}
            {/* Read first, edit on request: a disclosure, so it works with no
                JavaScript and the Server Action still lives in a real form. */}
            <details className="mt-1">
              <summary className="link-more text-meta">{t("editTask")}</summary>
              <form action={updateTaskAction} className="mt-3 space-y-2">
                <input type="hidden" name="task_id" value={task.id} />
                {/* textarea, not input: long titles are the norm here and an
                    input would clip the thing you most need to read */}
                <Field label={t("taskTitlePh")}>
                  <textarea name="title" rows={2} defaultValue={task.title} className="textarea-title" />
                </Field>
                <Field label={t("taskBodyPh")}>
                  <textarea name="body" defaultValue={task.body ?? ""} />
                </Field>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("priorityLabel")} className="w-40">
                    <Picker
                      name="priority"
                      value={String(task.priority)}
                      options={priorityOptions(t)}
                      label={t("priorityLabel")}
                    />
                  </Field>
                  <SubmitButton className="btn btn-quiet" pendingLabel={t("saving")}>
                    {t("save")}
                  </SubmitButton>
                </div>
              </form>
            </details>
          </section>

          <Tabs tabs={tabs} current={tab} label={t("taskSections")} />

          {tab === "log" && (
            <section aria-label={t("theLog")} className="flex flex-col gap-2">
              {entries.length === 0 && <Empty>{t("logEmpty")}</Empty>}
              {earlier.length > 0 && (
                <details className="disclosure">
                  <summary className="text-small text-muted">
                    {t("logEarlier", { n: earlier.length })}
                  </summary>
                  <ol className="mt-4">{earlier.map((item) => renderItem(item, false))}</ol>
                </details>
              )}
              <ol>{recent.map((item, i) => renderItem(item, i === recent.length - 1))}</ol>
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
          )}
          {tab === "files" && (
            <div className="space-y-5">
              <Panel
                delay={130}
                title={t("filesInPlay")}
                right={<Counter n={refs.length} label={t("filesInPlay")} />}
              >
                <p className="mb-3 text-[13.5px] leading-snug text-muted">{t("filesHint")}</p>
                <div className="space-y-2.5">
                  {refs.length === 0 && <Empty>{t("filesEmpty")}</Empty>}
                  {refs.map((r) => (
                    <div key={r.id} className="sticker-flat group p-2.5">
                      <p className="mono text-[12.5px] break-all">{r.path}</p>
                      {r.note && (
                        <p className="mt-1 text-[13.5px] break-words whitespace-pre-wrap text-muted">
                          {r.note}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <RefBadge status={r.state} t={t} />
                        <span className="mono text-meta text-faint">
                          {t("linkedAt")} {ago(r.linked_at, t)}
                          {/* Whose answer this is, and how old. The server cannot
                              read the file; an agent looked and told us. */}
                          {r.checked_at
                            ? ` · ${t("checkedAt")} ${ago(r.checked_at, t)}`
                            : ` · ${t("neverChecked")}`}
                        </span>
                        <span className="row-action ml-auto flex gap-2">
                          {r.state === "changed" && (
                            <form action={acceptRefAction}>
                              <input type="hidden" name="ref_id" value={r.id} />
                              <SubmitButton
                                className="link-more text-meta"
                                pendingLabel={t("working")}
                              >
                                {t("acceptRef")}
                              </SubmitButton>
                            </form>
                          )}
                          <form action={unlinkRefAction}>
                            <input type="hidden" name="ref_id" value={r.id} />
                            <SubmitButton
                              className="link-more text-meta"
                              pendingLabel={t("working")}
                            >
                              {t("unlink")}
                            </SubmitButton>
                          </form>
                        </span>
                      </div>
                    </div>
                  ))}
                  <form action={linkFileAction} className="space-y-2 pt-1">
                    <input type="hidden" name="task_id" value={task.id} />
                    {/* The example is a path inside this project, not the
                        project's root with "/mutlak/yol/..." glued to the end of
                        it -- that read as a real location and pointed nowhere. */}
                    <Field label={t("filePathLabel")}>
                      <input
                        name="path"
                        placeholder={
                          project.root_path
                            ? `${project.root_path}/src/index.ts`
                            : t("filePathPh")
                        }
                        className="mono text-small"
                        required
                      />
                    </Field>
                    <Field label={t("fileNotePh")}>
                      <input name="note" className="text-body" />
                    </Field>
                    <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                      {t("link")}
                    </SubmitButton>
                  </form>
                </div>
              </Panel>

              <Panel delay={190} title={t("whatAgentSees")}>
                <div className="flex items-start gap-3">
                  <IconTile name="terminal" color="var(--accent-ink)" />
                  <p className="text-[14px] text-muted">
                    <code className="mono rounded-[5px] border border-line bg-inset px-1.5 py-0.5 text-[13px] break-all text-[var(--accent-ink)]">
                      get_context(&quot;{slug}&quot;)
                    </code>{" "}
                    {t("agentSeesBody")}
                  </p>
                </div>
              </Panel>
            </div>
          )}
        </div>

        <TaskDetails
          project={project}
          priority={task.priority}
          createdAt={task.created_at}
          workedMs={timing.started_at ? timing.active_ms : null}
          entries={entries}
          files={refs.length}
          filesHref={`/p/${slug}/t/${id}?t=files`}
          t={t}
        />
      </div>
    </div>
  );
}

type TimelineItem =
  | { type: "entry"; at: string; e: Entry }
  | {
      type: "deleted";
      at: string;
      d: Awaited<ReturnType<typeof entryDeletions.listByTask>>[number];
    };

/** The newest handoff: where the last session said it stopped. */
function newestHandoff(entries: readonly Entry[]): Entry | undefined {
  let latest: Entry | undefined;
  for (const entry of entries) {
    if (entry.kind === "handoff" && (!latest || entry.id > latest.id)) latest = entry;
  }
  return latest;
}

/** One line of the log, or the trace a deleted one left. */
/**
 * Handing the task to the agent, or taking it back. Only a `todo` task can
 * wait in the queue: one already started has been taken, and one finished or
 * dropped has nothing left to ask for.
 */
function AgentQueueControl({
  taskId,
  status,
  requestedAt,
  t,
}: {
  taskId: number;
  status: string;
  requestedAt: string | null;
  t: T;
}): React.JSX.Element | null {
  if (status !== "todo") return null;
  if (!requestedAt)
    return (
      <form action={requestForAgentAction} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input type="hidden" name="task_id" value={taskId} />
        <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
          {t("queueForAgent")}
        </SubmitButton>
        <span className="text-small text-muted">{t("queueForAgentHint")}</span>
      </form>
    );
  return (
    <form action={withdrawAgentRequestAction} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <input type="hidden" name="task_id" value={taskId} />
      <Chip color="var(--accent)">{t("queuedForAgent")}</Chip>
      <span className="text-meta text-faint">{ago(requestedAt, t)}</span>
      <SubmitButton className="link-more text-small" pendingLabel={t("working")}>
        {t("withdrawFromQueue")}
      </SubmitButton>
    </form>
  );
}

/**
 * The agent asked; the person answers here. The answer is a note that names
 * the question, which is what closes it in every later briefing -- the same
 * `answers_entry_id` an agent would send. A disclosure, so the log stays a
 * log until somebody means to reply.
 */
function AnswerForm({ taskId, questionId, t }: { taskId: number; questionId: number; t: T }): React.JSX.Element {
  return (
    <details className="mt-2">
      <summary className="link-more text-small">{t("answerQuestion")}</summary>
      <form action={addEntryAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="task_id" value={taskId} />
        <input type="hidden" name="kind" value="note" />
        <input type="hidden" name="answers_entry_id" value={questionId} />
        <Field label={t("answerLabel")}>
          <textarea name="body" required rows={3} placeholder={t("answerPlaceholder")} />
        </Field>
        <SubmitButton className="btn self-start" pendingLabel={t("working")}>
          {t("answerSubmit")}
        </SubmitButton>
      </form>
    </details>
  );
}

function TimelineRow({
  item,
  isLast,
  canDelete,
  isOpenQuestion,
  t,
}: {
  item: TimelineItem;
  isLast: boolean;
  canDelete: boolean;
  isOpenQuestion: boolean;
  t: T;
}) {
  const rail = (mark: React.ReactNode) => (
    <div className="flex w-3 flex-col items-center" aria-hidden="true">
      {mark}
      {!isLast && <span className="mt-1 w-0 flex-1 border-l border-rule" />}
    </div>
  );
  if (item.type === "deleted") {
    const { d } = item;
    const kind = kindLabel(t, d.kind as EntryKind);
    return (
      <li className="relative flex gap-3">
        {rail(<span className="mt-1.5 size-3 shrink-0 rounded-full border border-dashed border-rule" />)}
        <p className="min-w-0 flex-1 pb-6 text-meta text-faint italic">
          {d.author_name && d.author_name === d.deleted_by_name
            ? t("entryDeletedOwn", { who: d.deleted_by_name, kind })
            : t("entryDeleted", {
                who: d.deleted_by_name ?? t("unknownPerson"),
                author: d.author_name ?? t("unknownPerson"),
                kind,
              })}
          {" · "}
          {ago(d.deleted_at, t)}
        </p>
      </li>
    );
  }
  const { e } = item;
  return (
    <li className="group relative flex gap-3">
      {rail(<span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: KIND_COLOR[e.kind] }} />)}
      <article className="min-w-0 flex-1 pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Chip color={KIND_COLOR[e.kind]} title={kindHint(t, e.kind)}>
            {kindLabel(t, e.kind)}
          </Chip>
          <span className="text-meta text-faint">
            {byline(t, e)}
            {ago(e.created_at, t)}
          </span>
          {canDelete && (
            <form action={deleteEntryAction} className="ml-auto">
              <input type="hidden" name="entry_id" value={e.id} />
              <SubmitButton className="link-more row-action text-meta" pendingLabel={t("working")}>
                {t("delete")}
                <span className="sr-only"> — {kindLabel(t, e.kind)}</span>
              </SubmitButton>
            </form>
          )}
        </div>
        <EntryBody body={e.body} more={t("showMore")} less={t("showLess")} />
        {isOpenQuestion && <AnswerForm taskId={e.task_id} questionId={e.id} t={t} />}
        {e.kind === "question" && !isOpenQuestion && (
          <p className="mt-1 text-meta text-faint">{t("answered")}</p>
        )}
      </article>
    </li>
  );
}

/**
 * The facts about a task that change least, beside the log rather than above
 * it: where it lives, how urgent, how old, how long it has been worked on, and
 * what its log holds. Under the log on a phone.
 */
function TaskDetails({
  project,
  priority,
  createdAt,
  workedMs,
  entries,
  files,
  filesHref,
  t,
}: {
  project: { id: number; slug: string; name: string };
  priority: number;
  createdAt: string;
  /** Time in progress; null when the task never started. */
  workedMs: number | null;
  entries: readonly { kind: EntryKind }[];
  files: number;
  filesHref: string;
  t: T;
}) {
  const priorityName = priorityOptions(t).find((option) => option.value === String(priority))?.label;
  const tally = (["decision", "dead_end", "question", "handoff"] as const)
    .map((kind) => ({ kind, n: entries.filter((entry) => entry.kind === kind).length }))
    .filter(({ n }) => n > 0);
  return (
    <aside aria-labelledby="task-details" className="task-details">
      <h2 id="task-details" className="sr-only">
        {t("taskDetails")}
      </h2>
      <dl className="flex flex-col">
        <DetailRow label={t("taskProject")}>
          <Link href={`/p/${project.slug}`} className="flex items-center gap-2 hover:text-ink">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: projectColor(project.id) }} />
            {project.name}
          </Link>
        </DetailRow>
        <DetailRow label={t("priorityLabel")}>{priorityName ?? priority}</DetailRow>
        <DetailRow label={t("taskOpened")}>{ago(createdAt, t)}</DetailRow>
        <DetailRow label={t("taskWorked")}>
          {workedMs === null ? t("taskWorkedNone") : duration(workedMs, t)}
        </DetailRow>
        {tally.length > 0 && (
          <DetailRow label={t("logAtAGlance")}>
            <ul className="flex flex-col gap-1">
              {tally.map(({ kind, n }) => (
                <li key={kind} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: KIND_COLOR[kind] }} />
                  {n} {kindLabel(t, kind)}
                </li>
              ))}
            </ul>
          </DetailRow>
        )}
        <DetailRow label={t("filesInPlay")}>
          <Link href={filesHref} className="link-more">
            {files}
          </Link>
        </DetailRow>
      </dl>
    </aside>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-rule py-3 last:border-b-0">
      <dt className="text-meta text-faint">{label}</dt>
      <dd className="text-small text-muted">{children}</dd>
    </div>
  );
}
