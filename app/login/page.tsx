import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import type { T } from "@/lib/i18n";
import { isRegistrationOpen } from "@/lib/services/registration";
import { inviteTokenFromNext } from "@/lib/services/oauth-flow";
import { currentUser } from "@/lib/session";
import { loginAction } from "../auth-actions";
import { authMessages, isAuthCode } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";
import { OAuthButtons } from "../features/oauth-buttons";
import { enabledProviders } from "@/lib/services/oauth-providers";

import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitleLogin") },
    description: t("metaDescriptionLogin"),
    alternates: { canonical: "/login" },
    robots: { index: false, follow: false },
    openGraph: pageOpenGraph("/login"),
  };
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * With a provider configured, new sign-ins go through it and the password
 * form sits one link away (`?legacy=1`) for accounts that still have to
 * connect one. With none configured -- a self-host that never set up Google
 * or GitHub -- the password form is the page.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const asked = await searchParams;
  const next = first(asked.next);
  const errorCode = first(asked.error);
  const inviteNext = inviteTokenFromNext(next) ? next : "";
  if (await currentUser()) redirect(inviteNext || "/");
  const { t } = await getT();
  const providers = enabledProviders();
  const isPasswordOnly = providers.length === 0;
  const isLegacy = !isPasswordOnly && first(asked.legacy) === "1";
  const nextQuery = inviteNext ? `?next=${encodeURIComponent(inviteNext)}` : "";
  const login = `/login${nextQuery}`;
  const legacy = `${login}${nextQuery ? "&" : "?"}legacy=1`;
  const canRegister = isRegistrationOpen() || inviteNext !== "";

  return (
    <AuthShell
      title={t(isLegacy ? "legacySignIn" : "loginTitle")}
      intro={t(isLegacy ? "legacySignInIntro" : canRegister ? "loginIntro" : "loginIntroClosed")}
      footer={
        isPasswordOnly ? (
          <>
            <Link href="/forgot" className="link-more">{t("forgotLink")}</Link>
            {canRegister && <Link href={`/register${nextQuery}`} className="link-more">{t("noAccount")}</Link>}
          </>
        ) : isLegacy ? (
          <>
            <Link href={login} className="link-more">{t("oauthSignIn")}</Link>
            <Link href="/forgot" className="link-more">{t("forgotLink")}</Link>
          </>
        ) : (
          <Link href={legacy} className="link-more">{t("legacySignIn")}</Link>
        )
      }
    >
      {isAuthCode(errorCode) && (
        <p role="alert" className="mb-4 text-small text-[var(--k-dead_end)]">
          {authMessages(t)[errorCode]}
        </p>
      )}
      {isPasswordOnly || isLegacy ? (
        <PasswordSignIn next={inviteNext} t={t} />
      ) : (
        <OAuthButtons providers={providers} next={inviteNext || undefined} t={t} />
      )}
    </AuthShell>
  );
}

function PasswordSignIn({ next, t }: { next: string; t: T }): React.JSX.Element {
  return (
    <AuthForm
      submitClassName="btn w-full"
      action={loginAction}
      submitLabel={t("signIn")}
      pendingLabel={t("signingIn")}
      messages={authMessages(t)}
      hidden={next ? { next } : undefined}
      fields={[
        { name: "identifier", label: t("identifier"), autoComplete: "username", autoFocus: true, enterKeyHint: "next" },
        { name: "password", label: t("password"), type: "password", autoComplete: "current-password", enterKeyHint: "done" },
      ]}
    />
  );
}
