import type { Metadata } from "next";
import Link from "next/link";

import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { listApiTokens } from "@/lib/services/auth";
import * as invitationsRepo from "@/lib/repositories/project-invitations";
import * as membershipsRepo from "@/lib/repositories/project-memberships";
import { requireUser } from "@/lib/session";
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  logoutAction,
  resendVerificationAction,
  revokeAllTokensAction,
  revokeTokenAction,
  updateNameAction,
} from "../auth-actions";
import { Blob, Chip, Counter, Empty, Panel } from "../components";
import { privatePageMetadata } from "../metadata-shared";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { SubmitButton } from "../features/submit";
import { TokenForm } from "../features/token-form";
import { acceptProjectInviteAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleAccount"));
}


export const dynamic = "force-dynamic";

const tabIds = ["profile", "email", "password", "tokens", "invites"] as const;
type TabId = (typeof tabIds)[number];

function isTabId(value: string | undefined): value is TabId {
  return tabIds.includes(value as TabId);
}

function TabIcon({ tab }: { tab: TabId }) {
  const paths = {
    profile: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.8 19c.7-3.1 2.8-4.8 6.2-4.8s5.5 1.7 6.2 4.8" />
      </>
    ),
    email: (
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
        <path d="m5 7 7 5.4L19 7" />
      </>
    ),
    password: (
      <>
        <rect x="4" y="10" width="16" height="10" rx="2.5" />
        <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2.5" />
      </>
    ),
    tokens: (
      <>
        <circle cx="8.5" cy="11.5" r="4.5" />
        <path d="m12.5 11.5 8-8M16.5 7.5l2 2M18.5 5.5l2 2" />
      </>
    ),
    invites: (
      <>
        <path d="M4 7.5h11v9H4zM5 8.5l4.5 3.4L14 8.5" />
        <path d="M18.5 10v7M15 13.5h7" />
      </>
    ),
  } satisfies Record<TabId, React.ReactNode>;

  return (
    <svg
      className="account-tab-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[tab]}
    </svg>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const user = await requireUser();
  const { t } = await getT();
  // Only for an address this account has proved it holds. Registration does not
  // require verification and the app works without it, so listing by the claimed
  // address told anyone who signed up as somebody else exactly which projects
  // that person had been invited to -- and handed over the id needed to take
  // one. The link in the invitation email still works for an unverified
  // address, because holding it is the proof this list cannot ask for.
  const [tokens, pendingInvites, joinedProjects] = await Promise.all([
    listApiTokens(user.id),
    user.email_verified_at
      ? invitationsRepo.listPendingForEmail(user.email, new Date().toISOString())
      : Promise.resolve([]),
    membershipsRepo.listByUser(user.id),
  ]);
  const requestedTab = (await searchParams).tab;
  const tabValue = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const activeTab: TabId = isTabId(tabValue) ? tabValue : "profile";
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "profile", label: t("profile") },
    { id: "email", label: t("changeEmail") },
    { id: "password", label: t("changePassword") },
    { id: "tokens", label: t("apiTokens") },
    { id: "invites", label: t("invites") },
  ];

  return (
    <div className="space-y-6">
      <div className="sticker pop flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <Blob mood="happy" size={48} className="shrink-0" />
        <div className="min-w-[12rem] flex-1">
          <h1 className="display text-[26px] leading-tight font-bold sm:text-[30px]">
            {user.name}
          </h1>
          <p className="mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <span>@{user.username}</span>
            <span aria-hidden="true">·</span>
            <span className="break-all">{user.email}</span>
            {user.email_verified_at && (
              <Chip color="var(--ok)">{t("verifyVerified")}</Chip>
            )}
          </p>
        </div>
        <form action={logoutAction} className="ml-auto shrink-0 sm:hidden">
          <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
            {t("signOut")}
          </SubmitButton>
        </form>
      </div>

      {!user.email_verified_at && (
        <div
          role="status"
          className="on-fill sticker pop flex flex-wrap items-center gap-3 p-4"
          style={{ background: "var(--k-question)" }}
        >
          <Blob
            mood="worried"
            size={40}
            fill="var(--paper)"
            stroke="var(--ink)"
            className="shrink-0"
          />
          <div className="min-w-[15rem] flex-1">
            <p className="display text-[15px] font-bold">{t("verifyPending")}</p>
            <p className="text-[13.5px]">{t("verifyPendingNote")}</p>
          </div>
          <form action={resendVerificationAction} className="shrink-0">
            <SubmitButton className="btn btn-quiet" pendingLabel={t("sendingLink")}>
              {t("verifyResend")}
            </SubmitButton>
          </form>
        </div>
      )}

      <nav className="account-tabs pop" aria-label={t("accountTitle")}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            href={tab.id === "profile" ? "/account" : `/account?tab=${tab.id}`}
            className="account-tab"
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            <TabIcon tab={tab.id} />
            <span>{tab.label}</span>
            {((tab.id === "tokens" && tokens.length > 0) ||
              (tab.id === "invites" && pendingInvites.length > 0)) && (
              <span className="account-tab-count" aria-label={tab.label}>
                {tab.id === "tokens" ? tokens.length : pendingInvites.length}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {activeTab === "profile" && (
        <Panel delay={40} title={t("profile")}>
          <div className="max-w-xl">
            <AuthForm
              action={updateNameAction}
              submitLabel={t("save")}
              pendingLabel={t("saving")}
              successLabel={t("profileSaved")}
              messages={authMessages(t)}
              fields={[
                {
                  name: "name",
                  label: t("displayName"),
                  autoComplete: "name",
                  defaultValue: user.name,
                },
              ]}
            />
          </div>
        </Panel>
      )}

      {activeTab === "email" && (
        <Panel delay={40} title={t("changeEmail")}>
          <div className="max-w-xl">
            <p className="mb-3 text-[13.5px] text-muted">{t("changeEmailNote")}</p>
            <AuthForm
              action={changeEmailAction}
              submitLabel={t("changeEmail")}
              pendingLabel={t("sendingLink")}
              successLabel={t("changeEmailSent")}
              messages={authMessages(t)}
              fields={[
                {
                  name: "email",
                  label: t("email"),
                  type: "email",
                  autoComplete: "email",
                  defaultValue: user.email,
                },
                {
                  name: "current",
                  label: t("currentPassword"),
                  type: "password",
                  autoComplete: "current-password",
                },
              ]}
            />
          </div>
        </Panel>
      )}

      {activeTab === "password" && (
        <Panel delay={40} title={t("changePassword")}>
          <div className="max-w-xl">
            <p className="mb-3 text-[13.5px] text-muted">{t("changePasswordNote")}</p>
            <AuthForm
              action={changePasswordAction}
              submitLabel={t("changePassword")}
              pendingLabel={t("saving")}
              messages={authMessages(t)}
              fields={[
                {
                  name: "current",
                  label: t("currentPassword"),
                  type: "password",
                  autoComplete: "current-password",
                },
                {
                  name: "password",
                  label: t("newPassword"),
                  type: "password",
                  autoComplete: "new-password",
                },
              ]}
            />
          </div>
        </Panel>
      )}

      {activeTab === "tokens" && (
        <Panel
          delay={40}
          title={t("apiTokens")}
          right={<Counter n={tokens.length} label={t("apiTokens")} />}
        >
          <p className="mb-3 text-[14px] text-muted">{t("apiTokensIntro")}</p>

          <TokenForm
            url={`${publicUrl()}/api/mcp`}
            promptTemplate={t("setupPromptTemplate")}
            nameLabel={t("tokenName")}
            submitLabel={t("createToken")}
            pendingLabel={t("tokenCreating")}
            onceLabel={t("tokenOnce")}
            setup={{
              promptTitle: t("setupPromptTitle"),
              promptWarning: t("setupPromptWarning"),
              manualTitle: t("setupManualTitle"),
              scopeNote: t("setupScopeNote"),
              agentLabel: t("setupAgentLabel"),
              other: t("setupAgentOther"),
              verify: t("setupVerify"),
              copy: t("copySnippet"),
              copied: t("shareCopied"),
            }}
          />

          {tokens.length > 0 ? (
            <div className="mt-5 border-t border-dashed border-rule pt-4">
              <div className="account-token-table-wrap">
                <table className="account-token-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("tokenColumnName")}</th>
                      <th scope="col">{t("tokenColumnActivity")}</th>
                      <th scope="col">{t("tokenColumnCreated")}</th>
                      <th scope="col" className="text-right">
                        {t("tokenColumnActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((tok) => (
                      <tr key={tok.id}>
                        <th scope="row" className="display font-bold">
                          {tok.name}
                        </th>
                        <td>
                          <Chip color={tok.last_used_at ? "var(--ok)" : undefined}>
                            {tok.last_used_at
                              ? `${t("lastUsed")} ${ago(tok.last_used_at, t)}`
                              : t("neverUsed")}
                          </Chip>
                        </td>
                        <td className="mono text-[11px] text-faint">
                          {ago(tok.created_at, t)}
                        </td>
                        <td className="text-right">
                          <form action={revokeTokenAction}>
                            <input type="hidden" name="token_id" value={tok.id} />
                            <SubmitButton
                              className="link-more !text-[12px]"
                              pendingLabel={t("working")}
                            >
                              {t("revoke")}
                              <span className="sr-only"> — {tok.name}</span>
                            </SubmitButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="min-w-[15rem] flex-1 text-[13.5px] text-muted">
                  {t("revokeAllNote")}
                </p>
                <form action={revokeAllTokensAction} className="shrink-0">
                  <SubmitButton className="link-more !text-[13px]" pendingLabel={t("working")}>
                    {t("revokeAll")}
                  </SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <Empty>{t("noTokens")}</Empty>
            </div>
          )}
        </Panel>
      )}

      {activeTab === "invites" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            delay={40}
            title={t("pendingInvites")}
            right={<Counter n={pendingInvites.length} label={t("pendingInvites")} />}
          >
            {pendingInvites.length ? (
              <div className="space-y-2">
                {pendingInvites.map((invitation) => (
                  <div key={invitation.id} className="sticker-flat flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-[12rem] flex-1">
                      <p className="display font-bold">{invitation.project_name}</p>
                      <p className="text-[12.5px] text-muted">
                        {invitation.inviter_name ?? t("projects")} · {ago(invitation.created_at, t)}
                      </p>
                    </div>
                    <form action={acceptProjectInviteAction}>
                      <input type="hidden" name="invitation_id" value={invitation.id} />
                      <SubmitButton className="btn" pendingLabel={t("working")}>
                        {t("acceptInvite")}
                      </SubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>{t("noInvites")}</Empty>
            )}
          </Panel>
          <Panel
            delay={80}
            title={t("joinedProjects")}
            right={<Counter n={joinedProjects.length} label={t("joinedProjects")} />}
          >
            {joinedProjects.length ? (
              <div className="space-y-2">
                {joinedProjects.map((membership) => (
                  <Link
                    key={membership.id}
                    href={`/p/${membership.access_slug}`}
                    className="sticker-flat lift block p-3"
                  >
                    <p className="display font-bold">{membership.project_name}</p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {membership.owner_name} · {membership.owner_email}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <Empty>{t("noJoinedProjects")}</Empty>
            )}
          </Panel>
        </div>
      )}

      {/* Outside the tabs, and last.

          It used to sit inside the Profile tab, directly under a form with one
          field in it — a full-width bar 11 times wider than the Save button
          beside it, which made destroying the account the largest thing on the
          page. `w-fit` so the disclosure is as wide as its own label. */}
      <details
        className="sticker-flat mt-8 w-fit overflow-hidden"
        style={{ borderColor: "var(--k-dead_end)" }}
      >
        <summary className="display flex cursor-pointer items-center gap-2 px-4 py-3 text-[15px] font-bold">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 shrink-0 rounded-full border-[1.5px]"
            style={{ background: "var(--k-dead_end)", borderColor: "var(--edge-dark)" }}
          />
          {t("deleteAccount")}
        </summary>
        <div className="max-w-xl border-t border-dashed border-rule p-4">
          <p className="mb-3 text-[14px] text-muted">{t("deleteAccountNote")}</p>
          <AuthForm
            action={deleteAccountAction}
            submitLabel={t("deleteAccountSubmit")}
            pendingLabel={t("working")}
            submitClassName="btn btn-danger"
            messages={authMessages(t)}
            fields={[
              {
                name: "password",
                label: t("currentPassword"),
                type: "password",
                autoComplete: "current-password",
              },
              {
                name: "confirm",
                label: t("deleteAccountConfirm"),
                autoComplete: "off",
                exact: true,
              },
            ]}
          />
        </div>
      </details>
    </div>
  );
}
