import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { loginAction } from "../auth-actions";
import { Blob, Panel } from "../components";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const { t } = await getT();

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <div className="pop flex items-center gap-3">
        <Blob mood="happy" size={52} className="bob" />
        <div>
          <h1 className="display text-[28px] leading-tight font-bold">
            {t("loginTitle")}
          </h1>
          <p className="text-[14px] text-muted">{t("loginIntro")}</p>
        </div>
      </div>

      <Panel delay={60}>
        <AuthForm
          action={loginAction}
          submitLabel={t("signIn")}
          messages={authMessages(t)}
          fields={[
            {
              name: "identifier",
              label: t("identifier"),
              autoComplete: "username",
              autoFocus: true,
            },
            {
              name: "password",
              label: t("password"),
              type: "password",
              autoComplete: "current-password",
            },
          ]}
        />
      </Panel>

      <div className="flex flex-col items-center gap-1.5">
        <Link href="/forgot" className="link-more">
          {t("forgotLink")}
        </Link>
        <Link href="/register" className="link-more">
          {t("noAccount")}
        </Link>
      </div>
    </div>
  );
}
