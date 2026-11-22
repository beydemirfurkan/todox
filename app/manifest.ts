import type { MetadataRoute } from "next";

/**
 * Lets a phone keep todox on its home screen and open it without browser
 * chrome, which is what the tab bar at the bottom is designed for. English
 * only: the manifest is fetched without the language cookie on some
 * platforms, and a name is a name.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "todox",
    short_name: "todox",
    description: "Working memory for a developer and their coding agents.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
