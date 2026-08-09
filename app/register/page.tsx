import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { registerAction } from "../auth-actions";
import { Blob, Panel } from "../components";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  const { t } = await getT();

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <div className="pop flex items-center gap-3">
        <Blob mood="idle" size={52} fill="var(--k-handoff)" className="bob" />
        <div>
          <h1 className="display text-[28px] leading-tight font-bold">
            {t("registerTitle")}
          </h1>
          <p className="text-[14px] text-muted">{t("registerIntro")}</p>
        </div>
      </div>

      <Panel delay={60}>
        <AuthForm
          action={registerAction}
          submitLabel={t("signUp")}
          messages={authMessages(t)}
          fields={[
            {
              name: "name",
              label: t("displayName"),
              autoComplete: "name",
              autoFocus: true,
            },
            { name: "username", label: t("username"), autoComplete: "username" },
            { name: "email", label: t("email"), type: "email", autoComplete: "email" },
            {
              name: "password",
              label: t("password"),
              type: "password",
              autoComplete: "new-password",
            },
          ]}
        />
      </Panel>

      <p className="text-center">
        <Link href="/login" className="link-more">
          {t("haveAccount")}
        </Link>
      </p>
    </div>
  );
}
