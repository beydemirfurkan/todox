import Link from "next/link";

import { getT } from "@/lib/lang";
import { completeVerification } from "@/lib/services/account-recovery";
import { Blob, Panel } from "../components";

export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const { t } = await getT();
  const raw = (await searchParams).token;
  const token = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const ok = token ? await completeVerification(token) : false;

  return (
    <div className="mx-auto max-w-md space-y-5 pt-6">
      <div className="pop flex items-center gap-3">
        <Blob
          mood={ok ? "happy" : "worried"}
          size={52}
          fill={ok ? "var(--ok)" : "var(--k-dead_end)"}
          className="bob"
        />
        <h1 className="display text-[28px] leading-tight font-bold">
          {ok ? t("verifyTitle") : t("verifyFailedTitle")}
        </h1>
      </div>

      <Panel delay={60}>
        <p className="text-[15px]">{ok ? t("verifyOk") : t("verifyFailed")}</p>
        <Link href={ok ? "/" : "/login"} className="btn mt-4 inline-block">
          {ok ? t("continueToApp") : t("signIn")}
        </Link>
      </Panel>
    </div>
  );
}
