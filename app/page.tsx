import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { OPEN_STATUSES } from "@/lib/constants";
import { getT, getTz } from "@/lib/lang";
import type { Lang, T } from "@/lib/i18n";
import { currentUser } from "@/lib/session";
import type { PublicUser } from "@/lib/types";
import * as apiTokens from "@/lib/repositories/api-tokens";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as memberships from "@/lib/repositories/project-memberships";
import * as tasks from "@/lib/repositories/tasks";
import { firstLine } from "@/lib/util/headline";
import { accountProjects } from "./account-projects";
import { clearEmptyProjectAction } from "./actions";
import { IconTile, WaitingList } from "./components";
import { OrganizationJsonLd } from "./components/organization-json-ld";
import { PageSkeleton } from "./components/page-skeleton";
import { projectColor } from "./components/project-color";
import { QuickAdd } from "./components/quick-add";
import { TaskRow, TaskSection } from "./components/task-row";
import { FirstSteps } from "./features/first-steps";
import { Landing } from "./features/landing";
import { SubmitButton } from "./features/submit";
import { QUIET_AFTER_DAYS } from "./p/[slug]/board";
import { pageOpenGraph } from "./metadata-shared";
import { waitingItems } from "./waiting";

/**
 * Rows Today prints per section. The totals beside them are the true ones,
 * and the rest are a click away on their projects.
 */
const DOING_SHOWN = 20;
const NEXT_SHOWN = 8;
const BLOCKED_SHOWN = 5;

/** Cards in "Waiting on you". The rest are counted, and found on their projects. */
const WAITING_SHOWN = 6;

const DAY_MS = 86_400_000;

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: t("metaTitleHome"),
    description: t("metaDescription"),
    alternates: { canonical: "/" },
    openGraph: pageOpenGraph("/"),
  };
}

export default async function Home() {
  const { t, lang } = await getT();
  const user = await currentUser();
  // The one page with two audiences. Signed out this is the only description
  // of the product anyone can reach; signed in it is the dashboard.
  //
  // The schema goes with the signed-out half only. `/` is in the sitemap
  // because of what a crawler gets there, and a crawler never has a session --
  // so the dashboard rendering is not the thing being described.
  if (!user)
    return (
      <>
        <OrganizationJsonLd />
        <Landing t={t} />
      </>
    );
  // Its own boundary, so a click on Today shows the page's shape at once
  // instead of waiting for nine queries. Not a `loading.tsx`: one at the root
  // would flash a skeleton over the landing page and every marketing page too.
  return (
    <Suspense fallback={<PageSkeleton label={t("loadingPage")} />}>
      <Today user={user} t={t} lang={lang} />
    </Suspense>
  );
}

