import { ago } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { listApiTokens } from "@/lib/services/auth";
import { requireUser } from "@/lib/session";
import {
  changePasswordAction,
  createTokenAction,
  resendVerificationAction,
  revokeTokenAction,
  updateProfileAction,
} from "../auth-actions";
import { Blob, Chip, Counter, Empty, Field, Panel } from "../components";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { CopyMarkdown } from "../features/copy-markdown";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const { t } = await getT();
  const sp = await searchParams;
  const created = Array.isArray(sp.created) ? sp.created[0] : sp.created;
  const tokens = await listApiTokens(user.id);

  const mcpCommand = created
    ? `claude mcp add todox --env TODOX_TOKEN=${created} --env TODOX_URL=${process.env.TODOX_PUBLIC_URL ?? "http://localhost:3000"} -- pnpm -C ${process.cwd()} exec tsx mcp/server.ts`
    : null;

  return (
    <div className="space-y-6">
      <div className="pop flex items-center gap-3">
        <Blob mood="happy" size={48} />
        <div>
          <h1 className="display text-[30px] leading-tight font-bold">
            {t("accountTitle")}
          </h1>
          <p className="mono flex flex-wrap items-center gap-2 text-[13px] text-muted">
            @{user.username} · {user.email}
            {user.email_verified_at && (
              <Chip color="var(--ok)">{t("verifyVerified")}</Chip>
            )}
          </p>
        </div>
      </div>

      {!user.email_verified_at && (
        <div
          role="status"
          className="on-fill sticker pop flex flex-wrap items-center gap-3 p-4"
          style={{ background: "var(--k-question)" }}
        >
          <Blob mood="worried" size={40} fill="var(--paper)" stroke="var(--ink)" />
          <div className="min-w-0 flex-1">
            <p className="display text-[15px] font-bold">{t("verifyPending")}</p>
            <p className="text-[13.5px]">{t("verifyPendingNote")}</p>
          </div>
          <form action={resendVerificationAction}>
            <button className="btn btn-quiet">{t("verifyResend")}</button>
          </form>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel delay={40} title={t("profile")}>
          <form action={updateProfileAction} className="space-y-3">
            <Field label={t("displayName")} hidden={false}>
              <input name="name" defaultValue={user.name} autoComplete="name" />
            </Field>
            <Field label={t("email")} hidden={false}>
              <input
                name="email"
                type="email"
                defaultValue={user.email}
                autoComplete="email"
              />
            </Field>
            <button className="btn btn-quiet">{t("save")}</button>
          </form>
        </Panel>

        <Panel delay={80} title={t("changePassword")}>
          <p className="mb-3 text-[13.5px] text-muted">{t("changePasswordNote")}</p>
          <AuthForm
            action={changePasswordAction}
            submitLabel={t("changePassword")}
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

        {created && mcpCommand && (
          <div
            className="sticker-flat mb-4 space-y-2 p-3"
            style={{ borderColor: "var(--accent)" }}
          >
            <p className="display text-[14px] font-bold">{t("tokenOnce")}</p>
            <pre className="mono overflow-x-auto rounded-[8px] border-[1.5px] border-line bg-paper p-2.5 text-[12px] break-all whitespace-pre-wrap">
              {mcpCommand}
            </pre>
            <CopyMarkdown
              markdown={mcpCommand}
              label={t("shareCopy")}
              copiedLabel={t("shareCopied")}
            />
          </div>
        )}

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
                <button className="link-more row-action !text-[12px]">
                  {t("revoke")}
                  <span className="sr-only"> — {tok.name}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>

        <form action={createTokenAction} className="mt-4 flex flex-wrap items-end gap-2">
          <Field label={t("tokenName")} className="min-w-48 flex-1">
            <input name="name" placeholder={t("tokenName")} />
          </Field>
          <button className="btn">{t("createToken")}</button>
        </form>
      </Panel>
    </div>
  );
}
