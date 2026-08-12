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
