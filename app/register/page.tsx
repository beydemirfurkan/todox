import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import type { T } from "@/lib/i18n";
import { getT } from "@/lib/lang";
import { inviteTokenFromNext } from "@/lib/services/oauth-flow";
import { enabledProviders } from "@/lib/services/oauth-providers";
import { isRegistrationOpen } from "@/lib/services/registration";
import { currentUser } from "@/lib/session";
import { registerAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";
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

/**
 * Password registration exists only on an instance with no provider
 * configured -- a self-host that never set up Google or GitHub. Anywhere else
 * the provider creates the account, so this page hands over to sign-in.
 */
export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const next = first((await searchParams).next);
  const inviteNext = inviteTokenFromNext(next) ? next : "";
  const login = inviteNext ? `/login?next=${encodeURIComponent(inviteNext)}` : "/login";
  if (enabledProviders().length) redirect(login);
  if (await currentUser()) redirect(inviteNext || "/");
  const { t } = await getT();

  const footer = (
    <Link href={login} className="link-more">
      {t("haveAccount")}
    </Link>
  );
  if (!isRegistrationOpen() && !inviteNext)
    return <AuthShell title={t("registerTitle")} intro={t("err_registrationClosed")} footer={footer} />;

  return (
    <AuthShell title={t("registerTitle")} intro={t("registerIntro")} footer={footer}>
      <PasswordRegistration next={inviteNext} t={t} />
    </AuthShell>
  );
}

function PasswordRegistration({ next, t }: { next: string; t: T }): React.JSX.Element {
  return (
    <AuthForm
      submitClassName="btn w-full"
      action={registerAction}
      submitLabel={t("signUp")}
      pendingLabel={t("signingUp")}
      messages={authMessages(t)}
      hidden={next ? { next } : undefined}
      fields={[
        { name: "name", label: t("displayName"), autoComplete: "name", autoFocus: true, enterKeyHint: "next" },
        { name: "username", label: t("username"), autoComplete: "username", enterKeyHint: "next" },
        { name: "email", label: t("email"), type: "email", autoComplete: "email", enterKeyHint: "next" },
        { name: "password", label: t("password"), type: "password", autoComplete: "new-password", enterKeyHint: "done" },
      ]}
    />
  );
}
