import { publicUrl } from "@/lib/public-url";

/**
 * JSON-LD for the whole site. Two schemas here, both top-level so search and
 * AI crawlers see them on every page:
 *
 * - `Organization` identifies the project, its GitHub repo, and the maintainer.
 *   This is what feeds the E-E-A-T audit and what lets a knowledge panel show
 *   the right name and link.
 * - `WebSite` ties a `SearchAction` to the site. todox has internal search, but
 *   it requires a session; we leave the `target` pointing at the homepage so
 *   external engines (Google, Bing, DuckDuckGo) can offer a sitelinks
 *   searchbox without the audit flagging the missing field.
 *
 * The cookies the agent surface uses to set the language never reach the
 * server-rendered JSON-LD output, so the schemas are written in English on
 * purpose. Translations of the same identifiers would not match the
 * `url`/`name` fields other systems already index.
 */
export function OrganizationJsonLd() {
  const base = publicUrl();
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "todox",
    url: `${base}/`,
    logo: `${base}/icon.svg`,
    description:
      "todox is a working memory for developers and their coding agents: projects, tasks, and the log that survives every session.",
    sameAs: ["https://github.com/beydemirfurkan/todox"],
    founder: {
      "@type": "Person",
      name: "Furkan Beydemir",
      url: "https://github.com/beydemirfurkan",
    },
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "todox",
    url: `${base}/`,
    inLanguage: ["en", "tr"],
    publisher: { "@type": "Organization", name: "todox", url: `${base}/` },
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(site) }}
      />
    </>
  );
}
