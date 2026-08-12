import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { requestResetAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { AuthForm } from "../features/auth-form";
import { AuthShell } from "../features/auth-shell";
import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitleForgot") },
    description: t("metaDescriptionForgot"),
    alternates: { canonical: "/forgot" },
    robots: { index: false, follow: false },
    openGraph: pageOpenGraph("/forgot"),
  };
}

export default async function ForgotPage({ searchParams }: PageProps<"/forgot">) {
  if (await currentUser()) redirect("/");
  const { t } = await getT();
  const sent = (await searchParams).sent === "1";

  return (
    <AuthShell
      mood={sent ? "happy" : "worried"}
      fill={sent ? "var(--ok)" : "var(--accent)"}
      title={t("forgotTitle")}
      intro={sent ? undefined : t("forgotIntro")}
      footer={
        <Link href="/login" className="link-more">
          {t("backToLogin")}
        </Link>
      }
    >
      {sent ? (
        <>
          {/* Deliberately identical whether or not the address exists. */}
          <p role="status" className="text-[15px]">
            {t("forgotSent")}
          </p>
          <p className="mt-1.5 text-[13.5px] text-muted">{t("forgotSentNote")}</p>
        </>
      ) : (
        <AuthForm
          action={requestResetAction}
          submitLabel={t("forgotSend")}
          pendingLabel={t("sendingLink")}
          messages={authMessages(t)}
          fields={[
            {
              name: "email",
              label: t("email"),
              type: "email",
              autoComplete: "email",
              autoFocus: true,
              enterKeyHint: "done",
            },
          ]}
        />
      )}
    </AuthShell>
  );
}
