import Link from "next/link";

import { getT } from "@/lib/lang";
import { resetPasswordAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { Blob, Panel } from "../components";
import { AuthForm } from "../features/auth-form";

export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: PageProps<"/reset">) {
  const { t } = await getT();
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <div className="pop flex items-center gap-3">
        <Blob mood="idle" size={52} fill="var(--k-handoff)" className="bob" />
        <div>
          <h1 className="display text-[28px] leading-tight font-bold">
            {t("resetTitle")}
          </h1>
          <p className="text-[14px] text-muted">{t("resetIntro")}</p>
        </div>
      </div>

      <Panel delay={60}>
        {token ? (
          <AuthForm
            action={resetPasswordAction}
            submitLabel={t("resetSubmit")}
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
      </Panel>

      <p className="text-center">
        <Link href="/forgot" className="link-more">
          {t("forgotTitle")}
        </Link>
      </p>
    </div>
  );
}
