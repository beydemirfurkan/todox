import type { Metadata } from "next";

import { OrganizationJsonLd } from "../components/organization-json-ld";
import { getT } from "@/lib/lang";
import { publicUrl } from "@/lib/public-url";
import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitleAbout") },
    description: t("metaDescriptionAbout"),
    alternates: { canonical: "/about" },
    openGraph: pageOpenGraph("/about"),
  };
}

export default async function AboutPage() {
  const { t } = await getT();
  const base = publicUrl();
  return (
    <article className="prose pop max-w-[60ch]">
      <OrganizationJsonLd />
      <h1 className="display text-[28px] font-bold">{t("metaTitleAbout")}</h1>

      <p className="mt-4 text-[15.5px] leading-relaxed">
        {t("heroBody")}
      </p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("whatItIs")}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-[15px] leading-relaxed">
        <li>{t("whatItIs1")}</li>
        <li>{t("whatItIs2")}</li>
        <li>{t("whatItIs3")}</li>
        <li>{t("whatItIs4")}</li>
      </ul>

      <h2 className="display mt-8 text-[20px] font-bold">{t("whatItIsNot")}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-[15px] leading-relaxed">
        <li>{t("whatItIsNot1")}</li>
        <li>{t("whatItIsNot2")}</li>
        <li>{t("whatItIsNot3")}</li>
      </ul>

      <h2 className="display mt-8 text-[20px] font-bold">{t("builtBy")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">
        {t("builtByBody")}
      </p>

      <p className="mt-8 text-[14px] text-faint">
        <a href={`${base}/llms.txt`} className="link-more">{t("forAgents")}</a>
      </p>
    </article>
  );
}
