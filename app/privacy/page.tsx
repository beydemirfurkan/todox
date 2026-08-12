import type { Metadata } from "next";

import { getT } from "@/lib/lang";
import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitlePrivacy") },
    description: t("metaDescriptionPrivacy"),
    alternates: { canonical: "/privacy" },
    openGraph: pageOpenGraph("/privacy"),
  };
}

export default async function PrivacyPage() {
  const { t } = await getT();
  return (
    <article className="prose pop max-w-[60ch]">
      <h1 className="display text-[28px] font-bold">{t("metaTitlePrivacy")}</h1>

      <p className="mt-4 text-[14.5px] text-faint">{t("privacyLastUpdated")}</p>

      <h2 className="display mt-6 text-[20px] font-bold">{t("privacyWhatWeStore")}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-[15px] leading-relaxed">
        <li>{t("privacyStore1")}</li>
        <li>{t("privacyStore2")}</li>
        <li>{t("privacyStore3")}</li>
        <li>{t("privacyStore4")}</li>
      </ul>

      <h2 className="display mt-8 text-[20px] font-bold">{t("privacyWhatWeDoNot")}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-[15px] leading-relaxed">
        <li>{t("privacyDoNot1")}</li>
        <li>{t("privacyDoNot2")}</li>
        <li>{t("privacyDoNot3")}</li>
      </ul>

      <h2 className="display mt-8 text-[20px] font-bold">{t("privacySubprocessors")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">{t("privacySubprocessorsBody")}</p>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-[15px] leading-relaxed">
        <li>{t("privacySub1")}</li>
        <li>{t("privacySub2")}</li>
        <li>{t("privacySub3")}</li>
      </ul>

      <h2 className="display mt-8 text-[20px] font-bold">{t("privacyRetention")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">{t("privacyRetentionBody")}</p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("privacyYourRights")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">{t("privacyYourRightsBody")}</p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("privacyChanges")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">{t("privacyChangesBody")}</p>
    </article>
  );
}
