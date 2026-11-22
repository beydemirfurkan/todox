import type { Metadata } from "next";
import Link from "next/link";

import { ago, LANGS, LANG_NAME } from "@/lib/i18n";
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
import {
  Chip,
  Counter,
  Empty,
  IconTile,
  Panel,
} from "../components";
import { privatePageMetadata } from "../metadata-shared";
import { authMessages } from "../auth-messages";
import { Connections } from "./connections";
import { AuthForm } from "../features/auth-form";
import { SubmitButton } from "../features/submit";
import { RevealCurrent } from "../features/reveal-current";
import { TokenForm } from "../features/token-form";
import { CopyMarkdown } from "../features/copy-markdown";
import { acceptProjectInviteAction, setLangAction, updatePublicProfileAction } from "../actions";
import { PROFILE_BIO_MAX } from "@/lib/constants";
import { MCP_CLIENT_NAMES, MEMORY_SNIPPET, userMemoryPath, type McpClientId } from "@/lib/mcp-clients";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return privatePageMetadata(t("metaTitleAccount"));
}


export const dynamic = "force-dynamic";

const tabIds = ["profile", "public", "signin", "tokens", "invites"] as const;
type TabId = (typeof tabIds)[number];

/**
 * Email, password and connected accounts were three tabs and are now one,
 * because seven no longer fit beside the sidebar. Their old addresses are
 * still linked from the sign-in redirects and from mail, so they keep working.
 */
const SIGNIN_ALIASES = new Set(["email", "password", "connections"]);

function tabFor(value: string | undefined): TabId {
  if (value && SIGNIN_ALIASES.has(value)) return "signin";
  return tabIds.includes(value as TabId) ? (value as TabId) : "profile";
}

