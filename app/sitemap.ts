import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/public-url";

/**
 * Public, indexable routes. Auth, account, project and report pages are gated
 * behind the session cookie and either return a 404 for somebody who is not
 * signed in or render content that depends on the viewer, so listing them
 * here would either bloat crawlers' queues or leak private URLs.
 */
/**
 * No `alternates`, and no `lastModified`. Both were saying something untrue.
 *
 * The hreflang block named `en`, `tr` and `x-default` and pointed all three at
 * the same URL. hreflang exists to tell a crawler which *address* serves which
 * language, and there is only one address here: the language is negotiated per
 * request from `Accept-Language`, and `?lang=` redirects to the clean URL
 * rather than serving under it, deliberately, so that one page does not become
 * two. Three alternates for one URL is not a weaker signal than none; it is a
 * malformed one.
 *
 * `lastModified` was `new Date()`, so every crawl was told every page had just
 * changed. An absent timestamp is a crawler working from its own judgement; a
 * always-now timestamp is a claim, and a false one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
