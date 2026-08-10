import Link from "next/link";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { verifyEmailAction } from "../auth-actions";
import { AuthShell } from "../features/auth-shell";
import { SubmitButton } from "../features/submit";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Three states, and none of them consumes the token by being looked at.
 *
 * Verifying used to happen during this render, which made the link a GET that
 * changed state -- so a mail scanner following it on the recipient's behalf
 * spent the token, and the person who clicked afterwards was told their link
 * was invalid with nothing on the page to do about it.
 */
export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const { t } = await getT();
  const sp = await searchParams;
  const token = first(sp.token);
  const state = first(sp.state);

  if (state === "ok")
    return (
      <AuthShell mood="happy" fill="var(--ok)" title={t("verifyTitle")}>
        <p className="text-[15px]">{t("verifyOk")}</p>
        <Link href="/" className="btn mt-4 inline-block">
          {t("continueToApp")}
        </Link>
      </AuthShell>
    );

  if (state === "failed" || !token) {
    const user = await currentUser();
    return (
      <AuthShell
        mood="worried"
        fill="var(--k-dead_end)"
        title={t("verifyFailedTitle")}
        intro={t("verifyFailed")}
      >
        {/* A dead end with a way out of it: resending needs an account, so
            somebody signed out is sent to sign in first. */}
        <Link href={user ? "/account" : "/login"} className="btn block text-center">
          {user ? t("verifyResend") : t("signIn")}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      mood="idle"
      title={t("verifyConfirmTitle")}
      intro={t("verifyConfirmBody")}
    >
      <form action={verifyEmailAction}>
        <input type="hidden" name="token" value={token} />
        <SubmitButton className="btn w-full" pendingLabel={t("working")}>
          {t("verifyConfirmCta")}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