function TabIcon({ tab }: { tab: TabId }) {
  const paths = {
    profile: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.8 19c.7-3.1 2.8-4.8 6.2-4.8s5.5 1.7 6.2 4.8" />
      </>
    ),
    public: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z" />
      </>
    ),
    signin: (
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
  searchParams: Promise<{ tab?: string | string[]; error?: string | string[] }>;
}) {
  const user = await requireUser();
  const { t, lang } = await getT();
  // Only for an address this account has proved it holds. Registration does not
  // require verification and the app works without it, so listing by the claimed
  // address told anyone who signed up as somebody else exactly which projects
  // that person had been invited to -- and handed over the id needed to take
  // one. The link in the invitation email still works for an unverified
  // address, because holding it is the proof this list cannot ask for.
  const [tokens, pendingInvites, joinedProjects, sharedProjects] = await Promise.all([
    listApiTokens(user.id),
    user.email_verified_at
      ? invitationsRepo.listPendingForEmail(user.email, new Date().toISOString())
      : Promise.resolve([]),
    membershipsRepo.listByUser(user.id),
    membershipsRepo.sharedOwnedBy(user.id),
  ]);
  const asked = await searchParams;
  const requestedTab = asked.tab;
  const askedError = Array.isArray(asked.error) ? asked.error[0] : asked.error;
  const tabValue = Array.isArray(requestedTab) ? requestedTab[0] : requestedTab;
  const activeTab = tabFor(tabValue);
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "profile", label: t("profile") },
    { id: "public", label: t("pubTitle") },
    { id: "signin", label: t("tabSignIn") },
    { id: "tokens", label: t("apiTokens") },
    { id: "invites", label: t("invites") },
  ];

  return (
    <div className="space-y-6">
      <div className="sticker pop flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <IconTile name="user" color="var(--accent-ink)" className="!size-12" />
        <div className="min-w-[12rem] flex-1">
          <h1 className="display text-[26px] leading-tight sm:text-[30px]">
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
        {/* A phone has no user menu: this tab is where signing out and the
            language live. From `md` both are in the header. */}
        <div className="flex w-full flex-wrap items-center gap-2 md:hidden">
          <form action={setLangAction} className="flex gap-1.5" aria-label={t("languageLabel")}>
            {LANGS.map((l) => (
              <button
                key={l}
                name="lang"
                value={l}
                type="submit"
                className="pill seg"
                aria-current={l === lang ? "true" : undefined}
              >
                {LANG_NAME[l]}
              </button>
            ))}
          </form>
          <form action={logoutAction} className="ml-auto shrink-0">
            <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
              {t("signOut")}
            </SubmitButton>
          </form>
        </div>
      </div>

      {!user.email_verified_at && (
        <div
          role="status"
          className="callout pop flex flex-wrap items-center gap-3 p-4"
        >
          <IconTile name="alert" color="var(--k-question)" />
          <div className="min-w-[15rem] flex-1">
            <p className="text-[15px] font-semibold">{t("verifyPending")}</p>
            <p className="text-[13.5px] text-muted">{t("verifyPendingNote")}</p>
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
              // `aria-label` here replaced the number with the tab's own
              // name, so the badge announced "API tokens, API tokens" and the
              // count -- the only thing it exists to say -- was never read.
              <span className="account-tab-count">
                {tab.id === "tokens" ? tokens.length : pendingInvites.length}
              </span>
            )}
          </Link>
        ))}
        <RevealCurrent />
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

      {activeTab === "public" && (
        <Panel delay={40} title={t("pubTitle")}>
          <div className="max-w-xl space-y-4 p-4">
            <p className="text-small leading-relaxed text-muted">{t("pubLede")}</p>
            {user.profile_public && (
              <p className="flex flex-wrap items-center gap-2 text-small">
                <Chip color="var(--ok)">{t("pubIsOn")}</Chip>
                <a
                  href={`/u/${user.username}`}
                  className="mono break-all text-accentInk underline underline-offset-2"
                >
                  {`${publicUrl()}/u/${user.username}`}
                </a>
              </p>
            )}
            <form action={updatePublicProfileAction} className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="checkbox"
                  name="profile_public"
                  defaultChecked={user.profile_public}
                  disabled={!user.email_verified_at && !user.profile_public}
                />
                {t("pubEnable")}
              </label>
              {!user.email_verified_at && (
                <p className="text-small text-muted">{t("pubVerifyFirst")}</p>
              )}
              <label className="flex flex-col gap-1 text-small text-muted">
                {t("pubBio")}
                <textarea
                  name="bio"
                  rows={3}
                  maxLength={PROFILE_BIO_MAX}
                  defaultValue={user.bio ?? ""}
                />
                <span className="text-meta text-faint">{t("pubBioHint", { n: PROFILE_BIO_MAX })}</span>
              </label>
              <div>
                <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
              </div>
            </form>
            <ul className="list-disc space-y-1 pl-5 text-small text-muted">
              <li>{t("pubShowsProjects")}</li>
              <li>
                {t("pubShowsNotes")}{" "}
                <Link href="/me" className="text-accentInk underline underline-offset-2">
                  {t("navBrain")}
                </Link>
              </li>
              <li>{t("pubNever")}</li>
            </ul>
          </div>
        </Panel>
      )}

      {activeTab === "signin" && (
        <div className="flex flex-col gap-5">
        <Panel delay={40} title={t("tabConnections")}>
          <Connections userId={user.id} errorCode={askedError ?? ""} t={t} />
        </Panel>
        <Panel delay={40} title={t("changeEmail")}>
          <div className="max-w-xl">
            {!user.has_password ? (
              <p className="text-[13.5px] text-muted">{t("changeEmailNeedsPassword")}</p>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Panel>

        <Panel delay={40} title={user.has_password ? t("changePassword") : t("setPassword")}>
          <div className="max-w-xl">
            <p className="mb-3 text-[13.5px] text-muted">
              {user.has_password ? t("changePasswordNote") : t("setPasswordNote")}
            </p>
            <AuthForm
              action={changePasswordAction}
              submitLabel={user.has_password ? t("changePassword") : t("setPassword")}
              pendingLabel={t("saving")}
              messages={authMessages(t)}
              fields={[
                ...(user.has_password
                  ? [
                      {
                        name: "current",
                        label: t("currentPassword"),
                        type: "password" as const,
                        autoComplete: "current-password",
                      },
                    ]
                  : []),
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

        </div>
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
            tooManyTemplate={t("tokenTooMany")}
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
                        <td className="mono text-meta text-faint">
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

          {/* Always here, not only after a token is made: a connected agent
              with no habit is how todox goes unused (dogfood 2026-11-22, B6).
              Holds no credential, so it is safe to show any time. */}
          <section aria-labelledby="habit-title" className="mt-5 border-t border-dashed border-rule pt-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h3 id="habit-title" className="display min-w-[12rem] flex-1 font-bold">
                {t("habitTitle")}
              </h3>
              <CopyMarkdown markdown={MEMORY_SNIPPET} label={t("copySnippet")} copiedLabel={t("shareCopied")} />
            </div>
            <p className="mt-2 text-small text-muted">{t("habitIntro")}</p>
            <pre className="sticker-flat mono mt-3 overflow-x-auto whitespace-pre-wrap break-words p-3 text-meta">
              {MEMORY_SNIPPET}
            </pre>
            <p className="mt-3 text-small text-muted">{t("habitWhere")}</p>
            <ul className="mt-1 space-y-1">
              {(Object.keys(MCP_CLIENT_NAMES) as McpClientId[]).map((id) => (
                <li key={id} className="flex flex-wrap gap-x-2 text-small">
                  <span className="font-bold">{MCP_CLIENT_NAMES[id]}</span>
                  <code className="mono min-w-0 break-all text-faint">{userMemoryPath(id)}</code>
                </li>
              ))}
            </ul>
          </section>
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
      {/* Above the delete block on purpose: its own warning says "export
          anything you want to keep first", and for a long time there was
          nothing to click when you read that. */}
      <section className="sticker-flat mt-8 max-w-xl p-4">
        <h2 className="display text-[15px] font-bold">{t("exportTitle")}</h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{t("exportBody")}</p>
        {/* A plain link, not a form: it is a GET that answers with a file, so
            it needs no JavaScript and survives a middle-click. `download` is a
            hint; the route sends Content-Disposition either way. */}
        <a href="/api/export" download className="btn mt-3 inline-flex">
          {t("exportCta")}
        </a>
      </section>

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
          {sharedProjects.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[14px] text-muted">{t("deleteAccountShared")}</p>
              <ul className="flex flex-col gap-1.5">
                {sharedProjects.map((project) => (
                  <li key={project.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/p/${project.slug}/settings?tab=team`} className="link-more">
                      {project.name}
                    </Link>
                    <span className="text-meta text-faint">
                      {t("deleteAccountSharedMembers", { n: project.members })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!user.has_password && (
            <p className="mb-3 text-[14px] text-muted">{t("deleteAccountReauthNote")}</p>
          )}
          <AuthForm
            action={deleteAccountAction}
            submitLabel={t("deleteAccountSubmit")}
            pendingLabel={t("working")}
            submitClassName="btn btn-danger"
            messages={authMessages(t)}
            fields={[
              ...(user.has_password
                ? [
                    {
                      name: "password",
                      label: t("currentPassword"),
                      type: "password" as const,
                      autoComplete: "current-password",
                    },
                  ]
                : []),
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
