import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Fragment } from "react";

import { CONTEXT_KINDS } from "@/lib/constants";
import { ago, type T } from "@/lib/i18n";
import { firstLine } from "@/lib/util/headline";
import { getT } from "@/lib/lang";
import { requireUser } from "@/lib/session";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as projects from "@/lib/repositories/projects";
import * as membershipsRepo from "@/lib/repositories/project-memberships";
import * as observationsRepo from "@/lib/repositories/observations";
import * as tasksRepo from "@/lib/repositories/tasks";
import type { Task } from "@/lib/types";
import { staleRefs } from "@/lib/services/briefing";
import { repoLabel, repoLink } from "@/lib/util/paths";
import {
  addContextAction,
  deleteContextAction,
  updateContextAction,
} from "../../actions";
import { kindOptions } from "../../kinds";
import { Picker } from "../../features/picker";
import { SubmitButton } from "../../features/submit";
import {
  Chip,
  Composer,
  Empty,
  ExpandableText,
  Field,
  Group,
  IconTile,
  NoteGroups,
} from "../../components";
import { accountProjects } from "../../account-projects";
import { QuickAdd } from "../../components/quick-add";
import { TaskRow, TaskSection } from "../../components/task-row";
import { ProjectMenu } from "../../features/project-menu";
import { privatePageMetadata } from "../../metadata-shared";
import {
  projectHref,
  projectTab,
  quietDays,
  taskView,
  type ProjectTab,
  type TaskView,
} from "./board";
import { Board, type BoardCard, type BoardColumn } from "./board-columns";
import { groupTasks, isClosed } from "./task-list";

export const dynamic = "force-dynamic";

/**
 * `generateMetadata` and the render both need the account and the project, and
 * the page is force-dynamic, so `cache` is what keeps that one lookup each
 * rather than two.
 */
const currentUser = cache(requireUser);

/**
 * Stale-file lines printed in the banner. The count in its heading stays the
 * true one; the point of the banner is that something has drifted, and which
 * files is a question the tasks themselves answer.
 */
const STALE_SHOWN = 8;

/**
 * Observations shown to a person: fewer than the briefing gives an agent. A
 * person looking at their own project mostly wants to know that something
 * happened and roughly when, and the rest is in git.
 */
const OBSERVATIONS_SHOWN = 5;
const projectBySlug = cache((userId: number, slug: string) => projects.bySlug(userId, slug));

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

/**
 * A project: its name and what it is, then either its tasks -- as a calm
 * list grouped by where they stand, or as the board -- or its standing notes.
 * Settings and the team's controls live on their own page; this one is for
 * the work.
 */
