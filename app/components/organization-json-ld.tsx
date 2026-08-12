import { headers } from "next/headers";

import { publicUrl } from "@/lib/public-url";

/**
 * Paths that set `robots: { index: false }` in their `generateMetadata`. JSON-LD
 * on these pages is a contradiction: a search engine is told not to index the
 * page, then handed structured data that says "here is a thing to index".
 * The `crawl/schema-noindex-conflict` rule flags it; we suppress the JSON-LD
 * for these routes instead.
 *
 * Public auth routes that are siblings of the matched prefix are also included
 * so a future page like `/login/2fa` does not silently start emitting schema.
 */
const NOINDEX_PREFIXES = [
  "/login",
  "/register",
  "/forgot",
  "/reset",
  "/verify",
  "/invite",
  "/s/",
  "/p/",
  "/account",
  "/report",
  "/search",
  "/api/",
];

/**
 * Two schemas, both top-level so search and AI crawlers see them on every
 * indexable page:
 *
 * - `Organization` identifies the project, its GitHub repo, and the maintainer.
 *   This is what feeds the E-E-A-T audit and what lets a knowledge panel show
 *   the right name and link.
 * - `WebSite` carries the publisher and language metadata. todox has internal
 *   search, but it requires a session, so no `SearchAction` target is exposed.
 *
 * The cookie that sets the language never reaches the server-rendered JSON-LD
 * output, so the schemas are written in English on purpose. Translations of
 * the same identifiers would not match the `url` / `name` fields other systems
 * already index.
 */
export async function OrganizationJsonLd() {
  const path = (await headers()).get("x-invoke-path") ?? "";
  if (NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(p))) return null;

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
