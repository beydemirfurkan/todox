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
import { groupTasks, isClosed } from "./task-list";

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

export default async function ProjectPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
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
  const [counts, stale, observed, lastHandoff, sameName] = await Promise.all([
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
    // always been told; the human got a summary and a list of titles.
    entriesRepo.latestHandoff(open.map((x) => x.id)),
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
            <p className="prose text-[13.5px] leading-relaxed text-faint">
              {t("noSummary")}
            </p>
          )
        )}

        {/* Where it left off, which is what somebody came here to find out.
            Absent rather than empty when there is no handoff: a line saying
            "nobody has left one" on every project that has never had one is
            the always-true sentence this codebase keeps having to remove. */}
        {lastHandoff && (
          <p className="prose text-[13.5px] leading-relaxed text-muted">
            <span className="text-faint">{t("lastLeftOff")} </span>
            <Link href={`/p/${slug}/t/${lastHandoff.task_id}`} className="link-more">
              #{lastHandoff.task_id} {lastHandoff.task_title}
            </Link>{" "}
            <span className="text-faint">· {ago(lastHandoff.created_at, t)}</span>
            <br />
            <span className="break-words">{firstLine(lastHandoff.body)}</span>
          </p>
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
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px]">
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

      {/* From here down the page reads in the order the agent's briefing
          does: what is in flight, what constrains it, what is queued, what is
          finished, what a process saw, who is here. Each part is a Group --
          a native details -- so the page is as long as what is open, and a
          project with sixty tasks and forty notes still fits on a screen when
          only the work in flight is unfolded. The two-column grid this
          replaces put the notes in a 19rem rail where every one of them was
          a paragraph: 1,855px of rail beside 661px of work, measured. */}
      <Group
        id="in-flight"
        title={t("inFlight")}
        count={groups.counts.doing}
        countLabel={t("tasks")}
        right={
          // Said in words on the header, so a closed group still says it.
          groups.counts.blocked > 0 ? (
            <Chip color="var(--k-dead_end)">
              {groups.counts.blocked} {t("countStuck")}
            </Chip>
          ) : undefined
        }
        open
        delay={60}
      >
        {groups.inFlight.length === 0 ? (
          <Empty mood="happy">{t("allClear")}</Empty>
        ) : (
          <ul className="space-y-2">
            {groups.inFlight.map((task) => (
              <TaskRow key={task.id} task={task} count={counts.get(task.id)} slug={slug} t={t} />
            ))}
          </ul>
        )}
      </Group>

      {/* The standing notes, above the queue: they are what the work in
          flight is being done under, and a person who opens this page to
          orient reads them before the backlog. */}
      <Group
        id="context"
        title={t("projectContext")}
        count={projectContext.length}
        countLabel={t("notes")}
        action={
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
        }
        open
        delay={100}
      >
        {projectContext.length === 0 ? (
          <Empty>{t("projectContextEmpty")}</Empty>
        ) : (
          <NoteGroups notes={projectContext} t={t} deleteAction={deleteContextAction} />
        )}
      </Group>

      {/* Open when nothing is in flight, because then the queue is the work
          and a page that opens with two folded groups says nothing. */}
      {/* The composer is on this group, not the in-flight one: a new task is
          queued, and from the in-flight group it vanished into a fold the
          moment it was saved. */}
      <Group
        id="queued"
        title={t("queued")}
        count={groups.queued.total}
        countLabel={t("tasks")}
        action={
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
        }
        open={groups.inFlight.length === 0}
        delay={140}
      >
        {groups.queued.shown.length === 0 ? (
          <Empty>{t("queuedEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {groups.queued.shown.map((task) => (
              <TaskRow key={task.id} task={task} count={counts.get(task.id)} slug={slug} t={t} />
            ))}
          </ul>
        )}
        {groups.queued.omitted > 0 && (
          <p className="mt-3 border-t border-dashed border-rule pt-3 text-[13px] text-muted">
            {t("andMore", { n: groups.queued.omitted })}
          </p>
        )}
      </Group>

      <Group
        id="closed"
        title={t("doneDropped")}
        count={groups.closed.total}
        countLabel={t("tasks")}
        delay={180}
      >
        {groups.closed.shown.length === 0 ? (
          <Empty>{t("closedEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {groups.closed.shown.map((task) => (
              <TaskRow key={task.id} task={task} count={counts.get(task.id)} slug={slug} t={t} />
            ))}
          </ul>
        )}
        {groups.closed.omitted > 0 && (
          <p className="mt-3 border-t border-dashed border-rule pt-3 text-[13px] text-muted">
            {t("andMore", { n: groups.closed.omitted })}
          </p>
        )}
      </Group>

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
          <p className="prose text-[14px] text-faint">{t("observationsBody")}</p>

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
            <p className="mt-2.5 text-[13px] text-faint">
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
      </Group>
    </div>
  );
}

/**
 * One task, one row. The card it replaces stacked the title over a row of
 * chips and put a 44px status picker beside them, so sixty of them ran to
 * six thousand pixels. The row is the link; the status is the dot and the
 * group the row sits in; changing it is what the task page is for.
 */
function TaskRow({
  task,
  count,
  slug,
  t,
}: {
  task: Task;
  count: entriesRepo.EntryCounts | undefined;
  slug: string;
  t: T;
}) {
  const closed = isClosed(task.status);
  return (
    <li className="sticker-flat">
      <Link
        href={`/p/${slug}/t/${task.id}`}
        className="flex flex-wrap items-start gap-x-2.5 gap-y-1 p-3 hover:text-ink"
      >
        <span className="pt-1">
          <StatusDot status={task.status} t={t} />
        </span>
        <span className="mono pt-0.5 text-[12px] text-faint">#{task.id}</span>
        <span
          className={`line-clamp-2 min-w-0 flex-1 basis-56 text-[15px] font-medium break-words ${closed ? "text-muted line-through decoration-1" : ""}`}
        >
          {task.title}
        </span>
        {/* What is worth a glance and nothing else: urgency, the dead ends
            the next session must not repeat, the decisions behind the work.
            The log total and the question count said nothing a reader acts
            on from a list. */}
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          {task.priority === 1 && !closed && (
            <Chip color="var(--accent)" tilt={-3}>
              p1
            </Chip>
          )}
          {count && count.dead_ends > 0 && (
            <Chip color="var(--k-dead_end)">
              {count.dead_ends}{" "}
              {count.dead_ends > 1 ? t("deadEndCountPlural") : t("deadEndCount")}
            </Chip>
          )}
          {count && count.decisions > 0 && (
            <Chip color="var(--k-decision)">
              {count.decisions}{" "}
              {count.decisions > 1 ? t("decisionCountPlural") : t("decisionCount")}
            </Chip>
          )}
          <span className="mono text-[11px] text-faint">{ago(task.updated_at, t)}</span>
        </span>
      </Link>
    </li>
  );
}
