import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { requireUser } from "@/lib/session";
import * as projects from "@/lib/repositories/projects";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as membershipsRepo from "@/lib/repositories/project-memberships";
import * as tasksRepo from "@/lib/repositories/tasks";
import type { PublicUser } from "@/lib/types";
import {
  deleteProjectAction,
  inviteProjectAction,
  removeProjectMemberAction,
  revokeProjectInviteAction,
  setProjectOnProfileAction,
  updateProjectAction,
} from "../../../actions";
import { authMessages } from "../../../auth-messages";
import { Chip, Field, Tabs, currentTab, type Tab } from "../../../components";
import { AuthForm } from "../../../features/auth-form";
import { SharePanel } from "../../../features/share-panel";
import { SubmitButton } from "../../../features/submit";
import { privatePageMetadata } from "../../../metadata-shared";

export const dynamic = "force-dynamic";

const currentUser = cache(requireUser);
const projectBySlug = cache((userId: number, slug: string) => projects.bySlug(userId, slug));

type Project = NonNullable<Awaited<ReturnType<typeof projects.bySlug>>>;

export async function generateMetadata({
  params,
}: PageProps<"/p/[slug]/settings">): Promise<Metadata> {
  const { slug } = await params;
  const { t } = await getT();
  const user = await currentUser();
  const project = await projectBySlug(user.id, slug);
  return privatePageMetadata(
    project ? `${t("projectSettings")} · ${project.name} — ${t("siteName")}` : t("siteName"),
  );
}

/**
 * A project's settings, on their own page instead of a dialog over the work:
 * the details, the team, sharing, and deleting it. The owner's page only --
 * anybody else gets the same 404 a project they cannot see gives, so the
 * address does not even say the settings exist.
 */
export default async function ProjectSettingsPage({
  params,
  searchParams,
}: PageProps<"/p/[slug]/settings">) {
  const { slug } = await params;
  const asked = await searchParams;
  const user = await currentUser();
  const { t } = await getT();
  const project = await projectBySlug(user.id, slug);
  if (!project || project.access_role !== "owner") notFound();

  const tabs: Tab[] = [
    { id: "general", label: t("settingsGeneral"), href: `/p/${slug}/settings` },
    { id: "team", label: t("settingsTeam"), href: `/p/${slug}/settings?tab=team` },
    { id: "sharing", label: t("sharing"), href: `/p/${slug}/settings?tab=sharing` },
    { id: "danger", label: t("settingsDanger"), href: `/p/${slug}/settings?tab=danger` },
  ];
  const tab = currentTab(tabs, asked.tab);

  return (
    <div className="flex max-w-3xl flex-col gap-7">
      <Link href={`/p/${slug}`} className="link-more self-start text-small">
        ← {project.name}
      </Link>
      <h1 className="display -mt-3 text-[34px] leading-tight">{t("projectSettings")}</h1>
      <Tabs tabs={tabs} current={tab} label={t("settingsSections")} />

      {tab === "general" && <GeneralSettings project={project} t={t} />}
      {tab === "team" && <TeamSettings project={project} user={user} t={t} />}
      {tab === "sharing" && <SharingSettings project={project} user={user} t={t} />}
      {tab === "danger" && <DangerSettings project={project} t={t} />}
    </div>
  );
}

/**
 * The details. `repo_url` matters most: it is the only identifier that means
 * the same thing on another machine, and without this form only an agent
 * could set it.
 */
