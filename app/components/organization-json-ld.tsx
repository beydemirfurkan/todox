import { publicUrl } from "@/lib/public-url";

/**
 * Two schemas, for the pages a crawler is allowed to index.
 *
 * Rendered by those pages themselves rather than by the root layout. It used to
 * sit in the layout and suppress itself on a list of noindex prefixes, read
 * from an `x-invoke-path` header — which nothing sets. There is no middleware
 * here and the config adds only security headers, so the path was always the
 * empty string, the list never matched, and the schema went out on `/login`,
 * `/account`, every project page and every share link: exactly the
 * `schema-noindex-conflict` the suppression existed to avoid.
 *
 * A page saying what it is beats a component guessing where it is. It also
 * leaves one list instead of two: `app/sitemap.ts` names the indexable routes,
 * and those are the routes that import this. `organization-json-ld.test.ts`
 * holds the two to each other, because a new public page that quietly does or
 * does not emit schema is not visible in review.
 *
 * The schemas:
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
