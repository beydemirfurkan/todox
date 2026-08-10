import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { listApiTokens } from "@/lib/services/auth";
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
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { SubmitButton } from "../features/submit";
import { TokenForm } from "../features/token-form";

export const dynamic = "force-dynamic";

/**
 * Ordered by what people come here to do.
 *
 * Connecting an agent is the reason this page exists, so it is the first thing
 * under the identity card rather than the last panel on a long scroll. The
 * profile forms are maintenance and sit below. Deleting the account is last,
 * behind a disclosure and in the colour the log uses for things that went
 * wrong — it should not sit open next to "save".
 */
export default async function AccountPage() {
  const user = await requireUser();
  const { t } = await getT();
  const tokens = await listApiTokens(user.id);

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
        {/* The header drops sign-out on a phone -- there is no room for it
            beside the wordmark -- so this is the only way out on the device
            most likely to be signed in. */}
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
          {/* `flex-1` alone means a basis of zero, so this box would rather
              squeeze to one word per line than let the row wrap. A real minimum
              is what makes the wrap happen. */}
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

        {tokens.length > 0 && (
          <div className="mt-5 border-t border-dashed border-rule pt-4">
            <ul className="space-y-2">
              {tokens.map((tok) => (
                <li
                  key={tok.id}
                  className="sticker-flat group flex flex-wrap items-center gap-2 p-2.5"
                >
                  <span className="display text-[14.5px] font-bold">{tok.name}</span>
                  <Chip color={tok.last_used_at ? "var(--ok)" : undefined}>
                    {tok.last_used_at
                      ? `${t("lastUsed")} ${ago(tok.last_used_at, t)}`
                      : t("neverUsed")}
                  </Chip>
                  <span className="mono ml-auto text-[11px] text-faint">
                    {ago(tok.created_at, t)}
                  </span>
                  <form action={revokeTokenAction}>
                    <input type="hidden" name="token_id" value={tok.id} />
                    <SubmitButton
                      className="link-more row-action !text-[12px]"
                      pendingLabel={t("working")}
                    >
                      {t("revoke")}
                      <span className="sr-only"> — {tok.name}</span>
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>

            <p className="mt-3 mb-2 text-[13.5px] text-muted">{t("revokeAllNote")}</p>
            <form action={revokeAllTokensAction}>
              <SubmitButton className="link-more !text-[13px]" pendingLabel={t("working")}>
                {t("revokeAll")}
              </SubmitButton>
            </form>
          </div>
        )}
        {tokens.length === 0 && (
          <div className="mt-4">
            <Empty>{t("noTokens")}</Empty>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel delay={70} title={t("profile")}>
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
        </Panel>

        <Panel delay={90} title={t("changeEmail")}>
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
        </Panel>

        {/* Full width on its own row: the two above are short and this one is
            not, so leaving it in a column strands an empty half-screen. */}
        <Panel delay={110} title={t("changePassword")} className="lg:col-span-2">
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
        </Panel>
      </div>

      {/* Closed by default and marked in the colour of a dead end. It is gated
          on both the password and the username: the password is the credential,
          the username is there so this cannot happen by reflex. Everything
          cascades from the user row. */}
      <details
        className="pop sticker overflow-hidden"
        style={{ animationDelay: "130ms", borderColor: "var(--k-dead_end)" }}
      >
        <summary className="display flex cursor-pointer items-center gap-2 px-4 py-3 text-[16px] font-bold">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 shrink-0 rounded-full border-[1.5px]"
            style={{ background: "var(--k-dead_end)", borderColor: "var(--edge-dark)" }}
          />
          {t("deleteAccount")}
        </summary>
        <div className="border-t border-dashed border-rule p-4">
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
