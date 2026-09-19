import type { Metadata } from "next";
import Link from "next/link";

import { CONTEXT_KINDS } from "@/lib/constants";
import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import * as apiTokens from "@/lib/repositories/api-tokens";
import { OPEN_STATUSES } from "@/lib/constants";
import * as contexts from "@/lib/repositories/contexts";
import * as entriesRepo from "@/lib/repositories/entries";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as memberships from "@/lib/repositories/project-memberships";
import * as tasks from "@/lib/repositories/tasks";
import * as projectActivity from "@/lib/services/project-activity";
import {
  addContextAction,
  clearEmptyProjectAction,
  createProjectAction,
  deleteContextAction,
} from "./actions";
import { OrganizationJsonLd } from "./components/organization-json-ld";
import { Explainer, FirstRun } from "./features/explainer";
import { Landing } from "./features/landing";
import { Picker } from "./features/picker";
import { SubmitButton } from "./features/submit";
import { kindOptions } from "./kinds";
import {
  Blob,
  Composer,
  Empty,
  Field,
  Group,
  NoteGroups,
  ProjectCard,
  ProjectFields,
  ProjectRow,
} from "./components";
import { groupProjects } from "./project-groups";
import { pageOpenGraph } from "./metadata-shared";

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
  const { t } = await getT();
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
  // One counts query for the whole page instead of one per project card.
  const [allProjects, globalContext, counts, connected] = await Promise.all([
    projectActivity.listRecent(user.id),
    contexts.listByProject(user.id, null),
    tasks.countsByProject(user.id),
    // Rides along rather than costing a round trip of its own.
    apiTokens.hasConnectedAgent(user.id),
  ]);
  /**
   * Owned, and empty for everybody -- not just for me.
   *
   * Both halves were wrong first time round and both were found by building
   * the case. The project activity list answers with projects shared WITH this
   * account as well as its own, and `clearEmptyProjectAction` asserts ownership
   * -- so a shared project appeared in this list and its button threw. And
   * notes were counted per author, so a project holding only its owner's
   * standing rules read as empty to a member. `removeIfEmpty` refuses on any
   * note by anyone, which is the definition this list now matches.
   */
  const owned = allProjects.filter((p) => p.user_id === user.id);
  // Both of these need the project list first, so they wait -- but they wait
  // together, the way the project page pairs its own second round.
  const [teamSizes, notesByProject, pending, leftOff] = await Promise.all([
    // One grouped query for every card, not one per card.
    memberships.countsByProjects(allProjects.map((p) => p.id)),
    contexts.projectIdsHoldingNotes(owned.map((p) => p.id)),
    // People waiting on an invitation. Without this the list and the DELETE
    // disagree, and a disagreement here is a button that does nothing.
    invitationsRepo.projectIdsWithPending(owned.map((p) => p.id), new Date().toISOString()),
    // What a card can say that its name and its counts cannot.
    entriesRepo.latestHandoffByProjects(allProjects.map((p) => p.id), OPEN_STATUSES),
  ]);

  /**
   * Projects that hold nothing at all.
   *
   * `list_projects` has counted these and left them out since it was written,
   * and the browser has never had anywhere to act on that count. Registration
   * is deliberately frictionless -- a path an agent passes becomes a project --
   * so the shells are the price of that, and on 2026-09-04 they were eighteen
   * of sixty-four across the account holders here.
   *
   * Notes are what separates "empty" from "quiet": a project can carry standing
   * rules and no tasks, and that is a project doing its job.
   */
  /**
   * The same question `removeIfEmpty` asks, in the same terms.
   *
   * A project with people in it is not empty, whatever else it holds -- and
   * the state right after inviting somebody into a fresh repo is exactly no
   * tasks and no notes. That project was listed here with a one-click remove,
   * and the click took the membership and the invitation with it.
   *
   * The two definitions have to stay in step: if this list is looser than the
   * DELETE the button does nothing, and if it is tighter the fold hides work
   * somebody could clear.
   */
  const emptyProjects = owned.filter(
    (p) =>
      !counts.map.has(p.id) &&
      !notesByProject.has(p.id) &&
      !(teamSizes.get(p.id) ?? 0) &&
      !pending.has(p.id),
  );

  /**
   * The pitch is for somebody who has not started yet.
   *
   * It used to be here on every visit: a headline, a paragraph explaining what
   * todox is, and three cards explaining how it works — better than half the
   * screen, above the projects, for an account that has been using it for a
   * month. Explaining the product to the person already using it is the same
   * failure the log itself is written against: a thing that is always true
   * does not need saying every time.
   *
   * The first project is the line. Before it there is nothing else to show and
   * the page has to teach; after it the page has work on it, and the
   * explanation is one click away on /about. The five entry kinds go with it,
   * because the task composer already names each one where it is actually
   * being chosen.
   */
  const beforeFirstProject = allProjects.length === 0;

  /**
   * What is moving, then what is not.
   *
   * Every project used to be a card, at equal weight, newest activity first:
   * thirty-two of them over 4,200px on the account that measured it, with the
   * six that had work in flight sitting among twenty-four that had none, and
   * the notes that hold for every project at the very bottom. The page now
   * reads in the order the agent's briefing does -- the same fold the project
   * page moved to -- and a quiet project is a row, because there is nothing
   * happening in it to fill a card with.
   */
  const { live, quiet } = groupProjects(
    allProjects,
    counts.map,
    new Set(emptyProjects.map((p) => p.id)),
  );
  const countsOf = (id: number) => counts.map.get(id) ?? counts.empty;
  const teamOf = (id: number) => teamSizes.get(id) ?? 0;

  const newGlobalNote = (
    <Composer id="new-global-note" label={t("addGlobalNote")} action={addContextAction}>
      <Field label={t("title")}>
        <input name="title" autoFocus required />
      </Field>
      <Field label={t("noteBodyPh")}>
        <textarea name="body" required />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("globalContext")} className="w-full min-w-0 sm:w-40">
          <Picker
            name="kind"
            value={CONTEXT_KINDS[0]}
            options={kindOptions(t)}
            label={t("globalContext")}
          />
        </Field>
        <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
      </div>
    </Composer>
  );

  return (
    <div className="space-y-5">
      {beforeFirstProject ? (
        <>
          <div className="pop prose">
            <h1 className="display text-[28px] leading-[1.1] font-bold sm:text-[36px]">
              {t("heroTitle")}
            </h1>
            <p className="mt-2 text-[15.5px] leading-relaxed text-muted">{t("heroBody")}</p>
          </div>

          <Explainer t={t} />

          <h2 className="display pop pt-1 text-[25px] font-bold">{t("projects")}</h2>
          {/* The first project is the line. Before it there is one thing to
              do, so the form is open rather than behind a "+". */}
          <FirstRun t={t}>
            <form action={createProjectAction} className="mt-2 w-full max-w-sm space-y-2 text-left">
              <ProjectFields t={t} />
            </form>
          </FirstRun>
        </>
      ) : (
        // The page is a list of projects, so that is its heading. Promoted from
        // h2 rather than left behind a headline that is no longer the subject:
        // a document has one h1, and this is now it.
        <h1 className="display pop text-[28px] leading-[1.1] font-bold sm:text-[36px]">
          {t("projects")}
        </h1>
      )}

      {!beforeFirstProject && (
        <Group
          id="live"
          title={t("inFlight")}
          count={live.length}
          countLabel={t("projectsCount")}
          open
          delay={60}
        >
          {live.length === 0 ? (
            <Empty mood="happy">{t("liveProjectsEmpty")}</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {live.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  counts={countsOf(p.id)}
                  teamSize={teamOf(p.id)}
                  leftOff={leftOff.get(p.id)?.body ?? null}
                  t={t}
                />
              ))}
            </div>
          )}
        </Group>
      )}

      {/* Above the quiet projects, not below every project: these are the
          notes that hold everywhere, and they used to sit under thirty cards. */}
      <Group
        id="global-context"
        title={t("globalContext")}
        count={globalContext.length}
        countLabel={t("notes")}
        right={<span className="text-small font-normal text-muted">{t("globalContextSub")}</span>}
        action={newGlobalNote}
        open
        delay={120}
      >
        {globalContext.length === 0 ? (
          <Empty>{t("globalEmpty")}</Empty>
        ) : (
          // The same rows as a project's notes: a note that ran to three
          // thousand characters used to push everything under it off the
          // first screen, and now it is a line until it is opened.
          <NoteGroups notes={globalContext} t={t} deleteAction={deleteContextAction} />
        )}
      </Group>

      {!beforeFirstProject && (
        <Group
          id="quiet"
          title={t("quietProjects")}
          count={quiet.length}
          countLabel={t("projectsCount")}
          // A new project has no work in flight, so this is the group it
          // lands in, and the "+" sits on the group its result lands in.
          action={
            <Composer id="new-project" label={t("newProject")} action={createProjectAction}>
              <ProjectFields t={t} autoFocus />
            </Composer>
          }
          open
          delay={180}
        >
          {quiet.length === 0 ? (
            <Empty mood="happy">{t("quietEmpty")}</Empty>
          ) : (
            <ul className="space-y-1.5">
              {quiet.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  counts={countsOf(p.id)}
                  teamSize={teamOf(p.id)}
                  t={t}
                />
              ))}
            </ul>
          )}
        </Group>
      )}

      {emptyProjects.length > 0 && (
        // Quiet on purpose: a fold, not a banner. These are not a problem to be
        // alarmed about -- they are the cost of registration being frictionless
        // enough that an agent never stops to ask -- so the count is visible
        // and the list is one click away.
        <details className="disclosure sticker pop p-4" style={{ animationDelay: "240ms" }}>
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
                  <span className="mono min-w-0 truncate text-[12px] text-faint" title={p.root_path}>
                    {p.root_path}
                  </span>
                )}
                <form action={clearEmptyProjectAction} className="ms-auto">
                  <input type="hidden" name="project_id" value={p.id} />
                  {/* A real label, not an icon: colour and shape never carry
                      meaning alone here. */}
                  <SubmitButton pendingLabel={t("working")}>
                    {t("emptyProjectsRemove")}
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* The same rule as the pitch above, applied to the last block on the
          page: once an agent has actually connected, telling somebody to
          connect one is advice they have already taken.

          "Connected" is a token that has been used, not a token that exists.
          Minting one is a click and the setup failing afterwards is precisely
          the case this prompt is for — which is the same line `pnpm funnel`
          draws between "got as far as the Account page" and "the setup
          actually worked", so the page and the measurement agree. */}
      {!connected && (
      <section
        className="pop sticker p-5"
        style={{ animationDelay: "300ms" }}
        aria-labelledby="hook-up"
      >
        <div className="flex items-start gap-4">
          <Blob mood="idle" size={52} fill="var(--k-handoff)" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 id="hook-up" className="display text-[18px] font-bold">
              {t("hookTitle")}
            </h2>
            <p className="mt-1 text-[14px] text-muted">{t("hookBody")}</p>
            <Link href="/account" className="link-more mt-3 inline-block">
              {t("hookCta")}
            </Link>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
