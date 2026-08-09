import Link from "next/link";
import { notFound } from "next/navigation";

import { ENTRY_KINDS, STATUSES } from "@/lib/constants";
import { ago } from "@/lib/i18n";
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
  refreshRefAction,
  setStatusAction,
  unlinkRefAction,
  updateTaskAction,
} from "../../../../actions";
import {
  KIND_COLOR,
  kindHint,
  kindLabel,
  kindPlaceholder,
  statusLabel,
} from "../../../../kinds";
import { LogComposer, type KindStrings } from "../../../../features/log-composer";
import {
  Blob,
  Chip,
  Counter,
  Empty,
  Field,
  Panel,
  RefBadge,
  StatusDot,
} from "../../../../components";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: PageProps<"/p/[slug]/t/[id]">) {
  const { slug, id } = await params;
  const user = await requireUser();
  const { t } = await getT();
  const [project, task] = await Promise.all([
    projects.bySlug(user.id, slug),
    tasksRepo.byId(Number(id)),
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

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-5">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <StatusDot status={task.status} t={t} /> {t("task")} #{task.id}
              </span>
            }
            right={
              <form action={setStatusAction} className="flex items-center gap-1.5">
                <input type="hidden" name="task_id" value={task.id} />
                <label className="sr-only" htmlFor="task-status">
                  {t("statusLabel")}
                </label>
                <select
                  id="task-status"
                  name="status"
                  defaultValue={task.status}
                  className="!w-[116px] !px-2 !py-1 !text-[13px]"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(t, s)}
                    </option>
                  ))}
                </select>
                <button className="btn btn-quiet !px-3 !py-[3px] !text-[13px]">
                  {t("apply")}
                </button>
              </form>
            }
          >
            <form action={updateTaskAction} className="space-y-2">
              <input type="hidden" name="task_id" value={task.id} />
              {/* textarea, not input: long titles are the norm here and an
                  input would clip the thing you most need to read */}
              <Field label={t("taskTitlePh")}>
                <textarea
                  name="title"
                  rows={2}
                  defaultValue={task.title}
                  className="display !min-h-0 !text-[20px] !leading-snug !font-bold"
                />
              </Field>
              <Field label={t("taskBodyPh")}>
                <textarea
                  name="body"
                  defaultValue={task.body ?? ""}
                  placeholder={t("taskBodyPh")}
                />
              </Field>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("priorityLabel")} className="!w-40">
                  <select name="priority" defaultValue={String(task.priority)}>
                    <option value="1">{t("p1")}</option>
                    <option value="2">{t("p2")}</option>
                    <option value="3">{t("p3")}</option>
                  </select>
                </Field>
                <button className="btn btn-quiet">{t("save")}</button>
                <span className="mono ml-auto text-[11px] text-faint">
                  {t("updated")} {ago(task.updated_at, t)}
                </span>
              </div>
            </form>
          </Panel>

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
                        {t("by")} {e.author} · {ago(e.created_at, t)}
                      </span>
                      <form action={deleteEntryAction} className="ml-auto">
                        <input type="hidden" name="entry_id" value={e.id} />
                        <button className="link-more row-action !text-[12px]">
                          {t("delete")}
                          <span className="sr-only"> — {kindLabel(t, e.kind)}</span>
                        </button>
                      </form>
                    </div>
                    <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-wrap">
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
            />
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
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
                    </span>
                    <span className="row-action ml-auto flex gap-2">
                      {r.state === "changed" && (
                        <form action={refreshRefAction}>
                          <input type="hidden" name="ref_id" value={r.id} />
                          <button className="link-more !text-[12px]">{t("rehash")}</button>
                        </form>
                      )}
                      <form action={unlinkRefAction}>
                        <input type="hidden" name="ref_id" value={r.id} />
                        <button className="link-more !text-[12px]">{t("unlink")}</button>
                      </form>
                    </span>
                  </div>
                </div>
              ))}
              <form action={linkFileAction} className="space-y-2 pt-1">
                <input type="hidden" name="task_id" value={task.id} />
                <Field label={t("filePathPh")}>
                  <input
                    name="path"
                    placeholder={`${project.root_path ?? ""}${t("filePathPh")}`}
                    className="mono !text-[12.5px]"
                    required
                  />
                </Field>
                <Field label={t("fileNotePh")}>
                  <input name="note" placeholder={t("fileNotePh")} className="!text-[14px]" />
                </Field>
                <button className="btn btn-quiet">{t("link")}</button>
              </form>
            </div>
          </Panel>

          <Panel delay={190} title={t("whatAgentSees")}>
            <div className="flex items-start gap-3">
              <Blob mood="idle" size={44} fill="var(--k-handoff)" className="shrink-0" />
              <p className="text-[14px] text-muted">
                <code className="mono rounded border-[1.5px] border-line bg-accent px-1 text-[13px] text-onFill">
                  get_context(&quot;{slug}&quot;)
                </code>{" "}
                {t("agentSeesBody")}
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
