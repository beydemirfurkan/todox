import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Fragment } from "react";

import { CONTEXT_KINDS } from "@/lib/constants";
import { ago, type T } from "@/lib/i18n";
import { firstLine } from "@/lib/util/headline";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { requireUser } from "@/lib/session";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as membershipsRepo from "@/lib/repositories/project-memberships";
import * as observationsRepo from "@/lib/repositories/observations";
import * as tasksRepo from "@/lib/repositories/tasks";
import type { Task } from "@/lib/types";
import { staleRefs } from "@/lib/services/briefing";
import { repoLabel, repoLink } from "@/lib/util/paths";
import {
  addContextAction,
  createTaskAction,
  deleteContextAction,
  deleteProjectAction,
  inviteProjectAction,
  removeProjectMemberAction,
  revokeProjectInviteAction,
  updateProjectAction,
} from "../../actions";
import { authMessages } from "../../auth-messages";
import { kindOptions, priorityOptions } from "../../kinds";
import { AuthForm } from "../../features/auth-form";
import { SharePanel } from "../../features/share-panel";
import { Picker } from "../../features/picker";
import { SubmitButton } from "../../features/submit";
import { PanelLink } from "../../features/panel-link";
import { ProjectSettingsDrawer } from "../../features/project-settings-drawer";
import {
  Blob,
  Chip,
  Composer,
  Empty,
  ExpandableText,
  Field,
  Group,
  NoteGroups,
  StatusDot,
} from "../../components";
import { privatePageMetadata } from "../../metadata-shared";
import { boardHref, newest, panelView, quietDays, selectTaskId, type PanelView } from "./board";
import { Board, type BoardCard, type BoardColumn } from "./board-columns";
import { groupTasks, isClosed } from "./task-list";
import { TaskPanel } from "./task-panel";

export const dynamic = "force-dynamic";

/**
 * Grouping, ordering and the ceilings live in `./task-list`, where they can be
 * asserted without standing a page up. What is left here is markup.
 */

/**
 * `generateMetadata` and the render both need the account and the project, and
 * the page is force-dynamic, so `cache` is what keeps that one lookup each
 * rather than two.
 */
const currentUser = cache(requireUser);

/**
 * Stale-file lines printed in the banner.
 *
 * There was no ceiling, and a project with hundreds of moved files rendered one
 * `<li>` for each inside what was then a live region. The count in the heading
 * stays the true one; the point of the banner is that something has drifted, and
 * which files is a question the tasks themselves answer.
 */
const STALE_SHOWN = 8;

/**
 * Observations shown to a person.
 *
 * Fewer than the briefing gives an agent, and for a different reason than the
 * ceiling there. An agent reads these to work out what it is walking into; a
 * person looking at their own project mostly wants to know that something
 * happened and roughly when, and the rest is in git.
 */
const OBSERVATIONS_SHOWN = 5;
const projectBySlug = cache((userId: number, slug: string) => projects.bySlug(userId, slug));

/**
 * The tab, and only the tab: this page is noindex like every signed-in one.
 * Without it a row of open projects all read the landing page's tagline and
 * none could be told from another.
 */