async function Today({ user, t, lang }: { user: PublicUser; t: T; lang: Lang }) {
  const [{ projects: allProjects, counts }, connected] = await Promise.all([
    // Shared with the sidebar through `cache`, so this is not a second query.
    accountProjects(user.id),
    // Rides along rather than costing a round trip of its own.
    apiTokens.hasConnectedAgent(user.id),
  ]);

  if (allProjects.length === 0)
    return <FirstSteps name={user.name.trim()} isConnected={connected} t={t} />;

  /**
   * Owned, and empty for everybody -- not just for me.
   *
   * Both halves were wrong first time round and both were found by building
   * the case. The project list answers with projects shared WITH this account
   * as well as its own, and `clearEmptyProjectAction` asserts ownership -- so a
   * shared project appeared in this list and its button threw. And notes were
   * counted per author, so a project holding only its owner's standing rules
   * read as empty to a member. `removeIfEmpty` refuses on any note by anyone,
   * which is the definition this list matches.
   */
  const owned = allProjects.filter((p) => p.user_id === user.id);
  const allIds = allProjects.map((p) => p.id);
  const renderedAt = new Date();
  const quietBefore = new Date(renderedAt.getTime() - QUIET_AFTER_DAYS * DAY_MS).toISOString();
  // Everything below needs the project ids, so it waits for them -- together.
  const [doing, next, blocked, teamSizes, notesByProject, pending, questions, stalled] =
    await Promise.all([
      tasks.openAcross(allIds, "doing", DOING_SHOWN),
      tasks.openAcross(allIds, "todo", NEXT_SHOWN),
      tasks.openAcross(allIds, "blocked", BLOCKED_SHOWN),
      memberships.countsByProjects(allIds),
      contexts.projectIdsHoldingNotes(owned.map((p) => p.id)),
      // People waiting on an invitation. Without this the list and the DELETE
      // disagree, and a disagreement here is a button that does nothing.
      invitationsRepo.projectIdsWithPending(owned.map((p) => p.id), renderedAt.toISOString()),
      // What only a person can move: asked across every project this account
      // can see, because a question in a quiet project waits just as long.
      entriesRepo.openQuestionsByProjects(allIds, OPEN_STATUSES, WAITING_SHOWN),
      tasks.stalledByProjects(allIds, quietBefore, WAITING_SHOWN),
    ]);
  // The agent's last word on each task in progress: one query for all of them.
  const handoffs = await entriesRepo.latestHandoffByTasks(doing.map((task) => task.id));
  const waiting = waitingItems({ questions, stalled, limit: WAITING_SHOWN, now: renderedAt });
  const slugOf = new Map(allProjects.map((p) => [p.id, p.slug]));
  const projectOf = new Map(allProjects.map((p) => [p.id, p]));

  /**
   * The same question `removeIfEmpty` asks, in the same terms: no tasks, no
   * notes, no people, no invitation waiting. If this list is looser than the
   * DELETE the button does nothing; if it is tighter the fold hides work
   * somebody could clear.
   */
  const emptyProjects = owned.filter(
    (p) =>
      !counts.map.has(p.id) &&
      !notesByProject.has(p.id) &&
      !(teamSizes.get(p.id) ?? 0) &&
      !pending.has(p.id),
  );

  const total = (status: "todo" | "doing" | "blocked") =>
    allIds.reduce((sum, id) => sum + (counts.map.get(id)?.[status] ?? 0), 0);
  const totals = { doing: total("doing"), todo: total("todo"), blocked: total("blocked") };
  const projectsWithOpenWork = allIds.filter((id) => {
    const count = counts.map.get(id);
    return count && count.todo + count.doing + count.blocked > 0;
  }).length;
  const today = new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-GB", {
    day: "numeric",
    month: "long",
    weekday: "long",
    timeZone: await getTz(),
  }).format(renderedAt);

  const rowFor = (task: tasks.LaneTask, note?: string | null) => {
    const project = projectOf.get(task.project_id);
    if (!project) return null;
    return (
      <TaskRow
        key={task.id}
        task={task}
        project={project}
        note={note}
        isImportant={task.priority === 1}
        t={t}
      />
    );
  };

  return (
    <div className="today flex flex-col gap-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="display text-[34px] leading-tight">{t("todayTitle")}</h1>
        <p className="text-body text-muted">
          {today} ·{" "}
          {t("todaySummary", {
            tasks: totals.doing + totals.todo + totals.blocked,
            projects: projectsWithOpenWork,
          })}
        </p>
      </header>

      <QuickAdd target={{ projects: allProjects }} t={t} />

      {waiting.items.length > 0 && (
        <section aria-labelledby="waiting" className="flex flex-col gap-2">
          <h2 id="waiting" className="today-heading text-[color:var(--k-question)]">
            {t("waitingTitle")}
          </h2>
          <WaitingList items={waiting.items} omitted={waiting.omitted} slugOf={slugOf} t={t} />
        </section>
      )}

      <TaskSection
        id="doing"
        title={t("todayDoing")}
        hint={t("todayDoingHint")}
        isAccent
        shown={doing.length}
        total={totals.doing}
        empty={t("todayDoingEmpty")}
        t={t}
      >
        {doing.map((task) => {
          const handoff = handoffs.get(task.id);
          return rowFor(task, handoff ? firstLine(handoff.body) : null);
        })}
      </TaskSection>

      <TaskSection
        id="next"
        title={t("todayNext")}
        hint={t("todayNextHint")}
        shown={next.length}
        total={totals.todo}
        empty={t("todayNextEmpty")}
        t={t}
      >
        {next.map((task) => rowFor(task))}
      </TaskSection>

      {blocked.length > 0 && (
        <TaskSection
          id="blocked"
          title={t("todayBlocked")}
          shown={blocked.length}
          total={totals.blocked}
          empty=""
          t={t}
        >
          {blocked.map((task) => rowFor(task))}
        </TaskSection>
      )}

      {/* On a phone the sidebar is gone, and with it the project list -- so
          it lives at the bottom of Today there. */}
      <section aria-labelledby="projects-mobile" className="flex flex-col gap-2 md:hidden">
        <h2 id="projects-mobile" className="today-heading">
          {t("projects")}
        </h2>
        <ul className="flex flex-col">
          {allProjects.map((project) => {
            const count = counts.map.get(project.id);
            const open = count ? count.todo + count.doing + count.blocked : 0;
            return (
              <li key={project.id}>
                <Link href={`/p/${project.slug}`} className="task-row" data-align="center">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: projectColor(project.id) }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[16px]">{project.name}</span>
                  {open > 0 && (
                    <span className="text-meta text-muted">
                      {t("sidebarOpenCount", { n: open })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {emptyProjects.length > 0 && (
        // Quiet on purpose: a fold, not a banner. These are the cost of
        // registration being frictionless enough that an agent never stops to
        // ask, so the count is visible and the list is one click away.
        <details className="disclosure sticker p-5">
          <summary className="cursor-pointer text-[14px]">
            {emptyProjects.length === 1
              ? t("emptyProjectsTitleOne")
              : t("emptyProjectsTitleMany", { n: emptyProjects.length })}
          </summary>
          <p className="mt-1.5 text-small text-muted">{t("emptyProjectsBody")}</p>
          <ul className="mt-3 space-y-1.5">
            {emptyProjects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <Link href={`/p/${p.slug}`} className="mono link-more min-w-0 truncate">
                  {p.slug}
                </Link>
                {p.root_path && (
                  <span className="mono min-w-0 truncate text-meta text-faint" title={p.root_path}>
                    {p.root_path}
                  </span>
                )}
                <form action={clearEmptyProjectAction} className="ms-auto">
                  <input type="hidden" name="project_id" value={p.id} />
                  <SubmitButton pendingLabel={t("working")}>{t("emptyProjectsRemove")}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Once an agent has actually connected -- a token that has been used,
          not one that exists -- telling somebody to connect one is advice they
          have already taken. Same line `pnpm funnel` draws. */}
      {!connected && (
        <section className="sticker flex items-start gap-4 p-5" aria-labelledby="hook-up">
          <IconTile name="terminal" color="var(--accent-ink)" />
          <div className="min-w-0 flex-1">
            <h2 id="hook-up" className="text-[16px] font-semibold">
              {t("hookTitle")}
            </h2>
            <p className="mt-1 text-[14px] text-muted">{t("hookBody")}</p>
            <Link href="/account?tab=tokens" className="link-more mt-3 inline-block">
              {t("hookCta")}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