function GeneralSettings({ project, t }: { project: Project; t: T }) {
  return (
    <form action={updateProjectAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={project.id} />
      <Field label={t("projectNameLabel")}>
        <input name="name" defaultValue={project.name} required />
      </Field>
      <Field label={t("projectSummaryLabel")}>
        <textarea name="summary" defaultValue={project.summary ?? ""} rows={3} />
      </Field>
      <Field label={t("projectRepoLabel")}>
        <input
          name="repo_url"
          defaultValue={project.repo_url ?? ""}
          placeholder={t("projectRepoPh")}
          className="mono text-small"
        />
      </Field>
      <p className="-mt-2 text-small text-muted">{t("projectRepoNote")}</p>
      <Field label={t("projectPathLabel")}>
        <input
          name="root_path"
          defaultValue={project.root_path ?? ""}
          placeholder={t("projectPathPh")}
          className="mono text-small"
        />
      </Field>
      <SubmitButton className="btn self-start" pendingLabel={t("working")}>
        {t("apply")}
      </SubmitButton>
    </form>
  );
}

/** Who is in it, who is invited, and the way to ask somebody new. */
async function TeamSettings({ project, user, t }: { project: Project; user: PublicUser; t: T }) {
  const [members, invitations] = await Promise.all([
    membershipsRepo.listByProject(project.id),
    invitationsRepo.listByProject(project.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      {!user.email_verified_at ? (
        <p className="text-small text-muted">{t("inviteNeedsVerifiedEmail")}</p>
      ) : (
        <form action={inviteProjectAction} className="flex flex-wrap items-end gap-2.5">
          <input type="hidden" name="project_id" value={project.id} />
          <Field label={t("inviteEmail")} className="min-w-[14rem] flex-1">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          <SubmitButton className="btn" pendingLabel={t("working")}>
            {t("inviteSend")}
          </SubmitButton>
        </form>
      )}

      <ul className="flex flex-col">
        <li className="settings-row">
          <span className="min-w-[10rem] flex-1 text-[15px] break-words">
            {project.owner_name ?? user.name}
          </span>
          <Chip color="var(--k-decision)">{t("teamOwner")}</Chip>
          <Chip>{t("teamYou")}</Chip>
        </li>
        {members.map((member) => (
          <li key={member.id} className="settings-row">
            <span className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
              <span className="text-[15px] break-words">{member.name}</span>
              {/* The owner sees addresses because the owner invited them. */}
              <span className="mono text-meta break-all text-faint">{member.email}</span>
            </span>
            <form action={removeProjectMemberAction}>
              <input type="hidden" name="membership_id" value={member.id} />
              <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                {t("removeCollaborator")}
                <span className="sr-only"> — {member.name}</span>
              </SubmitButton>
            </form>
          </li>
        ))}
        {invitations.map((invitation) => (
          <li key={invitation.id} className="settings-row">
            <span className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
              <span className="mono text-small break-all">{invitation.email}</span>
              <span className="text-meta text-faint">{t("teamPending")}</span>
            </span>
            <form action={revokeProjectInviteAction}>
              <input type="hidden" name="invitation_id" value={invitation.id} />
              <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                {t("revoke")}
                <span className="sr-only"> — {invitation.email}</span>
              </SubmitButton>
            </form>
          </li>
        ))}
      </ul>
      {members.length === 0 && invitations.length === 0 && (
        <p className="text-small text-muted">{t("teamAlone")}</p>
      )}
    </div>
  );
}

/** The read-only link, and whether the project shows on the public profile. */
async function SharingSettings({ project, user, t }: { project: Project; user: PublicUser; t: T }) {
  return (
    <div className="flex flex-col gap-6">
      <SharePanel
        projectId={project.id}
        token={project.share_token}
        includeLog={project.share_log === 1}
        origin={publicUrl()}
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
      <form action={setProjectOnProfileAction} className="settings-row border-t border-rule pt-5">
        <input type="hidden" name="project_id" value={project.id} />
        <input type="hidden" name="on_profile" value={project.on_profile ? "0" : "1"} />
        <span className="min-w-[12rem] flex-1 text-small text-muted">
          {project.on_profile ? t("projectOnProfileOn") : t("projectOnProfileOff")}
        </span>
        <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
          {project.on_profile ? t("projectOnProfileHide") : t("projectOnProfileShow")}
        </SubmitButton>
      </form>
    </div>
  );
}

/**
 * Merging is an agent tool only (`merge_projects`), so this says how to ask
 * for it rather than offering a button that does not exist. Deleting asks
 * for the slug typed out.
 */
async function DangerSettings({ project, t }: { project: Project; t: T }) {
  const count = await tasksRepo.counts(project.id);
  const taskCount = count.todo + count.doing + count.blocked + count.done + count.dropped;
  return (
    <div className="danger-zone">
      <section className="settings-row">
        <span className="flex min-w-[14rem] flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">{t("settingsMergeTitle")}</h2>
          <p className="text-small text-muted">{t("settingsMergeBody")}</p>
        </span>
      </section>
      <section className="flex flex-col gap-3 pt-5">
        <h2 className="text-[15px] font-semibold">{t("deleteProject")}</h2>
        <p className="text-small text-muted">{t("deleteProjectNote", { n: taskCount })}</p>
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
  );
}
