import Link from "next/link";
import { redirect } from "next/navigation";

import { getT } from "@/lib/lang";
import { currentUser } from "@/lib/session";
import { requestResetAction } from "../auth-actions";
import { authMessages } from "../auth-messages";
import { Blob, Panel } from "../components";
import { AuthForm } from "../features/auth-form";

export const dynamic = "force-dynamic";

export default async function ForgotPage({ searchParams }: PageProps<"/forgot">) {
  if (await currentUser()) redirect("/");
  const { t } = await getT();
  const sent = (await searchParams).sent === "1";

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <div className="pop flex items-center gap-3">
        <Blob mood={sent ? "happy" : "worried"} size={52} className="bob" />
        <div>
          <h1 className="display text-[28px] leading-tight font-bold">
            {t("forgotTitle")}
          </h1>
          <p className="text-[14px] text-muted">{t("forgotIntro")}</p>
        </div>
      </div>

      {sent ? (
        <Panel delay={60}>
          {/* Deliberately identical whether or not the address exists. */}
          <p role="status" className="text-[15px]">
            {t("forgotSent")}
          </p>
          <p className="mt-1 text-[13.5px] text-muted">{t("forgotSentNote")}</p>
        </Panel>
      ) : (
        <Panel delay={60}>
          <AuthForm
            action={requestResetAction}
            submitLabel={t("forgotSend")}
            messages={authMessages(t)}
            fields={[
              {
                name: "email",
                label: t("email"),
                type: "email",
                autoComplete: "email",
                autoFocus: true,
              },
            ]}
          />
        </Panel>
      )}

      <p className="text-center">
        <Link href="/login" className="link-more">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
