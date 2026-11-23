import { publicUrl } from "../public-url";
import { baseForHost } from "../services/oauth-rules";

/**
 * Which of this site's origins a request arrived on. Behind the proxy the
 * original host is in `x-forwarded-host`; `host` is the fallback for a
 * request that reached the app directly.
 */
export const siteBase = (headers: Headers): string =>
  baseForHost(publicUrl(), headers.get("x-forwarded-host") ?? headers.get("host"));
