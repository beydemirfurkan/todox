import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/public-url";

/**
 * Public, indexable routes. Auth, account, project and report pages are gated
 * behind the session cookie and either return a 404 for somebody who is not
 * signed in or render content that depends on the viewer, so listing them
 * here would either bloat crawlers' queues or leak private URLs.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicUrl();
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: {
          en: `${base}/`,
          tr: `${base}/`,
          "x-default": `${base}/`,
        },
      },
    },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];
}