export async function generateMetadata({
  params,
}: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { t } = await getT();
  const user = await currentUser();
  const project = await projectBySlug(user.id, slug);
  return privatePageMetadata(
    project ? `${project.name} — ${t("siteName")}` : t("siteName"),
  );
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const asked = await searchParams;
  const user = await currentUser();
  const { t } = await getT();
  const project = await projectBySlug(user.id, slug);
  if (!project) notFound();

  const owner = project.access_role === "owner";
  const [all, projectContext, members, invitations] = await Promise.all([
    tasksRepo.listByProject(project.id, "all"),
    contexts.listByProject(user.id, project.id),
    // Everyone with access sees who else has it. This used to be owner-only,
    // which meant the person who had just been invited into a project could
    // not see that anybody else was in it -- including, from their side, that
    // the collaboration existed at all.
    membershipsRepo.listByProject(project.id),
    // Pending invitations stay with the owner: an address that has not
    // accepted yet is not the team's business.
    owner ? invitationsRepo.listByProject(project.id) : Promise.resolve([]),
  ]);

  const open = all.filter((x) => !isClosed(x.status));

  // Both depend on the list above, so they wait for it -- but they wait
  // together. `staleRefs` used to fetch the project's open tasks for itself,
  // which queried the same table this render had already read in full.
  const [counts, stale, observed, handoffs, sameName] = await Promise.all([
    // Counted in the database. This used to load every entry of every task to
    // render three badges a row.
    entriesRepo.countsByTasks(all.map((x) => x.id)),
    staleRefs(open),
    // Fewer than the briefing carries. An agent reads these to work out what it
    // is walking into; a person reading their own project mostly wants to know
    // that something happened and roughly when.
    observationsRepo.pageByProject(project.id, OBSERVATIONS_SHOWN),
    // The one question a person opens a project to ask. The briefing has
    // carried `last_handoff` per task since it was written, so the agent has
    // always been told; the human got a summary and a list of titles. One per
    // open task now, because every card on the board prints its own.
    entriesRepo.latestHandoffByTasks(open.map((x) => x.id)),
    // A namesake in this account. `merge_projects` has existed since the
    // cross-machine identity work and nothing has ever pointed at a duplicate
    // that already exists -- the agent surface says it once, at registration.
    // The person who can actually decide whether two rows are one repository
    // was never told at all.
    projects.listByName(user.id, project.name),
  ]);
  // Owned only, for the reason the briefing's twin of this carries: merging
  // asserts ownership on both sides, so offering it for a project shared with
  // this account is advice that cannot be taken.
  // `owner` is computed above and is the same question. Without it a member
  // viewing a shared project got a "merge them" sticker pointing at their own
  // unrelated repo, and the merge asserts ownership on both sides.
  const twins = owner
    ? sameName.filter((p) => p.id !== project.id && p.user_id === user.id)
    : [];

  const groups = groupTasks(all);

  const lastHandoff = newest(handoffs.values());
  const lastHandoffTask = lastHandoff && all.find((x) => x.id === lastHandoff.task_id);

  // What the panel shows comes from the address; see `./board`. With nothing
  // asked for it opens on where the project left off, then on the first task
  // in flight, then the head of the queue.
  const view = panelView(asked.view);
  const selectedId = selectTaskId(asked.task, new Set(all.map((x) => x.id)), [
    lastHandoff?.task_id,
    groups.inFlight[0]?.id,
    groups.queued.shown[0]?.id,
    groups.closed.shown[0]?.id,
  ]);
  const selected = all.find((x) => x.id === selectedId);

  const today = new Date();
  const toCard = (task: Task): BoardCard => {
    const handoff = handoffs.get(task.id);
    return {
      task,
      counts: counts.get(task.id),
      handoffHead: handoff ? firstLine(handoff.body) : null,
      quietDays: quietDays(task, today),
    };
  };
  const columns: BoardColumn[] = [
    {
      status: "todo",
      title: t("queued"),
      cards: groups.queued.shown.map(toCard),
      omitted: groups.queued.omitted,
      total: groups.queued.total,
      emptyText: t("queuedEmpty"),
      // On the queue, not on the column in flight: a new task is queued, and
      // it should appear in the column whose "+" made it.
      action: (
        <Composer id="new-task" label={t("newTask")} action={createTaskAction}>
          <input type="hidden" name="slug" value={slug} />
          <Field label={t("taskTitlePh")}>
            <input name="title" autoFocus required />
          </Field>
          <Field label={t("taskBodyPh")}>
            <textarea name="body" />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("priorityLabel")} className="w-full min-w-0 sm:w-40">
              <Picker
                name="priority"
                value="2"
                options={priorityOptions(t)}
                label={t("priorityLabel")}
              />
            </Field>
            <SubmitButton pendingLabel={t("working")}>{t("add")}</SubmitButton>
          </div>
        </Composer>
      ),
    },
    {
      status: "doing",
      title: t("colDoing"),
      cards: groups.inFlight.filter((x) => x.status === "doing").map(toCard),
      omitted: 0,
      total: groups.counts.doing,
      emptyText: t("columnEmpty"),
    },
    {
      status: "blocked",
      title: t("colBlocked"),
      cards: groups.inFlight.filter((x) => x.status === "blocked").map(toCard),
      omitted: 0,
      total: groups.counts.blocked,
      emptyText: t("columnEmpty"),
    },
  ];
  const panelTabs: { view: PanelView; label: string; count?: number }[] = [
    { view: "task", label: t("tabTask") },
    { view: "notes", label: t("tabNotes"), count: projectContext.length },
    { view: "closed", label: t("doneDropped"), count: groups.closed.total },
  ];

  const origin = publicUrl();
  const repo = repoLink(project.repo_url);

  return (
    <div className="space-y-5" data-wide-page>
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
                <h3 className="display mb-2 text-[15px] font-bold">{t("projectDetails")}</h3>
                {/* `updateProjectAction` was written, tested and wired to
                    nothing, so there was no way to rename a project or fix its
                    summary from here at all. `repo_url` is the worse half: it
                    is the only identifier that means the same thing on another
                    machine, it is shown at the top of this page, and only an
                    agent could set it. */}
                <form action={updateProjectAction} className="space-y-2">
                  <input type="hidden" name="id" value={project.id} />
                  <Field label={t("projectNameLabel")}>
                    <input name="name" defaultValue={project.name} required />
                  </Field>
                  <Field label={t("projectPathLabel")}>
                    <input
                      name="root_path"
                      defaultValue={project.root_path ?? ""}
                      placeholder={t("projectPathPh")}
                      className="mono text-small"
                    />
                  </Field>
                  <Field label={t("projectRepoLabel")}>
                    <input
                      name="repo_url"
                      defaultValue={project.repo_url ?? ""}
                      placeholder={t("projectRepoPh")}
                      className="mono text-small"
                    />
                  </Field>
                  <p className="text-[13px] text-muted">{t("projectRepoNote")}</p>
                  <Field label={t("projectSummaryLabel")}>
                    <textarea name="summary" defaultValue={project.summary ?? ""} />
                  </Field>
                  <SubmitButton pendingLabel={t("working")}>{t("apply")}</SubmitButton>
                </form>
              </section>

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
        </div>

        {/* `.prose` is the measure on the paragraph below. It used to carry
            `min-w-3xl` beside it, which is a 768px *minimum* — wider than the
            max-width `.prose` sets, and wider than a phone. */}
        {/* Clamped, like every other long thing on this page.
            `ExpandableText` has clamped the context rails for a while and the
            summary -- the single longest string here, and the first one read --
            was the one that was not. Measured on production: a median summary
            is 198 characters and the two longest are over 1,100, so this is
            the difference between a description and a wall. */}
        {project.summary ? (
          <ExpandableText
            text={project.summary}
            more={t("showMore")}
            less={t("showLess")}
            className="prose text-[14.5px] leading-relaxed text-muted"
          />
        ) : (
          owner && (
            // Said, rather than left blank. Forty-three of sixty-four projects
            // in production have no summary, so for two thirds of pages the
            // line that answers "what is this" is simply absent -- and nothing
            // anywhere invites one.
            <p className="prose text-small leading-relaxed text-muted">
              {t("noSummary")}
            </p>
          )
        )}

        {/* Where the project lives, in one line: the name it has everywhere,
            and the path it has here.

            These were split — the remote sat beside the h1 and the path sat
            two lines below — which put a sentence about identity in the row
            that names the project, competing with it. They answer the same
            question and now sit together, quietly, under the summary.

            The absent case still says so out loud, because it is invisible
            until the day the same repo is opened on a second computer and
            registers again. It says it in half the words: the consequence
            fits here, and the reasoning is a drawer away under
            `projectRepoNote`, where the field that fixes it is. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta">
          {repo ? (
            <a
              href={repo}
              target="_blank"
              rel="noreferrer"
              className="mono link-more"
            >
              {repoLabel(repo)} ↗
            </a>
          ) : (
            <span className="text-faint">{t("noRemote")}</span>
          )}
          {project.root_path && (
            <span
              className="mono min-w-0 truncate text-faint"
              title={project.root_path}
            >
              {t("localPathLabel")}: {project.root_path}
            </span>
          )}
        </div>
      </header>

      {twins.length > 0 && (
        // Not an error, and not something to fix automatically: two projects
        // with one folder name really can be two repositories, which is the
        // case decision #28 refuses to fuse. So it names them and leaves the
        // judgement with the person who knows.
        <section
          aria-labelledby="twin-heading"
          className="on-fill sticker pop flex items-start gap-3.5 p-4"
          style={{ background: "var(--k-question)", animationDelay: "30ms" }}
        >
          <Blob
            mood="worried"
            size={46}
            fill="var(--paper)"
            stroke="var(--ink)"
            className="shrink-0"
          />
          <div className="min-w-0">
            <h2 id="twin-heading" className="display text-[17px] font-bold">
              {t("twinTitle", { name: project.name })}
            </h2>
            <p className="mt-0.5 text-[14px]">{t("twinBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-[12px]">
              {twins.map((p) => (
                <li key={p.id} className="break-all">
                  ·{" "}
                  <Link href={`/p/${p.slug}`} className="link-more">
                    {p.slug}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {stale.length > 0 && (
        // A labelled region, not `role="status"`. This is server-rendered and
        // present on load, and `role="status"` carries an implicit polite live
        // region -- so a screen reader queued the whole banner, including one
        // line per stale file with no ceiling on them. `aria-live` is for
        // something that changes without a navigation; this changes with one.
        <section
          aria-labelledby="stale-heading"
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
            {/* A real heading, so the banner is something you can navigate to
                rather than a bold paragraph that only looks like a title. The
                count is the true one, whatever the list below shows. */}
            <h2 id="stale-heading" className="display text-[17px] font-bold">
              {stale.length === 1
                ? t("staleTitleOne")
                : t("staleTitleMany", { n: stale.length })}
            </h2>
            <p className="mt-0.5 text-[14px]">{t("staleBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-[12px]">
              {stale.slice(0, STALE_SHOWN).map((s) => (
                <li key={s} className="break-all">
                  · {s}
                </li>
              ))}
            </ul>
            {stale.length > STALE_SHOWN && (
              <p className="mt-1.5 text-[13px]">
                {t("staleAndMore", { n: stale.length - STALE_SHOWN })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Where it left off, which is what somebody came here to find out --
          and now a way in: the title opens that task in the panel. Absent
          rather than empty when there is no handoff: a line saying "nobody
          has left one" on every project that has never had one is the
          always-true sentence this codebase keeps having to remove. */}
      {lastHandoff && lastHandoffTask && (
        <p className="sticker-flat flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-small">
          <Chip color="var(--k-handoff)">{t("lastLeftOff")}</Chip>
          <PanelLink
            href={`/p/${slug}/t/${lastHandoffTask.id}`}
            panelHref={boardHref(slug, { task: lastHandoffTask.id, view: "task" })}
            className="link-more"
          >
            #{lastHandoffTask.id} {lastHandoffTask.title}
          </PanelLink>
          <span className="min-w-[12rem] flex-1 break-words text-muted">
            {firstLine(lastHandoff.body)}
          </span>
          <span className="mono text-meta text-faint">{ago(lastHandoff.created_at, t)}</span>
        </p>
      )}

      {/* The work, on one screen: the open tasks as a board, and beside it a
          panel that shows one of three things -- the task that is selected,
          the standing notes, the closed work. This was five folded groups
          read top to bottom, and reading any task meant leaving the page.

          The page asks for the wide column (`data-wide-page` on its root),
          because three columns and a panel do not fit in the reading one. The
          panel is pinned beside the board and scrolls on its own, so a card
          far down a long queue still changes something that is on screen;
          below `lg` it stacks under the board, and there a card opens the
          task's own page instead (`PanelLink`). */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Board
          columns={columns}
          slug={slug}
          selectedId={view === "task" ? selectedId : null}
          t={t}
        />

        {/* `id` because the dashboard links to a task as `…?task=7#panel`:
            on a phone the panel is under the board, and the fragment is what
            lands the reader on the thing they asked for. */}
        <aside
          id="panel"
          aria-label={t("panelLabel")}
          className="sticker min-w-0 scroll-mt-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-[22rem] lg:shrink-0 lg:overflow-y-auto xl:w-[26rem]"
        >
          {/* Links, like `Tabs`, and for its reasons. Not `Tabs` itself: these
              must not scroll the page back to the top, and they sit inside the
              panel rather than above a page. */}
          <nav
            aria-label={t("panelSections")}
            className="flex flex-wrap gap-1.5 border-b border-dashed border-rule p-3"
          >
            {panelTabs.map((tab) => (
              <Link
                key={tab.view}
                href={boardHref(slug, { task: selectedId, view: tab.view })}
                scroll={false}
                aria-current={tab.view === view ? "page" : undefined}
                className="pill seg"
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="mono ml-1.5 opacity-70">{tab.count}</span>
                )}
              </Link>
            ))}
          </nav>

          <div className="p-4">
            {view === "task" &&
              (selected ? (
                <TaskPanel task={selected} slug={slug} t={t} />
              ) : (
                <Empty>{t("noTaskSelected")}</Empty>
              ))}

            {view === "notes" && (
              <div className="relative">
                <h2 className="display min-h-[40px] pr-11 text-[16px] leading-[40px] font-bold">
                  {t("projectContext")}
                </h2>
                <Composer id="new-note" label={t("newNote")} action={addContextAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <Field label={t("title")}>
                    <input name="title" autoFocus required />
                  </Field>
                  <Field label={t("noteBodyPh")}>
                    <textarea name="body" required />
                  </Field>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label={t("projectContext")} className="w-full min-w-0 sm:w-40">
                      <Picker
                        name="kind"
                        value={CONTEXT_KINDS[0]}
                        options={kindOptions(t)}
                        label={t("projectContext")}
                      />
                    </Field>
                    <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
                  </div>
                </Composer>
                <div className="mt-2">
                  {projectContext.length === 0 ? (
                    <Empty>{t("projectContextEmpty")}</Empty>
                  ) : (
                    <NoteGroups notes={projectContext} t={t} deleteAction={deleteContextAction} />
                  )}
                </div>
              </div>
            )}

            {view === "closed" && (
              <>
                {groups.closed.shown.length === 0 ? (
                  <Empty>{t("closedEmpty")}</Empty>
                ) : (
                  <ul className="space-y-2">
                    {groups.closed.shown.map((task) => (
                      <ClosedRow key={task.id} task={task} slug={slug} t={t} />
                    ))}
                  </ul>
                )}
                {groups.closed.omitted > 0 && (
                  <p className="mt-3 border-t border-dashed border-rule pt-3 text-[13px] text-muted">
                    {t("andMore", { n: groups.closed.omitted })}
                  </p>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {observed.rows.length > 0 && (
        // Absent rather than empty, like every always-true line this page has
        // shed. Nobody wrote any of this: it is what a process saw in git while
        // an earlier session ran, so it sits below everything somebody chose
        // to record, and the body says so in words.
        <Group
          id="observations"
          title={t("observationsTitle")}
          count={observed.rows.length + observed.omitted}
          countLabel={t("observationsLabel")}
          delay={220}
        >
          <p className="prose text-[14px] text-muted">{t("observationsBody")}</p>

          <ul className="mt-3 space-y-2.5">
            {observed.rows.map((o) => {
              const subjects = (o.commit_subjects ?? "").split("\n").filter(Boolean);
              // Only tasks this page already lists: an id the carrier sent
              // for a task since deleted is nothing to link to.
              const started = o.task_ids.filter((id) => all.some((x) => x.id === id));
              return (
                <li key={o.id} className="border-l-2 border-line pl-3">
                  {/* Four items, so it wraps: on a phone this row is wider than
                      the viewport without it. */}
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-[13px]">
                    <span className="mono break-all">
                      {o.branch
                        ? t("observationsBranch", { branch: o.branch })
                        : t("observationsNoBranch")}
                    </span>
                    <span>
                      {o.commits === 1
                        ? t("observationsCommitOne")
                        : t("observationsCommitMany", { n: o.commits })}
                    </span>
                    <span>
                      {o.files_changed === 1
                        ? t("observationsFileOne")
                        : t("observationsFileMany", { n: o.files_changed })}
                    </span>
                    {started.length > 0 && (
                      <span>
                        {t("observationsStarted")}{" "}
                        {started.map((id, i) => (
                          <Fragment key={id}>
                            {i > 0 && ", "}
                            <Link href={`/p/${slug}/t/${id}`} className="link-more">
                              #{id}
                            </Link>
                          </Fragment>
                        ))}
                      </span>
                    )}
                    <span className="text-[12px] text-faint">{ago(o.observed_at, t)}</span>
                  </div>
                  {subjects.length > 0 && (
                    <ul className="mono mt-1 space-y-0.5 text-[12px] text-faint">
                      {subjects.map((s, i) => (
                        <li key={i} className="break-words">
                          · {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {observed.omitted > 0 && (
            <p className="mt-2.5 text-small text-muted">
              {t("observationsAndMore", { n: observed.omitted })}
            </p>
          )}
        </Group>
      )}

      {/* Who is in this. Last, because it is the fact that changes least;
          the owner keeps the controls, everybody else gets the roster, which
          is the part that answers "am I working with somebody here". */}
      <Group
        id="team"
        title={t("team")}
        count={members.length + 1}
        countLabel={t("team")}
        delay={260}
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
                <span className="mono block text-meta break-all text-faint">
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
                <span className="block text-meta text-faint">
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
      </Group>
    </div>
  );
}

/**
 * One closed task, one line: what it was, how it ended, when.
 *
 * The status is the dot and its hidden label -- done and dropped share this
 * list, and a struck-through title alone would not say which. The line is a
 * link to the panel like a card is, so closed work can be read, and reopened
 * from the status buttons there, without leaving the board.
 */
function ClosedRow({ task, slug, t }: { task: Task; slug: string; t: T }) {
  return (
    <li className="sticker-flat">
      <PanelLink
        href={`/p/${slug}/t/${task.id}`}
        panelHref={boardHref(slug, { task: task.id, view: "task" })}
        className="flex flex-wrap items-start gap-x-2.5 gap-y-1 p-3 hover:text-ink"
      >
        <span className="pt-1">
          <StatusDot status={task.status} t={t} />
        </span>
        <span className="mono pt-0.5 text-meta text-faint">#{task.id}</span>
        <span className="line-clamp-2 min-w-[10rem] flex-1 text-small font-medium break-words text-muted line-through decoration-1">
          {task.title}
        </span>
        <span className="mono ml-auto shrink-0 pt-0.5 text-meta text-faint">
          {ago(task.closed_at ?? task.updated_at, t)}
        </span>
      </PanelLink>
    </li>
  );
}
