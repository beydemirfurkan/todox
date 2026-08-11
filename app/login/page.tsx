import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { loginAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = first((await searchParams).next);
  const safeNext = /^\/invite\?token=[A-Za-z0-9_-]{32,}$/.test(next) ? next : "";
  if (await currentUser()) redirect(safeNext || "/");
  const { t } = await getT();

  return (
    <AuthShell
      mood="happy"
      title={t("loginTitle")}
      intro={t("loginIntro")}
      footer={
        <>
          <Link href="/forgot" className="link-more">
            {t("forgotLink")}
          </Link>
           <Link
             href={safeNext ? `/register?next=${encodeURIComponent(safeNext)}` : "/register"}
             className="link-more"
           >
            {t("noAccount")}
          </Link>
        </>
      }
    >
      <AuthForm
        action={loginAction}
        submitLabel={t("signIn")}
        pendingLabel={t("signingIn")}
       messages={authMessages(t)}
       hidden={safeNext ? { next: safeNext } : undefined}
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
    </AuthShell>
  );
}
