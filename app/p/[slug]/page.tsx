import Link from "next/link";
import { notFound } from "next/navigation";

import { CONTEXT_KINDS, type Status } from "@/lib/constants";
import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { requireUser } from "@/lib/session";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as membershipsRepo from "@/lib/repositories/project-memberships";
import * as tasksRepo from "@/lib/repositories/tasks";
import { staleRefs } from "@/lib/services/briefing";
import { repoLabel, repoLink } from "@/lib/util/paths";
import {
  addContextAction,
  createTaskAction,
  deleteContextAction,
  deleteProjectAction,
  setStatusAction,
  inviteProjectAction,
  removeProjectMemberAction,
  revokeProjectInviteAction,
} from "../../actions";
import { authMessages } from "../../auth-messages";
import {
  contextKindLabel,
  kindOptions,
  priorityOptions,
  statusOptions,
} from "../../kinds";
import { AuthForm } from "../../features/auth-form";
import { SharePanel } from "../../features/share-panel";
import { Picker } from "../../features/picker";
import { SubmitButton } from "../../features/submit";
import { ProjectSettingsDrawer } from "../../features/project-settings-drawer";
import { Blob, Chip, Counter, Empty, Field, Panel, StatusDot } from "../../components";
import {
  compareTasks,
  isClosed,
  matchesFilter,
  paginate,
  resolveFilter,
  type FilterId,
} from "./task-list";

export const dynamic = "force-dynamic";

/**
 * Filtering, ordering and the ceiling live in `./task-list`, where they can be
 * asserted without standing a page up. What is left here is markup.
 */

