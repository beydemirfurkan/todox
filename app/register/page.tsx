import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { registerAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const next = first((await searchParams).next);
  const safeNext = /^\/invite\?token=[A-Za-z0-9_-]{32,}$/.test(next) ? next : "";
  if (await currentUser()) redirect(safeNext || "/");
  const { t } = await getT();

  return (
    <AuthShell
      mood="idle"
      fill="var(--k-handoff)"
      title={t("registerTitle")}
      intro={t("registerIntro")}
      footer={
         <Link
           href={safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login"}
           className="link-more"
         >
          {t("haveAccount")}
        </Link>
      }
    >
      <AuthForm
        action={registerAction}
        submitLabel={t("signUp")}
        pendingLabel={t("signingUp")}
       messages={authMessages(t)}
       hidden={safeNext ? { next: safeNext } : undefined}
        fields={[
          { name: "name", label: t("displayName"), autoComplete: "name", autoFocus: true },
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
    </AuthShell>
  );
}
