import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "./lib/cookies";

/**
 * UX only. The proxy cannot reach the database, so it can tell you that a
 * cookie is absent but never that one is valid -- the real check lives in
 * `requireUser()` at the data boundary. Treating this as the gate would be a
 * bug waiting to happen.
 */
const PUBLIC = [
  "/login",
  "/register",
  "/forgot",
  "/reset",
  "/verify",
  "/invite",
  "/s/",
  // Both agent surfaces carry their own bearer token and have no session
  // cookie. Leave either out and the redirect below turns every agent call
  // into an HTML login page, which reads to a client as a broken server
  // rather than as a refusal.
  "/api/rpc",
  "/api/mcp",
  // The container's own liveness check, which has no cookie and never will.
  // Redirected, it answers 307 to a runtime that only asked whether this
  // process can serve anything -- and a redirect is a perfectly healthy
  // answer, so the container would stay up with its database unreachable.
  "/api/health",
  // Metadata files. Redirecting these to /login silently breaks the favicon
  // and every social link preview, which is the sort of thing nobody notices
  // until somebody pastes the URL into Slack.
  "/icon.svg",
  "/opengraph-image.png",
  "/robots.txt",
  "/sitemap.xml",
  "/llms.txt",
];

/**
 * Paths that are public and have no children.
 *
 * Kept apart from `PUBLIC` because the match below is a prefix match, so "/"
 * in that list would hand the entire application to anyone who asked. The
 * landing page lives at "/" and the dashboard lives behind it at the same
 * address, which is why this distinction has to exist at all.
 */
const PUBLIC_EXACT = ["/", "/about", "/contact", "/privacy"];

/**
 * Pages where the response body depends on the viewer. A `Last-Modified`
 * header would either lie (the page is per-user) or force us to render before
 * we can answer, so these stay uncacheable.
 */
const NO_STORE = new Set([
  "/",
  "/login",
  "/register",
  "/forgot",
  "/reset",
  "/verify",
  "/account",
  "/report",
  "/search",
]);

/**
 * Static metadata routes we generate ourselves. They are safe to share between
 * crawlers for a short window, and a `Last-Modified` lets a 304 save the
 * round trip on the second crawl.
 */
const SHORT_CACHE = new Set(["/sitemap.xml", "/robots.txt", "/llms.txt"]);

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (NO_STORE.has(pathname)) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }

  if (SHORT_CACHE.has(pathname)) {
    const res = NextResponse.next();
    res.headers.set("Cache-Control", "public, max-age=300, must-revalidate");
    res.headers.set("Last-Modified", new Date().toUTCString());
    return res;
  }

  if (PUBLIC_EXACT.includes(pathname)) return NextResponse.next();
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p)))
    return NextResponse.next();

  if (!req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
