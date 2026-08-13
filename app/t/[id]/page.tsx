import Link from "next/link";
import { notFound } from "next/navigation";

import { ENTRY_KINDS } from "@/lib/constants";
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
  acceptRefAction,
  setStatusAction,
  unlinkRefAction,
  updateTaskAction,
} from "../../actions";
import {
  KIND_COLOR,
  kindHint,
  kindLabel,
  kindPlaceholder,
  priorityOptions,
  statusOptions,
} from "../../kinds";
import { LogComposer, type KindStrings } from "../../features/log-composer";
import { Picker } from "../../features/picker";
import { SubmitButton } from "../../features/submit";
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
} from "../../components";

export const dynamic = "force-dynamic";

/**
 * Tasks live at `/t/[id]?in=parent/child` rather than under `/p/[...path]/t/`,
 * because Next.js won't let a catch-all be followed by another segment.
 *
 * `in` is the project's slug chain. Without it the same task id would be
 * ambiguous across projects, so the route resolves to 404 when it is missing
 * or wrong rather than guessing.
 */
export default async function TaskPage({
  params,
  searchParams,
}: PageProps<"/t/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const inPath = typeof sp.in === "string" ? sp.in : Array.isArray(sp.in) ? sp.in[0] : "";
  const segments = inPath.split("/").filter(Boolean);
  const user = await requireUser();
  const { t } = await getT();
  const [project, task] = await Promise.all([
    segments.length > 0 ? projects.byPath(user.id, segments) : Promise.resolve(undefined),
    tasksRepo.byId(Number(id)),
  ]);
  if (!project || !task || task.project_id !== project.id) notFound();

  const urlPath = segments.join("/");

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
    { id: "log", label: t("tabLog"), href: `/t/${id}?in=${urlPath}`, count: entries.length },
    {
      id: "files",
      label: t("tabFiles"),
      href: `/t/${id}?in=${urlPath}&t=files`,
      count: refs.length,
    },
  ];
  const tab = currentTab(tabs, sp.t);

  return (
    <div className="space-y-5">
      <nav aria-label={t("breadcrumb")} className="mono pop text-[12px] text-faint">
        <Link href="/" className="hover:text-ink">
          {t("projects")}
        </Link>
        {segments.slice(0, -1).map((seg, i) => {
          const upTo = segments.slice(0, i + 1).join("/");
          return (
            <span key={upTo}>
              {" / "}
              <Link href={`/p/${upTo}`} className="hover:text-ink">
                {seg}
              </Link>
            </span>
          );
        })}{" "}
        /{" "}
        <Link href={`/p/${urlPath}`} className="hover:text-ink">
          {project.slug}
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
            <form action={updateTaskAction} className="space-y-2">
              <input type="hidden" name="task_id" value={task.id} />
              {/* textarea, not input: long titles are the norm here and an
                  input would clip the thing you most need to read */}
              <Field label={t("taskTitlePh")} hidden>
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
                <span className="mono ml-auto text-[11px] text-faint">
                  {t("updated")} {ago(task.updated_at, t)}
                </span>
              </div>
            </form>
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
                      {/* A name when there is one. `author` only ever said
                          'human' or 'agent', which answers nothing once two
                          people share a project -- and it is still the answer
                          for entries written before the column existed, or
                          whose author has since deleted their account. */}
                      <span className="mono text-[11px] text-faint">
                        {t("by")} {e.author_name ?? e.author} · {ago(e.created_at, t)}
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
                  get_context(&quot;{urlPath}&quot;)
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
