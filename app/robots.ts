import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/public-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/s/",
          "/p/",
          "/account",
          "/report",
          "/search",
          "/login",
          "/register",
          "/forgot",
          "/reset",
          "/verify",
          "/invite",
        ],
        // Static, indexable, and worth crawling.
        // Auth pages above are noindex + disallowed so they never appear in
        // search results; about/contact/privacy stay open on purpose.
      },
    ],
    sitemap: `${publicUrl()}/sitemap.xml`,
    host: publicUrl(),
  };
}
