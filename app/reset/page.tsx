import Link from "next/link";

import { getT } from "@/lib/lang";
import { resetPasswordAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: PageProps<"/reset">) {
  const { t } = await getT();
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  return (
    <AuthShell
      shyLabel={t("mascotShy")}
      mood="idle"
      fill="var(--k-handoff)"
      title={t("resetTitle")}
      intro={token ? t("resetIntro") : undefined}
      footer={
        <Link href="/forgot" className="link-more">
          {t("forgotTitle")}
        </Link>
      }
    >
      {token ? (
        <AuthForm
          action={resetPasswordAction}
          submitLabel={t("resetSubmit")}
          pendingLabel={t("saving")}
          messages={authMessages(t)}
          hidden={{ token }}
          fields={[
            {
              name: "password",
              label: t("newPassword"),
              type: "password",
              autoComplete: "new-password",
              autoFocus: true,
            },
          ]}
        />
      ) : (
        <p className="text-[15px]">{t("resetNoToken")}</p>
      )}
    </AuthShell>
  );
}
