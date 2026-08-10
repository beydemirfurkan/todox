import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { registerAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  const { t } = await getT();

  return (
    <AuthShell
      mood="idle"
      fill="var(--k-handoff)"
      title={t("registerTitle")}
      intro={t("registerIntro")}
      footer={
        <Link href="/login" className="link-more">
          {t("haveAccount")}
        </Link>
      }
    >
      <AuthForm
        action={registerAction}
        submitLabel={t("signUp")}
        pendingLabel={t("signingUp")}
        messages={authMessages(t)}
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
