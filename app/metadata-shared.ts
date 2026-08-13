import type { Metadata } from "next";

/**
 * OpenGraph defaults shared across pages. The root layout sets these; per-page
 * `generateMetadata` overrides `url` so the social preview links to the right
 * page. Next.js shallow-merges the openGraph object, which is why this helper
 * exists: without it, a page that wrote `openGraph: { url: "/about" }` would
 * silently drop the `images` from the layout — and the social preview would
 * render without a card.
 */
export const defaultOpenGraphImage = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: "todox",
};

export function pageOpenGraph(path: string) {
  return {
    url: path,
    images: [defaultOpenGraphImage],
  };
}

/**
 * A page you have to be signed in to see.
 *
 * The `noindex` is what `NOINDEX_PREFIXES` in `organization-json-ld.tsx`
 * already assumed these pages sent — it suppresses the JSON-LD for them on the
 * grounds that they set it, and until now none of them did.
 *
 * The title matters more than it looks. Every signed-in page inherited the
 * landing page's tagline, so a row of open tabs — three projects, a report and
 * the account page — all read "todox — working memory for developers and their
 * agents" and none could be told from another.
 *
 * No description: a page search engines are told to skip has nobody to
 * describe it to.
 */
export function privatePageMetadata(title: string): Metadata {
  return {
    title: { absolute: title },
    robots: { index: false, follow: false },
  };
}
