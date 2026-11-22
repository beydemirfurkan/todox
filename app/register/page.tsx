import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { registerAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";
import { OAuthButtons } from "../features/oauth-buttons";
import { enabledProviders } from "@/lib/services/oauth-providers";
import { isRegistrationOpen } from "@/lib/services/registration";

import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitleRegister") },
    description: t("metaDescriptionRegister"),
    alternates: { canonical: "/register" },
    robots: { index: false, follow: false },
    openGraph: pageOpenGraph("/register"),
  };
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const next = first((await searchParams).next);
  const safeNext = /^\/invite\?token=[A-Za-z0-9_-]{32,}$/.test(next) ? next : "";
  if (await currentUser()) redirect(safeNext || "/");
  const { t } = await getT();

  if (!isRegistrationOpen()) {
    return (
      <AuthShell
        title={t("registerTitle")}
        intro={t("err_registrationClosed")}
        footer={
          <Link href="/login" className="link-more">
            {t("haveAccount")}
          </Link>
        }
      />
    );
  }

  return (
    <AuthShell
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
      <OAuthButtons providers={enabledProviders()} next={safeNext || undefined} t={t} />
      <AuthForm
          submitClassName="btn w-full"
        action={registerAction}
        submitLabel={t("signUp")}
        pendingLabel={t("signingUp")}
       messages={authMessages(t)}
       hidden={safeNext ? { next: safeNext } : undefined}
        fields={[
          {
            name: "name",
            label: t("displayName"),
            autoComplete: "name",
            autoFocus: true,
            enterKeyHint: "next",
          },
          {
            name: "username",
            label: t("username"),
            autoComplete: "username",
            enterKeyHint: "next",
          },
          {
            name: "email",
            label: t("email"),
            type: "email",
            autoComplete: "email",
            enterKeyHint: "next",
          },
          {
            name: "password",
            label: t("password"),
            type: "password",
            autoComplete: "new-password",
            enterKeyHint: "done",
          },
        ]}
      />
    </AuthShell>
  );
}
