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
import { repoLabel, repoLink } from "@/lib/util/paths";
import type { Task } from "@/lib/types";
import {
  addContextAction,
  createTaskAction,
  deleteContextAction,
  deleteProjectAction,
  setStatusAction,
} from "../../actions";
import { authMessages } from "../../auth-messages";
import { contextKindLabel, statusLabel } from "../../kinds";
import { AuthForm } from "../../features/auth-form";
import { SharePanel } from "../../features/share-panel";
import { SubmitButton } from "../../features/submit";
import { Blob, Chip, Counter, Empty, Field, Panel, StatusDot } from "../../components";

export const dynamic = "force-dynamic";

/**
 * How many rows one view will render.
 *
 * Every list on this page used to be unbounded, except the closed one, which
 * was silently cut at twenty -- so a project with more than that quietly
 * looked smaller than it was. A ceiling is fine; not saying so is not.
 */
const PAGE = 60;

/** Work first, and inside that the urgent first. Closed work sorts last. */
const RANK: Record<Status, number> = {
  doing: 0,
  blocked: 1,
  todo: 2,
  done: 3,
  dropped: 4,
};

type FilterId = "open" | Status | "all";

export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]">) {
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

  // Counted in the database. This used to load every entry of every task to
  // render three badges a row.
  const counts = await entriesRepo.countsByTasks(all.map((x) => x.id));

  const by = (s: Status) => all.filter((x) => x.status === s).length;
  const open = all.filter((x) => !["done", "dropped"].includes(x.status));
  const closed = all.filter((x) => ["done", "dropped"].includes(x.status));

  const filters: { id: FilterId; label: string; n: number }[] = [
    { id: "open", label: t("filterOpen"), n: open.length },
    { id: "doing", label: t("inFlight"), n: by("doing") },
    { id: "blocked", label: t("stuck"), n: by("blocked") },
    { id: "todo", label: t("queued"), n: by("todo") },
    { id: "done", label: t("doneDropped"), n: closed.length },
  ];

  const raw = (await searchParams).s;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const filter: FilterId = filters.some((f) => f.id === asked)
    ? (asked as FilterId)
    : "open";

  const matches = (task: Task) =>
    filter === "open"
      ? !["done", "dropped"].includes(task.status)
      : filter === "done"
        ? ["done", "dropped"].includes(task.status)
        : task.status === filter;

  const selected = all
    .filter(matches)
    .sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        a.priority - b.priority ||
        b.updated_at.localeCompare(a.updated_at),
    );
  const shown = selected.slice(0, PAGE);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;
  const repo = repoLink(project.repo_url);

  return (
    <div className="space-y-5">
      {/* One header, one line of identity. The local path used to sit up here
          at full width; it is where the repo happens to be on this laptop,
          which is plumbing, not a name. */}
      <header className="pop space-y-2">
        <nav aria-label={t("breadcrumb")} className="mono text-[12px] text-faint">
          <Link href="/" className="hover:text-ink">
            {t("projects")}
          </Link>{" "}
          / <span aria-current="page">{project.slug}</span>
        </nav>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="display text-[26px] leading-[1.1] font-bold sm:text-[33px]">
            {project.name}
          </h1>
          {repo && (
            <a
              href={repo}
              target="_blank"
              rel="noreferrer"
              className="mono link-more !text-[12.5px]"
            >
              {repoLabel(repo)} ↗
            </a>
          )}
        </div>

        {project.summary && (
          <p className="prose text-[14.5px] leading-relaxed text-muted">
            {project.summary}
          </p>
        )}

        {project.root_path && (
          <p className="mono truncate text-[11.5px] text-faint" title={project.root_path}>
            {t("localPathLabel")}: {project.root_path}
          </p>
        )}
      </header>

      {stale.length > 0 && (
        <div
          role="status"
          className="on-fill sticker pop flex items-start gap-3.5 p-4"
          style={{ background: "var(--k-question)", animationDelay: "40ms" }}
        >
          <Blob
            mood="worried"
            size={46}
            fill="var(--paper)"
            stroke="var(--ink)"
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="display text-[17px] font-bold">
              {stale.length === 1
                ? t("staleTitleOne")
                : t("staleTitleMany", { n: stale.length })}
            </p>
            <p className="mt-0.5 text-[14px]">{t("staleBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-[12px]">
              {stale.map((s) => (
                <li key={s} className="break-all">
                  · {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* The rail is fixed-width and sticks, so it cannot stretch the page the
          way a second flexible column did. Work is the only thing that grows. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <main className="min-w-0 space-y-4">
          <nav
            aria-label={t("taskFilterLabel")}
            className="pop flex flex-wrap gap-1.5"
            style={{ animationDelay: "60ms" }}
          >
            {filters.map((f) => {
              const active = f.id === filter;
              return (
                <Link
                  key={f.id}
                  href={f.id === "open" ? `/p/${slug}` : `/p/${slug}?s=${f.id}`}
                  aria-current={active ? "page" : undefined}
                  className="pill !text-[12.5px]"
                  style={
                    active
                      ? { background: "var(--accent)", color: "var(--on-fill)" }
                      : { background: "var(--inset)", color: "var(--muted)" }
                  }
                >
                  {f.label}
                  <span className="mono ml-1.5 opacity-70">{f.n}</span>
                </Link>
              );
            })}
          </nav>

          <Panel
            delay={100}
            title={filters.find((f) => f.id === filter)!.label}
            right={
              <Counter n={selected.length} label={t("tasks")} />
            }
          >
            <ul className="space-y-2">
              {shown.length === 0 && (
                <Empty mood={filter === "open" ? "happy" : "idle"}>
                  {filter === "open" ? t("allClear") : t("noTasksHere")}
                </Empty>
              )}

              {shown.map((task) => {
                const c = counts.get(task.id);
                const done = ["done", "dropped"].includes(task.status);
                return (
                  <li
                    key={task.id}
                    className="sticker-flat flex flex-wrap items-start gap-x-2.5 gap-y-2 p-3"
                  >
                    <span className="pt-1">
                      <StatusDot status={task.status} t={t} />
                    </span>

                    {/* The link wraps the text and nothing else. The row used
                        to be one big anchor, which left no legal place to put
                        a control on it. */}
                    <Link
                      href={`/p/${slug}/t/${task.id}`}
                      className="min-w-0 flex-1 basis-64 hover:text-ink"
                    >
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="mono text-[12px] text-faint">#{task.id}</span>
                        <span
                          className={`text-[15px] font-medium ${done ? "text-muted line-through decoration-1" : ""}`}
                        >
                          {task.title}
                        </span>
                        {task.priority === 1 && !done && (
                          <Chip color="var(--accent)" tilt={-3}>
                            p1
                          </Chip>
                        )}
                      </span>

                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {c && c.total > 0 && (
                          <Chip>
                            {c.total} {t("inLog")}
                          </Chip>
                        )}
                        {c && c.dead_ends > 0 && (
                          <Chip color="var(--k-dead_end)">
                            {c.dead_ends}{" "}
                            {c.dead_ends > 1 ? t("deadEndCountPlural") : t("deadEndCount")}
                          </Chip>
                        )}
                        {c && c.questions > 0 && (
                          <Chip color="var(--k-question)">
                            {c.questions} {t("askedCount")}
                          </Chip>
                        )}
                        <span className="mono text-[11px] text-faint">
                          {ago(task.updated_at, t)}
                        </span>
                      </span>
                    </Link>

                    {/* Moving a task is the commonest thing anybody does here.
                        It used to live in a second list in the sidebar, which
                        meant every task appeared on the page twice. */}
                    <form
                      action={setStatusAction}
                      className="ml-auto flex shrink-0 items-center gap-1.5"
                    >
                      <input type="hidden" name="task_id" value={task.id} />
                      <label className="sr-only" htmlFor={`st-${task.id}`}>
                        {t("statusLabel")} — {task.title}
                      </label>
                      <select
                        id={`st-${task.id}`}
                        name="status"
                        defaultValue={task.status}
                        className="!w-[108px] !px-2 !py-1 !text-[12.5px]"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(t, s)}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        className="btn btn-quiet !px-2.5 !py-[3px] !text-[12.5px]"
                        pendingLabel={t("working")}
                      >
                        {t("apply")}
                      </SubmitButton>
                    </form>
                  </li>
                );
              })}
            </ul>

            {selected.length > shown.length && (
              <p className="mt-3 border-t border-dashed border-rule pt-3 text-[13px] text-muted">
                {t("andMore", { n: selected.length - shown.length })}
              </p>
            )}

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
          </Panel>
        </main>

        {/* Sticky, and bounded by the viewport with its own scroll: pinned
            content taller than the screen has a bottom nobody can reach. */}
        <aside className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
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
                    <span className="display min-w-0 text-[14.5px] font-bold break-words">
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
                  {/* Clamped: these are paragraphs, and the rail is a summary.
                      The full text is one click away on hover/expand. */}
                  <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-relaxed whitespace-pre-wrap text-muted">
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
        </aside>
      </div>

      {/* Settings, once, at the end, closed. Sharing and deletion used to hold
          permanent space beside the work; nobody comes to this page to
          configure it. */}
      <details className="pop sticker overflow-hidden" style={{ animationDelay: "220ms" }}>
        <summary className="display cursor-pointer px-4 py-3 text-[16px] font-bold">
          {t("projectSettings")}
        </summary>

        <div className="space-y-5 border-t border-dashed border-rule p-4">
          <section>
            <h3 className="display mb-2 text-[15px] font-bold">{t("sharing")}</h3>
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
          </section>

          <section
            className="rounded-[10px] border-[1.5px] p-4"
            style={{ borderColor: "var(--k-dead_end)" }}
          >
            <h3 className="display mb-1 flex items-center gap-2 text-[15px] font-bold">
              <span
                aria-hidden="true"
                className="inline-block size-2.5 shrink-0 rounded-full border-[1.5px]"
                style={{
                  background: "var(--k-dead_end)",
                  borderColor: "var(--edge-dark)",
                }}
              />
              {t("deleteProject")}
            </h3>
            <p className="mb-3 text-[13.5px] text-muted">
              {t("deleteProjectNote", { n: all.length })}
            </p>
            <AuthForm
              action={deleteProjectAction}
              submitLabel={t("deleteProjectSubmit")}
              pendingLabel={t("working")}
              submitClassName="btn btn-danger"
              messages={authMessages(t)}
              hidden={{ project_id: String(project.id) }}
              fields={[
                {
                  name: "confirm",
                  label: t("deleteProjectConfirm", { slug: project.slug }),
                  autoComplete: "off",
                  exact: true,
                },
              ]}
            />
          </section>
        </div>
      </details>
    </div>
  );
}
