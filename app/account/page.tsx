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

export default async function AccountPage() {
  const user = await requireUser();
  const { t } = await getT();
  const tokens = await listApiTokens(user.id);

  return (
    <div className="space-y-6">
      <div className="pop flex items-center gap-3">
        <Blob mood="happy" size={48} />
        <div>
          <h1 className="display text-[30px] leading-tight font-bold">
            {t("accountTitle")}
          </h1>
          <p className="mono flex flex-wrap items-center gap-2 text-[13px] break-all text-muted">
            @{user.username} · {user.email}
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

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel delay={40} title={t("profile")}>
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

        <Panel delay={60} title={t("changeEmail")}>
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

        <Panel delay={80} title={t("changePassword")}>
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

      <Panel
        delay={120}
        title={t("apiTokens")}
        right={<Counter n={tokens.length} label={t("apiTokens")} />}
      >
        <p className="mb-3 text-[14px] text-muted">{t("apiTokensIntro")}</p>

        <ul className="space-y-2">
          {tokens.length === 0 && <Empty>{t("noTokens")}</Empty>}
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
            agentLabel: t("setupAgentLabel"),
            other: t("setupAgentOther"),
            verify: t("setupVerify"),
            copy: t("copySnippet"),
            copied: t("shareCopied"),
          }}
        />

        {tokens.length > 0 && (
          <div className="mt-4 border-t border-dashed border-rule pt-3">
            <p className="mb-2 text-[13.5px] text-muted">{t("revokeAllNote")}</p>
            <form action={revokeAllTokensAction}>
              <SubmitButton className="link-more !text-[13px]" pendingLabel={t("working")}>
                {t("revokeAll")}
              </SubmitButton>
            </form>
          </div>
        )}
      </Panel>

      {/* Last on the page, and gated on both the password and the username: the
          password is the credential, the username is there so this cannot
          happen by reflex. Everything cascades from the user row. */}
      <Panel delay={140} title={t("deleteAccount")}>
        <p className="mb-3 text-[14px] text-muted">{t("deleteAccountNote")}</p>
        <AuthForm
          action={deleteAccountAction}
          submitLabel={t("deleteAccountSubmit")}
          pendingLabel={t("working")}
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
      </Panel>
    </div>
  );
}
