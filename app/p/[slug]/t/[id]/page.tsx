import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ENTRY_KINDS, STATUSES, type EntryKind } from "@/lib/constants";
import { ago, type T } from "@/lib/i18n";
import { byline } from "./byline";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import * as entryDeletions from "@/lib/repositories/entry-deletions";
import * as entriesRepo from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as refsRepo from "@/lib/repositories/refs";
import * as tasksRepo from "@/lib/repositories/tasks";
import {
  addEntryAction,
  deleteEntryAction,
  linkFileAction,
  acceptRefAction,
  setStatusAction,
  unlinkRefAction,
  updateTaskAction,
} from "../../../../actions";
import {
  KIND_COLOR,
  kindHint,
  kindLabel,
  kindPlaceholder,
  priorityOptions,
  statusLabel,
} from "../../../../kinds";
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
  StatusDot,
  type Tab,
  Tabs,
  StatBadges,
} from "../../../../components";
import { privatePageMetadata } from "../../../../metadata-shared";

export const dynamic = "force-dynamic";

/**
 * The task at the top, then one thing at a time.
 *
 * This was a 1.5fr/1fr grid with everything open at once, which meant the log
 * -- the reason the page exists, and the only part that grows without bound --
 * was reading in the narrower two-thirds while a static explainer held a
 * column beside it. The log gets the full width now and the files get their
 * own tab, which is where the explainer belongs anyway.
 */
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

  const [entries, refRows, deletions] = await Promise.all([
    entriesRepo.listByTask(task.id),
    refsRepo.listByTask(task.id),
    entryDeletions.listByTask(task.id),
  ]);
  // Who may delete is decided in lib/services/ownership.ts; this only hides
  // a control that would answer 404, it guards nothing.
  const isOwner = project.user_id === user.id;
  const canDelete = (e: { user_id?: number | null }) => isOwner || e.user_id === user.id;
  const timeline = [
    ...entries.map((e) => ({ type: "entry" as const, at: e.created_at, e })),
    ...deletions.map((d) => ({ type: "deleted" as const, at: d.created_at, d })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const refs = refRows.map((r) => ({ ...r, state: refsRepo.freshness(r) }));

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

  return (
    <div className="space-y-5">
      <nav aria-label={t("breadcrumb")} className="mono pop text-[12px] text-faint">
        <Link href="/" className="hover:text-ink">
          {t("projects")}
        </Link>{" "}
        /{" "}
        <Link href={`/p/${slug}`} className="hover:text-ink">
          {slug}
        </Link>{" "}
        / <span aria-current="page">#{task.id}</span>
      </nav>

      <header className="pop space-y-4">
        <h1 className="display max-w-[30ch] text-[30px] leading-[1.12] break-words sm:text-[40px]">
          {task.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="mono text-meta text-faint">#{task.id}</span>
          {/* Only when it is not the middle one: a badge every task carries
              says nothing. */}
          {task.priority !== 2 && (
            <Chip color={task.priority === 1 ? "var(--accent)" : "var(--k-note)"}>
              {task.priority === 1 ? t("p1") : t("p3")}
            </Chip>
          )}
          <span className="mono text-meta text-faint">
            {t("updated")} {ago(task.updated_at, t)}
          </span>
        </div>
        {/* One form, one button per status: the button pressed is the value,
            so it needs no script, and the current status stays focusable and
            says so with `aria-pressed` rather than going `disabled`. */}
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
                  className="pill seg gap-2"
                >
                  <StatusDot status={status} t={t} />
                  <span aria-hidden="true">{statusLabel(t, status)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </form>
      </header>

      <KindTally entries={entries} files={refs.length} t={t} />

      <div className="min-w-0 space-y-5">
      <Panel delay={40} title={t("taskBrief")}>
            {/* Clamped: the brief sits between the reader and the history
                they came for, and the median body is 1,384 characters. */}
            {task.body ? (
              <ExpandableText
                text={task.body}
                more={t("showMore")}
                less={t("showLess")}
                className="prose text-[15px] leading-relaxed text-muted"
              />
            ) : (
              <p className="text-small text-muted">{t("taskNoBrief")}</p>
            )}

            {/* Read first, edit on request: a disclosure, so it works with no
                JavaScript and the Server Action still lives in a real form. */}
            <details className="mt-4">
              <summary className="link-more text-meta">{t("editTask")}</summary>
              <form action={updateTaskAction} className="mt-3 space-y-2">
                <input type="hidden" name="task_id" value={task.id} />
                {/* textarea, not input: long titles are the norm here and an
                    input would clip the thing you most need to read */}
                <Field label={t("taskTitlePh")}>
                  <textarea
                    name="title"
                    rows={2}
                    defaultValue={task.title}
                    className="textarea-title"
                  />
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
      </Panel>

      <Tabs tabs={tabs} current={tab} label={t("taskSections")} />

      {tab === "log" && (
        <Panel
            delay={70}
            title={t("theLog")}
            right={<Counter n={entries.length} label={t("theLog")} />}
          >
            {entries.length === 0 && <Empty>{t("logEmpty")}</Empty>}
            <ol>
              {timeline.map((item, i) =>
                item.type === "deleted" ? (
                  <li key={`deleted-${item.d.id}`} className="relative flex gap-3">
                    <div className="flex w-3 flex-col items-center" aria-hidden="true">
                      <span className="mt-1.5 size-3 shrink-0 rounded-full border border-dashed border-rule" />
                      {i < timeline.length - 1 && <span className="mt-1 w-0 flex-1 border-l border-rule" />}
                    </div>
                    <p className="min-w-0 flex-1 pb-6 text-meta text-faint italic">
                      {item.d.author_name && item.d.author_name === item.d.deleted_by_name
                        ? t("entryDeletedOwn", {
                            who: item.d.deleted_by_name,
                            kind: kindLabel(t, item.d.kind as EntryKind),
                          })
                        : t("entryDeleted", {
                            who: item.d.deleted_by_name ?? t("unknownPerson"),
                            author: item.d.author_name ?? t("unknownPerson"),
                            kind: kindLabel(t, item.d.kind as EntryKind),
                          })}
                      {" · "}
                      {ago(item.d.deleted_at, t)}
                    </p>
                  </li>
                ) : (
                <li key={item.e.id} className="group relative flex gap-3">
                  <div className="flex w-3 flex-col items-center" aria-hidden="true">
                    <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: KIND_COLOR[item.e.kind] }} />
                    {i < timeline.length - 1 && <span className="mt-1 w-0 flex-1 border-l border-rule" />}
                  </div>
                  <article className="min-w-0 flex-1 pb-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip color={KIND_COLOR[item.e.kind]} title={kindHint(t, item.e.kind)}>
                        {kindLabel(t, item.e.kind)}
                      </Chip>
                      <span className="mono text-meta text-faint">
                        {byline(t, item.e)}{ago(item.e.created_at, t)}
                      </span>
                      {canDelete(item.e) && (
                        <form action={deleteEntryAction} className="ml-auto">
                          <input type="hidden" name="entry_id" value={item.e.id} />
                          <SubmitButton
                            className="link-more row-action text-meta"
                            pendingLabel={t("working")}
                          >
                            {t("delete")}
                            <span className="sr-only"> — {kindLabel(t, item.e.kind)}</span>
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                    <EntryBody body={item.e.body} more={t("showMore")} less={t("showLess")} />
                  </article>
                </li>
                ),
              )}
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
        </Panel>
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
    </div>
  );
}

/**
 * The log at a glance, under the title: how many decisions, dead ends, open
 * questions and handoffs this task carries, and the files in play. A person
 * opening a task asks "has this been tried, is anything waiting on me"
 * before they read a single entry.
 */
function KindTally({
  entries,
  files,
  t,
}: {
  entries: { kind: EntryKind }[];
  files: number;
  t: T;
}) {
  const kinds: EntryKind[] = ["decision", "dead_end", "question", "handoff"];
  return (
    <StatBadges
      label={t("logAtAGlance")}
      className="pop"
      style={{ animationDelay: "40ms" }}
      stats={[
        ...kinds.map((kind) => ({
          label: kindLabel(t, kind),
          value: entries.filter((e) => e.kind === kind).length,
          mark: KIND_COLOR[kind],
        })),
        { label: t("filesInPlay"), value: files, mark: "var(--k-note)", href: "?t=files" },
      ]}
    />
  );
}