export default async function ProjectPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const asked = await searchParams;
  const user = await currentUser();
  const { t } = await getT();
  const project = await projectBySlug(user.id, slug);
  if (!project) notFound();

  const isOwner = project.access_role === "owner";
  const tab = projectTab(asked.tab);
  const view = taskView(asked.view);
  const [all, projectContext, members, arrangement] = await Promise.all([
    tasksRepo.listForBoard(project.id),
    contexts.listByProject(user.id, project.id),
    // Everyone with access sees who else has it: from a member's side, this
    // is the only place that says the collaboration exists at all.
    membershipsRepo.listByProject(project.id),
    // Already read for the sidebar in this request: `cache` makes it free.
    accountProjects(user.id),
  ]);
  const placement = arrangement.placements.find((row) => row.project_id === project.id);
  const open = all.filter((task) => !isClosed(task.status));

  // All of these need the task list, so they wait for it -- together.
  const [counts, stale, observed, handoffs, sameName] = await Promise.all([
    entriesRepo.countsByTasks(all.map((task) => task.id)),
    staleRefs(open),
    observationsRepo.pageByProject(project.id, OBSERVATIONS_SHOWN),
    entriesRepo.latestHandoffByTasks(open.map((task) => task.id)),
    // A namesake in this account. Merging asserts ownership on both sides, so
    // only an owner is told: for anybody else it is advice that cannot be taken.
    isOwner ? projects.listByName(user.id, project.name) : Promise.resolve([]),
  ]);
  const twins = sameName.filter((p) => p.id !== project.id && p.user_id === user.id);
  const groups = groupTasks(all);
  const handoffLine = (task: Task) => {
    const handoff = handoffs.get(task.id);
    return handoff ? firstLine(handoff.body) : null;
  };
  const repo = repoLink(project.repo_url);
  const people = [project.owner_name, ...members.map((member) => member.name)].filter(
    (name): name is string => Boolean(name),
  );

  return (
    <div className="flex flex-col gap-8" data-wide-page={view === "board" ? true : undefined}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="display min-w-0 flex-1 text-[34px] leading-tight break-words">
            {project.name}
          </h1>
          {!isOwner && project.owner_name && (
            <Chip color="var(--k-handoff)">{t("sharedBy", { name: project.owner_name })}</Chip>
          )}
          <ProjectMenu
            project={{ id: project.id, slug: project.slug, name: project.name }}
            details={
              isOwner
                ? { summary: project.summary, repoUrl: project.repo_url, rootPath: project.root_path }
                : null
            }
            placement={{
              folderId: placement?.folder_id ?? null,
              pinnedAt: placement?.pinned_at ?? null,
              archivedAt: placement?.archived_at ?? null,
              folders: arrangement.folders.map((folder) => ({ id: folder.id, name: folder.name })),
            }}
            labels={{
              open: t("projectSettings"),
              details: t("settingsGeneral"),
              name: t("projectNameLabel"),
              summary: t("projectSummaryLabel"),
              repo: t("projectRepoLabel"),
              repoPlaceholder: t("projectRepoPh"),
              save: t("apply"),
              saving: t("saving"),
              team: t("settingsTeam"),
              sharing: t("sharing"),
              allSettings: t("projectAllSettings"),
              delete: t("deleteProject"),
              arrange: t("projectArrangeTitle"),
              folder: t("moveToFolder"),
              noFolder: t("noFolder"),
              newFolderPlaceholder: t("newFolderPlaceholder"),
              newFolderAria: t("newFolderAria"),
              move: t("moveSubmit"),
              pin: t("pinProject"),
              unpin: t("unpinProject"),
              archive: t("archiveProject"),
              unarchive: t("unarchiveProject"),
              archiveHint: t("archiveHint"),
            }}
          />
        </div>

        {project.summary ? (
          <ExpandableText
            text={project.summary}
            more={t("showMore")}
            less={t("showLess")}
            className="prose text-body leading-relaxed text-muted"
          />
        ) : (
          isOwner && <p className="prose text-small text-muted">{t("noSummary")}</p>
        )}

        {/* Where it lives and who is in it, in one quiet line. The remote is
            the name the repository has everywhere; its absence is said out
            loud, because it only matters the day the repo is opened on a
            second computer. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-meta">
          {repo ? (
            <a href={repo} target="_blank" rel="noreferrer" className="mono link-more">
              {repoLabel(repo)} ↗
            </a>
          ) : (
            <span className="text-faint">{t("noRemote")}</span>
          )}
          {people.length > 1 && (
            <span className="text-muted">
              {t("team")}: {people.join(", ")}
            </span>
          )}
        </div>
      </header>

      {twins.length > 0 && (
        // Not something to fix automatically: two projects with one folder
        // name really can be two repositories (decision #28). It names them
        // and leaves the judgement with the person who knows.
        <section aria-labelledby="twin-heading" className="callout flex items-start gap-3.5 p-4">
          <IconTile name="alert" color="var(--k-question)" />
          <div className="min-w-0">
            <h2 id="twin-heading" className="text-[15px] font-semibold">
              {t("twinTitle", { name: project.name })}
            </h2>
            <p className="mt-0.5 text-[14px] text-muted">{t("twinBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-meta">
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
        // A labelled region, not `role="status"`: it is present on load, and a
        // live region queued the whole banner for a screen reader.
        <section aria-labelledby="stale-heading" className="callout flex items-start gap-3.5 p-4">
          <IconTile name="alert" color="var(--k-question)" />
          <div className="min-w-0">
            <h2 id="stale-heading" className="text-[15px] font-semibold">
              {stale.length === 1 ? t("staleTitleOne") : t("staleTitleMany", { n: stale.length })}
            </h2>
            <p className="mt-0.5 text-[14px] text-muted">{t("staleBody")}</p>
            <ul className="mono mt-2 space-y-0.5 text-meta">
              {stale.slice(0, STALE_SHOWN).map((path) => (
                <li key={path} className="break-all">
                  · {path}
                </li>
              ))}
            </ul>
            {stale.length > STALE_SHOWN && (
              <p className="mt-1.5 text-small">{t("staleAndMore", { n: stale.length - STALE_SHOWN })}</p>
            )}
          </div>
        </section>
      )}

      <ProjectControls
        slug={slug}
        tab={tab}
        view={view}
        openCount={open.length}
        noteCount={projectContext.length}
        t={t}
      />

      {tab === "tasks" && (
        <>
          <QuickAdd target={{ slug }} t={t} />
          {view === "list" ? (
            <TaskList groups={groups} project={project} handoffLine={handoffLine} t={t} />
          ) : (
            <Board
              columns={boardColumns(groups, counts, handoffLine, t)}
              slug={slug}
              closedCount={groups.closed.total}
              t={t}
            />
          )}
          {observed.rows.length > 0 && (
            <Observations observed={observed} taskIds={new Set(all.map((x) => x.id))} slug={slug} t={t} />
          )}
        </>
      )}

      {tab === "notes" && <ProjectNotes slug={slug} notes={projectContext} t={t} />}
    </div>
  );
}

/** The two choices this page offers: which section, and how to lay tasks out. */
function ProjectControls({
  slug,
  tab,
  view,
  openCount,
  noteCount,
  t,
}: {
  slug: string;
  tab: ProjectTab;
  view: TaskView;
  openCount: number;
  noteCount: number;
  t: T;
}) {
  const tabs: { id: ProjectTab; label: string; count: number }[] = [
    { id: "tasks", label: t("projectTabTasks"), count: openCount },
    { id: "notes", label: t("tabNotes"), count: noteCount },
  ];
  const views: { id: TaskView; label: string }[] = [
    { id: "list", label: t("viewList") },
    { id: "board", label: t("viewBoard") },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <nav aria-label={t("projectSections")} className="seg-group">
        {tabs.map((item) => (
          <Link
            key={item.id}
            href={projectHref(slug, { tab: item.id, view })}
            scroll={false}
            aria-current={item.id === tab ? "page" : undefined}
            className="pill seg"
          >
            {item.label}
            <span className="ml-1.5 opacity-70">{item.count}</span>
          </Link>
        ))}
      </nav>
      {tab === "tasks" && (
        <nav aria-label={t("projectLayout")} className="seg-group ml-auto">
          {views.map((item) => (
            <Link
              key={item.id}
              href={projectHref(slug, { tab, view: item.id })}
              scroll={false}
              aria-current={item.id === view ? "page" : undefined}
              className="pill seg"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

type Groups = ReturnType<typeof groupTasks<Task>>;

/** The list view: in progress, up next, stuck, and the closed work folded. */
function TaskList({
  groups,
  project,
  handoffLine,
  t,
}: {
  groups: Groups;
  project: { id: number; slug: string; name: string };
  handoffLine: (task: Task) => string | null;
  t: T;
}) {
  const doing = groups.inFlight.filter((task) => task.status === "doing");
  const blocked = groups.inFlight.filter((task) => task.status === "blocked");
  const row = (task: Task, note: string | null) => (
    <TaskRow
      key={task.id}
      task={task}
      project={project}
      note={note}
      isImportant={task.priority === 1}
      showProject={false}
      t={t}
    />
  );
  return (
    <div className="flex flex-col gap-8">
      <TaskSection
        id="doing"
        title={t("todayDoing")}
        isAccent
        shown={doing.length}
        total={doing.length}
        empty={t("projectDoingEmpty")}
        t={t}
      >
        {doing.map((task) => row(task, handoffLine(task)))}
      </TaskSection>
      <TaskSection
        id="next"
        title={t("todayNext")}
        shown={groups.queued.shown.length}
        total={groups.queued.total}
        empty={t("queuedEmpty")}
        t={t}
      >
        {groups.queued.shown.map((task) => row(task, null))}
      </TaskSection>
      {blocked.length > 0 && (
        <TaskSection id="blocked" title={t("todayBlocked")} shown={blocked.length} total={blocked.length} empty="" t={t}>
          {blocked.map((task) => row(task, handoffLine(task)))}
        </TaskSection>
      )}
      <details id="closed" className="disclosure scroll-mt-6">
        <summary className="today-heading flex min-h-[40px] items-center gap-1.5">
          {t("tabClosed")}
          <span className="today-hint">· {groups.closed.total}</span>
        </summary>
        {groups.closed.shown.length === 0 ? (
          <p className="px-4 py-3 text-body text-muted">{t("closedEmpty")}</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {groups.closed.shown.map((task) => row(task, ago(task.closed_at ?? task.updated_at, t)))}
          </ul>
        )}
        {groups.closed.omitted > 0 && (
          <p className="px-4 pt-2 text-small text-muted">{t("andMore", { n: groups.closed.omitted })}</p>
        )}
      </details>
    </div>
  );
}

/** The board view's columns, from the same groups the list uses. */
function boardColumns(
  groups: Groups,
  counts: Map<number, entriesRepo.EntryCounts>,
  handoffLine: (task: Task) => string | null,
  t: T,
): BoardColumn[] {
  const today = new Date();
  const toCard = (task: Task): BoardCard => ({
    task,
    counts: counts.get(task.id),
    handoffHead: handoffLine(task),
    quietDays: quietDays(task, today),
  });
  return [
    {
      status: "todo",
      title: t("queued"),
      cards: groups.queued.shown.map(toCard),
      omitted: groups.queued.omitted,
      total: groups.queued.total,
      emptyText: t("queuedEmpty"),
    },
    {
      status: "doing",
      title: t("colDoing"),
      cards: groups.inFlight.filter((task) => task.status === "doing").map(toCard),
      omitted: 0,
      total: groups.counts.doing,
      emptyText: t("columnEmpty"),
    },
    {
      status: "blocked",
      title: t("colBlocked"),
      cards: groups.inFlight.filter((task) => task.status === "blocked").map(toCard),
      omitted: 0,
      total: groups.counts.blocked,
      emptyText: t("columnEmpty"),
    },
  ];
}

/** The standing notes: what holds for every task in this project. */
function ProjectNotes({
  slug,
  notes,
  t,
}: {
  slug: string;
  notes: Awaited<ReturnType<typeof contexts.listByProject>>;
  t: T;
}) {
  return (
    <section aria-labelledby="notes-title" className="relative">
      <h2 id="notes-title" className="display min-h-[40px] pr-11 text-[18px] leading-[40px]">
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
      <div className="mt-3">
        {notes.length === 0 ? (
          <Empty>{t("projectContextEmpty")}</Empty>
        ) : (
          <NoteGroups
            notes={notes}
            t={t}
            actions={{ remove: deleteContextAction, update: updateContextAction }}
          />
        )}
      </div>
    </section>
  );
}

/**
 * What a process saw in git while an earlier session ran. Nobody wrote any of
 * it, so it sits below everything somebody chose to record, and says so.
 */
function Observations({
  observed,
  taskIds,
  slug,
  t,
}: {
  observed: Awaited<ReturnType<typeof observationsRepo.pageByProject>>;
  taskIds: ReadonlySet<number>;
  slug: string;
  t: T;
}) {
  return (
    <Group
      id="observations"
      title={t("observationsTitle")}
      count={observed.rows.length + observed.omitted}
      countLabel={t("observationsLabel")}
    >
      <p className="prose text-[14px] text-muted">{t("observationsBody")}</p>
      <ul className="mt-3 space-y-2.5">
        {observed.rows.map((o) => {
          const subjects = (o.commit_subjects ?? "").split("\n").filter(Boolean);
          // Only tasks this page lists: an id for a task since deleted is
          // nothing to link to.
          const started = o.task_ids.filter((id) => taskIds.has(id));
          return (
            <li key={o.id} className="border-l-2 border-line pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-small">
                <span className="mono break-all">
                  {o.branch ? t("observationsBranch", { branch: o.branch }) : t("observationsNoBranch")}
                </span>
                <span>
                  {o.commits === 1 ? t("observationsCommitOne") : t("observationsCommitMany", { n: o.commits })}
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
                <span className="text-meta text-faint">{ago(o.observed_at, t)}</span>
              </div>
              {subjects.length > 0 && (
                <ul className="mono mt-1 space-y-0.5 text-meta text-faint">
                  {subjects.map((subject, i) => (
                    <li key={i} className="break-words">
                      · {subject}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {observed.omitted > 0 && (
        <p className="mt-2.5 text-small text-muted">{t("observationsAndMore", { n: observed.omitted })}</p>
      )}
    </Group>
  );
}