export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const user = await requireUser();
  const { t } = await getT();
  const project = await projects.bySlug(user.id, slug);
  if (!project) notFound();

  const owner = project.access_role === "owner";
  const [all, projectContext, stale, members, invitations] = await Promise.all([
    tasksRepo.listByProject(project.id, "all"),
    contexts.listByProject(user.id, project.id),
    staleRefs(user.id, project),
    // Everyone with access sees who else has it. This used to be owner-only,
    // which meant the person who had just been invited into a project could
    // not see that anybody else was in it -- including, from their side, that
    // the collaboration existed at all.
    membershipsRepo.listByProject(project.id),
    // Pending invitations stay with the owner: an address that has not
    // accepted yet is not the team's business.
    owner ? invitationsRepo.listByProject(project.id) : Promise.resolve([]),
  ]);

  // Counted in the database. This used to load every entry of every task to
  // render three badges a row.
  const counts = await entriesRepo.countsByTasks(all.map((x) => x.id));

  const by = (s: Status) => all.filter((x) => x.status === s).length;
  const open = all.filter((x) => !isClosed(x.status));
  const closed = all.filter((x) => isClosed(x.status));

  const filters: { id: FilterId; label: string; n: number }[] = [
    { id: "open", label: t("filterOpen"), n: open.length },
    { id: "doing", label: t("inFlight"), n: by("doing") },
    { id: "blocked", label: t("stuck"), n: by("blocked") },
    { id: "todo", label: t("queued"), n: by("todo") },
    { id: "done", label: t("doneDropped"), n: closed.length },
  ];

  const filter = resolveFilter(
    (await searchParams).s,
    filters.map((f) => f.id),
  );

  const selected = all.filter((task) => matchesFilter(task, filter)).sort(compareTasks);
  const { shown } = paginate(selected);

  const origin = publicUrl();
  const repo = repoLink(project.repo_url);

  return (
    <div className="space-y-5">
      {/* One header, one line of identity. The local path used to sit up here
          at full width; it is where the repo happens to be on this laptop,
          which is plumbing, not a name. */}
      <header className="pop space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <nav aria-label={t("breadcrumb")} className="mono text-[12px] text-faint">
            <Link href="/" className="hover:text-ink">
              {t("projects")}
            </Link>{" "}
            / <span aria-current="page">{project.slug}</span>
          </nav>
          {/* Beside the name, not after the work. It used to be a full-width
              button at the foot of the page, which gave a settings dialog more
              visual weight than anything on the page it configures -- and put
              it past the end of a list that can run to sixty rows. */}
          {owner && (
            <ProjectSettingsDrawer
              title={t("projectSettings")}
              closeLabel={t("close")}
              className="ml-auto shrink-0 text-small"
            >
              <div className="space-y-5">
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
            </ProjectSettingsDrawer>
          )}
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="display text-[26px] leading-[1.1] font-bold sm:text-[33px]">
            {project.name}
          </h1>
          {/* Whose project this is, said once and up front. A joined project
              used to be indistinguishable from your own. */}
          {!owner && project.owner_name && (
            <Chip color="var(--k-handoff)" tilt={-2}>
              {t("sharedBy", { name: project.owner_name })}
            </Chip>
          )}
          {repo && (
            <a
              href={repo}
              target="_blank"
              rel="noreferrer"
              className="mono link-more text-small"
            >
              {repoLabel(repo)} ↗
            </a>
          )}
        </div>

        {project.summary && (
          <p className="prose min-w-3xl text-[14.5px] leading-relaxed text-muted">
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
            {filters.map((f) => (
              <Link
                key={f.id}
                href={f.id === "open" ? `/p/${slug}` : `/p/${slug}?s=${f.id}`}
                aria-current={f.id === filter ? "page" : undefined}
                className="pill seg"
              >
                {f.label}
                <span className="mono ml-1.5 opacity-70">{f.n}</span>
              </Link>
            ))}
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
                      {/* Choosing applies it. The apply button next to this was
                          a second click for the thing people do most, and it
                          only ever existed because a native select cannot post
                          a form on its own without script. It still appears
                          when there is none. */}
                      <Picker
                        name="status"
                        value={task.status}
                        options={statusOptions(t)}
                        label={`${t("statusLabel")} — ${task.title}`}
                        applyLabel={t("apply")}
                        submitOnPick
                      />
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
                  <input name="title" required />
                </Field>
                <Field label={t("taskBodyPh")}>
                  <textarea name="body" />
                </Field>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("priorityLabel")} className="w-40">
                    <Picker
                      name="priority"
                      value="2"
                      options={priorityOptions(t)}
                      label={t("priorityLabel")}
                    />
                  </Field>
                  <SubmitButton pendingLabel={t("working")}>{t("add")}</SubmitButton>
                </div>
              </form>
            </details>
          </Panel>
        </main>

        {/* Not pinned, and not scrolling inside itself.
            It was both, which meant a second scroll context nested in the
            page: cards came away sliced through the middle at the top and
            bottom edges with nothing to say why, and the seam moved as the
            page moved. The rail is reference material -- notes and a roster --
            and there is no reason it has to stay on screen while the work
            scrolls past it. As an ordinary column every card is whole and
            every one of them is reachable. */}
        {/* `space-y` because the rail holds two panels now. It held one for as
            long as it existed, so nothing here had ever needed a gap -- and
            the two arrived stacked edge to edge, reading as one broken card.
            Same 1.25rem the grid puts between the rail and the work. */}
        <aside className="min-w-0 mt-9 space-y-5">
          {/* Who is in this, above the notes, because it is the fact the rest
              of the page reads differently in light of. The owner keeps the
              controls; everybody else gets the roster, which is the part that
              answers "am I working with somebody here". */}
          <Panel
            delay={120}
            className="border-none shadow-none dropshadow-none"
            title={t("team")}
            right={<Counter n={members.length + 1} label={t("team")} />}
          >
            <ul className="space-y-1.5">
              <li className="sticker-flat flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5">
                <span className="display min-w-0 flex-1 text-[14px] font-bold break-words">
                  {project.owner_name ?? "—"}
                </span>
                <Chip color="var(--k-decision)">{t("teamOwner")}</Chip>
                {owner && <Chip>{t("teamYou")}</Chip>}
              </li>

              {members.map((member) => (
                <li
                  key={member.id}
                  className="sticker-flat flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="display block text-[14px] font-bold break-words">
                      {member.name}
                    </span>
                    {/* The owner sees addresses because the owner invited
                        them. Between collaborators a name and a handle answer
                        "who am I working with"; an inbox is not that. */}
                    <span className="mono block text-[11.5px] break-all text-faint">
                      {owner ? member.email : `@${member.username}`}
                    </span>
                  </span>
                  {member.user_id === user.id && <Chip>{t("teamYou")}</Chip>}
                  {owner && (
                    <form action={removeProjectMemberAction}>
                      <input type="hidden" name="membership_id" value={member.id} />
                      <SubmitButton
                        className="link-more row-action text-meta"
                        pendingLabel={t("working")}
                      >
                        {t("removeCollaborator")}
                        <span className="sr-only"> — {member.name}</span>
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}

              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="sticker-flat flex flex-wrap items-center gap-x-2 gap-y-1 p-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="mono block text-[12.5px] break-all">
                      {invitation.email}
                    </span>
                    <span className="block text-[11.5px] text-faint">
                      {t("teamPending")}
                    </span>
                  </span>
                  <form action={revokeProjectInviteAction}>
                    <input type="hidden" name="invitation_id" value={invitation.id} />
                    <SubmitButton
                      className="link-more row-action text-meta"
                      pendingLabel={t("working")}
                    >
                      {t("revoke")}
                      <span className="sr-only"> — {invitation.email}</span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>

            {owner && (
              <details className="mt-3 border-t border-dashed border-rule pt-3">
                <summary className="link-more">{t("invitePeople")}</summary>
                <form action={inviteProjectAction} className="mt-3 space-y-2">
                  <input type="hidden" name="project_id" value={project.id} />
                  <Field label={t("inviteEmail")}>
                    <input name="email" type="email" autoComplete="email" required />
                  </Field>
                  <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                    {t("inviteSend")}
                  </SubmitButton>
                </form>
              </details>
            )}

            {members.length === 0 && invitations.length === 0 && owner && (
              <p className="mt-3 text-[13px] text-muted">{t("teamAlone")}</p>
            )}
          </Panel>

          <Panel
            delay={140}
            className={"border-none shadow-none dropshadow-none"}
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
                        className="link-more row-action text-meta"
                        pendingLabel={t("working")}
                      >
                        {t("delete")}
                        <span className="sr-only"> — {c.title}</span>
                      </SubmitButton>
                    </form>
                  </div>
                  {/* Clamped: these are paragraphs, and the rail is a summary.
                      The full text is one click away on hover/expand. */}
                  <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-muted">
                    {c.body}
                  </p>
                </div>
              ))}
              <details>
                <summary className="link-more">{t("add")}</summary>
                <form action={addContextAction} className="mt-3 space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <Field label={t("projectContext")}>
                    <Picker
                      name="kind"
                      value={CONTEXT_KINDS[0]}
                      options={kindOptions(t)}
                      label={t("projectContext")}
                    />
                  </Field>
                  <Field label={t("title")}>
                    <input name="title" required />
                  </Field>
                  <Field label={t("noteBodyPh")}>
                    <textarea name="body" required />
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
    </div>
  );
}
