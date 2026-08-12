import type { NextConfig } from "next";

/**
 * Headers we want every production response to carry. The list is built once
 * and the matcher decides which routes see it; the API and `_next` routes are
 * excluded on purpose, because the API does not render HTML (so frame-options
 * and CSP have no effect there) and the static chunks already get their own
 * immutable cache headers.
 *
 * CSP is intentionally not set in development: the dev server uses `eval()`
 * for HMR and Vite-style on-the-fly module loading, and a strict CSP blocks
 * both. The production CSP below is the one we ship.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // Same-origin only: the MCP HTTP endpoint is a programmatic client surface
  // (bearer token, not a cookie), so we never expect a real browser to embed
  // it. `connect-src 'self'` is enough for any same-origin browser MCP client
  // that may exist. `frame-ancestors 'none'` mirrors X-Frame-Options for
  // browsers that have retired the older header. `form-action 'self'` keeps
  // the auth forms from being submitted to an attacker-controlled URL.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inlines a small boot script and the RSC payload; both carry
      // their own nonces at runtime, so `'self'` covers them. `'unsafe-eval'`
      // is left out — production never needs it.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        // HTML pages and anything else that is not a Next.js internal or an
        // API route. The MCP endpoint lives at /api/mcp and is excluded.
        source: "/((?!api/|_next/|favicon.ico|icon.svg|opengraph-image.png).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
