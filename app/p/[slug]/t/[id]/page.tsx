import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ENTRY_KINDS } from "@/lib/constants";
import { ago } from "@/lib/i18n";
import { byline } from "./byline";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
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
  statusOptions,
} from "../../../../kinds";
import { LogComposer, type KindStrings } from "../../../../features/log-composer";
import { Picker } from "../../../../features/picker";
import { SubmitButton } from "../../../../features/submit";
import {
  Blob,
  Chip,
  Counter,
  Empty,
  Field,
  Panel,
  RefBadge,
  StatusDot,
  Tabs,
  currentTab,
  type Tab,
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

  const [entries, refRows] = await Promise.all([
    entriesRepo.listByTask(task.id),
    refsRepo.listByTask(task.id),
  ]);
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

      <Panel
            title={
              <span className="flex items-center gap-2">
                <StatusDot status={task.status} t={t} /> {t("task")} #{task.id}
              </span>
            }
            right={
              <form action={setStatusAction} className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="task_id" value={task.id} />
                <Picker
                  name="status"
                  value={task.status}
                  options={statusOptions(t)}
                  label={t("statusLabel")}
                  applyLabel={t("apply")}
                  submitOnPick
                />
              </form>
            }
          >
            {/* Read first, edit on request.
                This page is opened to find out what a task is, and it used to
                answer with a form: the title in a textarea, the body in a
                second one, a priority select and a save button. Reading meant
                looking at controls, and because the thing that reads as the
                title was an editing control, the document had no real heading
                -- there was a visually hidden h1 duplicating it to make the
                outline valid, which is a workaround for a layout problem
                rather than a fix.

                The title is now the heading it always was. Editing is a
                `details`, the same disclosure the new-project form and the
                kinds reference already use, so it still works with no
                JavaScript and the Server Action still lives in a real form. */}
            <h1 className="display text-[21px] leading-snug font-bold sm:text-[24px]">
              {task.title}
            </h1>

            {task.body && (
              <p className="prose mt-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-muted">
                {task.body}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {/* Only when it is not the middle one, the way the project page
                  already does it: a badge every task carries says nothing. */}
              {task.priority !== 2 && (
                <Chip color={task.priority === 1 ? "var(--accent)" : "var(--k-note)"} tilt={-3}>
                  {task.priority === 1 ? t("p1") : t("p3")}
                </Chip>
              )}
              <span className="mono text-[11px] text-faint">
                {t("updated")} {ago(task.updated_at, t)}
              </span>
            </div>

            <details className="mt-3">
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
              {entries.map((e, i) => (
                <li key={e.id} className="group relative flex gap-3">
                  <div className="flex w-4 flex-col items-center" aria-hidden="true">
                    <span
                      className="mt-1 size-4 shrink-0 rounded-full border-[1.5px] border-line"
                      style={{ background: KIND_COLOR[e.kind], borderColor: "var(--edge-dark)" }}
                    />
                    {i < entries.length - 1 && (
                      <span className="w-0 flex-1 border-l border-dashed border-rule" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip
                        color={KIND_COLOR[e.kind]}
                        title={kindHint(t, e.kind)}
                        tilt={i % 2 ? 1.5 : -1.5}
                      >
                        {kindLabel(t, e.kind)}
                      </Chip>
                      <span className="mono text-[11px] text-faint">
                        {byline(t, e)}{ago(e.created_at, t)}
                      </span>
                      <form action={deleteEntryAction} className="ml-auto">
                        <input type="hidden" name="entry_id" value={e.id} />
                        <SubmitButton
                          className="link-more row-action text-meta"
                          pendingLabel={t("working")}
                        >
                          {t("delete")}
                          <span className="sr-only"> — {kindLabel(t, e.kind)}</span>
                        </SubmitButton>
                      </form>
                    </div>
                    <p className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                      {e.body}
                    </p>
                  </div>
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
                  {r.note && <p className="mt-1 text-[13.5px] text-muted">{r.note}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RefBadge status={r.state} t={t} />
                    <span className="mono text-[11px] text-faint">
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
              <Blob mood="idle" size={44} fill="var(--k-handoff)" className="shrink-0" />
              <p className="text-[14px] text-muted">
                <code className="mono rounded border-[1.5px] border-line bg-accent px-1 text-[13px] break-all text-onFill">
                  get_context(&quot;{slug}&quot;)
                </code>{" "}
                {t("agentSeesBody")}
              </p>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
