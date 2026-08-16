import type { Metadata } from "next";

import { OrganizationJsonLd } from "../components/organization-json-ld";
import { getT } from "@/lib/lang";
import { pageOpenGraph } from "../metadata-shared";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: { absolute: t("metaTitleContact") },
    description: t("metaDescriptionContact"),
    alternates: { canonical: "/contact" },
    openGraph: pageOpenGraph("/contact"),
  };
}

export default async function ContactPage() {
  const { t } = await getT();
  return (
    <article className="prose pop max-w-[60ch]">
      <OrganizationJsonLd />
      <h1 className="display text-[28px] font-bold">{t("metaTitleContact")}</h1>

      <p className="mt-4 text-[15.5px] leading-relaxed">{t("contactIntro")}</p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("contactBugs")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">
        {t("contactBugsBody")}{" "}
        <a
          href="https://github.com/beydemirfurkan/todox/issues"
          className="link-more"
          rel="noreferrer"
        >
          github.com/beydemirfurkan/todox/issues
        </a>
        .
      </p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("contactSecurity")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">{t("contactSecurityBody")}</p>

      <h2 className="display mt-8 text-[20px] font-bold">{t("contactCode")}</h2>
      <p className="mt-2 text-[15.5px] leading-relaxed">
        {t("contactCodeBody")}{" "}
        <a
          href="https://github.com/beydemirfurkan/todox"
          className="link-more"
          rel="noreferrer"
        >
          github.com/beydemirfurkan/todox
        </a>
        .
      </p>
    </article>
  );
}
