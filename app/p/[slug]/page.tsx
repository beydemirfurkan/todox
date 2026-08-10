import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CONTEXT_KINDS, STATUSES, type Status } from "@/lib/constants";
import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as tasksRepo from "@/lib/repositories/tasks";
import { staleRefs } from "@/lib/services/briefing";
import {
  addContextAction,
  createTaskAction,
  deleteContextAction,
  setStatusAction,
} from "../../actions";
import { contextKindLabel, statusLabel } from "../../kinds";
import { SharePanel } from "../../features/share-panel";
import { SubmitButton } from "../../features/submit";
import { Blob, Chip, Counter, Empty, Field, Panel, StatusDot } from "../../components";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const { t } = await getT();
  const project = await projects.bySlug(user.id, slug);
  if (!project) notFound();

  const [all, projectContext, stale] = await Promise.all([
    tasksRepo.listByProject(project.id, "all"),
    contexts.listByProject(user.id, project.id),
    staleRefs(user.id, project),
  ]);
  const closed = all.filter((x) => x.status === "done" || x.status === "dropped");

  // One query for every task's log, rather than one per row in the list.
  const logs = await entriesRepo.listByTasks(all.map((x) => x.id));

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;

  const groups: { status: Status; label: string; empty: string }[] = [
    { status: "doing", label: t("inFlight"), empty: t("nothingInFlight") },
    { status: "blocked", label: t("stuck"), empty: t("nothingStuck") },
    { status: "todo", label: t("queued"), empty: t("emptyQueue") },
  ];

  return (
    <div className="space-y-6">
      <div className="pop flex flex-wrap items-end gap-3">
        <div className="prose">
          <nav aria-label={t("breadcrumb")} className="mono mb-1 text-[12px] text-faint">
            <Link href="/" className="hover:text-ink">
              {t("projects")}
            </Link>{" "}
            / <span aria-current="page">{project.slug}</span>
          </nav>
          <h1 className="display text-[26px] leading-[1.1] font-bold sm:text-[33px]">
            {project.name}
          </h1>
          {project.summary && (
            <p className="mt-1.5 text-[14.5px] text-muted">{project.summary}</p>
          )}
        </div>
        {project.root_path && (
          <span
            title={project.root_path}
            className="mono sticker-flat ml-auto max-w-full min-w-0 truncate px-2 py-1 text-[12px] text-muted"
          >
            {project.root_path}
          </span>
        )}
      </div>

      {stale.length > 0 && (
        <div
          role="status"
          className="on-fill sticker pop flex items-start gap-3.5 p-4"
          style={{ background: "var(--k-question)", animationDelay: "40ms" }}
        >
          <Blob mood="worried" size={46} fill="var(--paper)" stroke="var(--ink)" className="shrink-0" />
          <div className="min-w-0">
            <p className="display text-[17px] font-bold">
              {stale.length === 1
                ? t("staleTitleOne")
                : t("staleTitleMany", { n: stale.length })}
            </p>
            <p className="mt-0.5 text-[14px]">{t("staleBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-[12px]">
              {stale.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-5">
          {groups.map(({ status, label, empty }, gi) => {
            const tasks = all.filter((x) => x.status === status);
            if (!tasks.length && status !== "todo") return null;
            return (
              <Panel
                key={status}
                delay={80 + gi * 60}
                title={label}
                right={<Counter n={tasks.length} label={label} />}
              >
                <ul className="space-y-2">
                  {tasks.length === 0 && <Empty>{empty}</Empty>}
                  {tasks.map((task) => {
                    const entries = logs.get(task.id) ?? [];
                    const dead = entries.filter((e) => e.kind === "dead_end").length;
                    const asked = entries.filter((e) => e.kind === "question").length;
                    return (
                      <li key={task.id}>
                        <Link
                          href={`/p/${slug}/t/${task.id}`}
                          className="sticker-flat lift flex items-start gap-2.5 p-3"
                        >
                          <span className="pt-1">
                            <StatusDot status={task.status} t={t} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-baseline gap-2">
                              <span className="mono text-[12px] text-faint">
                                #{task.id}
                              </span>
                              <span className="text-[15px] font-medium">
                                {task.title}
                              </span>
                              {task.priority === 1 && (
                                <Chip color="var(--accent)" tilt={-3}>
                                  p1
                                </Chip>
                              )}
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {entries.length > 0 && (
                                <Chip>
                                  {entries.length} {t("inLog")}
                                </Chip>
                              )}
                              {dead > 0 && (
                                <Chip color="var(--k-dead_end)">
                                  {dead}{" "}
                                  {dead > 1 ? t("deadEndCountPlural") : t("deadEndCount")}
                                </Chip>
                              )}
                              {asked > 0 && (
                                <Chip color="var(--k-question)">
                                  {asked} {t("askedCount")}
                                </Chip>
                              )}
                              <span className="mono text-[11px] text-faint">
                                {ago(task.updated_at, t)}
                              </span>
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                {status === "todo" && (
                  <details className="mt-3 border-t border-dashed border-rule pt-3">
                    <summary className="link-more">{t("newTask")}</summary>
                    <form action={createTaskAction} className="mt-3 space-y-2">
                      <input type="hidden" name="slug" value={slug} />
                      <Field label={t("taskTitlePh")}>
                        <input name="title" placeholder={t("taskTitlePh")} required />
                      </Field>
                      <Field label={t("taskBodyPh")}>
                        <textarea name="body" placeholder={t("taskBodyPh")} />
                      </Field>
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label={t("priorityLabel")} className="!w-40">
                          <select name="priority" defaultValue="2">
                            <option value="1">{t("p1")}</option>
                            <option value="2">{t("p2")}</option>
                            <option value="3">{t("p3")}</option>
                          </select>
                        </Field>
                        <SubmitButton pendingLabel={t("working")}>{t("add")}</SubmitButton>
                      </div>
                    </form>
                  </details>
                )}
              </Panel>
            );
          })}

          {closed.length > 0 && (
            <Panel
              delay={260}
              title={t("doneDropped")}
              right={<Counter n={closed.length} label={t("doneDropped")} />}
            >
              <ul className="space-y-1">
                {closed.slice(0, 20).map((task) => (
                  <li key={task.id}>
                    <Link
                      href={`/p/${slug}/t/${task.id}`}
                      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-[14px] text-muted hover:bg-inset hover:text-ink"
                    >
                      <StatusDot status={task.status} t={t} />
                      <span className="mono text-[12px]">#{task.id}</span>
                      <span className="truncate line-through decoration-1">
                        {task.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <Panel
            delay={140}
            title={t("projectContext")}
            right={<Counter n={projectContext.length} label={t("projectContext")} />}
          >
            <div className="space-y-3">
              {projectContext.length === 0 && <Empty>{t("projectContextEmpty")}</Empty>}
              {projectContext.map((c) => (
                <div key={c.id} className="sticker-flat group p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color="var(--k-decision)" tilt={-2}>
                      {contextKindLabel(t, c.kind)}
                    </Chip>
                    <span className="display min-w-0 text-[15px] font-bold break-words">
                      {c.title}
                    </span>
                    <form action={deleteContextAction} className="ml-auto">
                      <input type="hidden" name="context_id" value={c.id} />
                      <SubmitButton
                        className="link-more row-action !text-[12px]"
                        pendingLabel={t("working")}
                      >
                        {t("delete")}
                        <span className="sr-only"> — {c.title}</span>
                      </SubmitButton>
                    </form>
                  </div>
                  <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-wrap text-muted">
                    {c.body}
                  </p>
                </div>
              ))}
              <details>
                <summary className="link-more">{t("add")}</summary>
                <form action={addContextAction} className="mt-3 space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <Field label={t("projectContext")}>
                    <select name="kind">
                      {CONTEXT_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {contextKindLabel(t, k)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("title")}>
                    <input name="title" placeholder={t("title")} required />
                  </Field>
                  <Field label={t("noteBodyPh")}>
                    <textarea name="body" placeholder={t("noteBodyPh")} required />
                  </Field>
                  <SubmitButton className="btn btn-quiet" pendingLabel={t("saving")}>
                    {t("save")}
                  </SubmitButton>
                </form>
              </details>
            </div>
          </Panel>

          <Panel delay={200} title={t("sharing")}>
            <SharePanel
              projectId={project.id}
              token={project.share_token}
              includeLog={project.share_log === 1}
              origin={origin}
              canShare={Boolean(user.email_verified_at)}
              s={{
                off: t("shareOff"),
                on: t("shareOn"),
                enable: t("shareEnable"),
                disable: t("shareDisable"),
                rotate: t("shareRotate"),
                includeLog: t("shareIncludeLog"),
                copy: t("shareCopy"),
                copied: t("shareCopied"),
                scopeNote: t("shareScopeNote"),
                reachNote: t("shareReachNote"),
                apply: t("apply"),
                blocked: t("verifyBlockedShare"),
                working: t("working"),
              }}
            />
          </Panel>

          <Panel delay={240} title={t("moveAlong")}>
            <div className="space-y-2">
              {all
                .filter((x) => x.status === "todo" || x.status === "doing")
                .slice(0, 8)
                .map((task) => (
                  <form
                    key={task.id}
                    action={setStatusAction}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="task_id" value={task.id} />
                    <span className="mono w-8 shrink-0 text-[12px] text-faint">
                      #{task.id}
                    </span>
                    {/* Takes the whole first line on a phone, so the select and
                        its button keep their own -- the three of them never fitted
                        across a narrow screen. */}
                    <span className="min-w-0 flex-1 basis-full truncate text-[13.5px] text-muted sm:basis-auto">
                      {task.title}
                    </span>
                    <label className="sr-only" htmlFor={`st-${task.id}`}>
                      {t("statusLabel")} — {task.title}
                    </label>
                    <select
                      id={`st-${task.id}`}
                      name="status"
                      defaultValue={task.status}
                      className="!w-[116px] shrink-0 !px-2 !py-1 !text-[13px]"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(t, s)}
                        </option>
                      ))}
                    </select>
                    <SubmitButton
                      className="btn btn-quiet !px-3 !py-[3px] !text-[13px]"
                      pendingLabel={t("working")}
                    >
                      {t("apply")}
                    </SubmitButton>
                  </form>
                ))}
              {all.filter((x) => x.status === "todo" || x.status === "doing").length ===
                0 && <Empty mood="happy">{t("allClear")}</Empty>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
