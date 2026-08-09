import Link from "next/link";

import { getT } from "@/lib/lang";
import { completeVerification } from "@/lib/services/account-recovery";
import { AuthShell } from "../features/auth-shell";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const { t } = await getT();
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const ok = token ? await completeVerification(token) : false;

  return (
    <AuthShell
      mood={ok ? "happy" : "worried"}
      fill={ok ? "var(--ok)" : "var(--k-dead_end)"}
      title={ok ? t("verifyTitle") : t("verifyFailedTitle")}
    >
      <p className="text-[15px]">{ok ? t("verifyOk") : t("verifyFailed")}</p>
      <Link href={ok ? "/" : "/login"} className="btn mt-4 inline-block">
        {ok ? t("continueToApp") : t("signIn")}
      </Link>
    </AuthShell>
  );
}
