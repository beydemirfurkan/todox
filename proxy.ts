import { NextResponse, type NextRequest } from "next/server";

import { LANG_COOKIE, SESSION_COOKIE } from "./lib/cookies";
import { isLang } from "./lib/i18n";

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

/**
 * A share link, cached in the reader's own browser for a minute.
 *
 * Every view reads the project's tasks and their log, and this is the page
 * people paste somewhere and then reload. `private`, not `public`: the render
 * depends on the language cookie, so a shared cache keyed on the URL alone
 * would hand one reader another's language. That makes this a small win rather
 * than a defence -- the ceiling on what it reads and `sharePerIp` are the
 * defence -- but a refresh should not be a second full read.
 */
const SHORT_CACHE_PREFIX = "/s/";

/**
 * `?lang=en` — a link that arrives in the language it promises.
 *
 * Negotiation covers the browser that asks, but a launch post, a directory
 * listing or a message to one person needs a URL whose language does not depend
 * on the reader's settings. This makes the choice explicit, stores it like the
 * switcher does, and sends the reader on to the clean address so the parameter
 * does not travel any further or turn one page into two.
 */
function claimedLang(req: NextRequest): NextResponse | undefined {
  const asked = req.nextUrl.searchParams.get("lang");
  if (!isLang(asked)) return undefined;

  const url = req.nextUrl.clone();
  url.searchParams.delete("lang");
  const res = NextResponse.redirect(url);
  res.cookies.set(LANG_COOKIE, asked, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

/** Serve it, or send a visitor with no cookie to the login form. */
function gate(req: NextRequest, pathname: string): NextResponse {
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

/** Decorate a decision that has already been made. */
function cached(pathname: string, res: NextResponse): NextResponse {
  if (NO_STORE.has(pathname)) res.headers.set("Cache-Control", "private, no-store");
  else if (SHORT_CACHE.has(pathname)) {
    res.headers.set("Cache-Control", "public, max-age=300, must-revalidate");
    res.headers.set("Last-Modified", new Date().toUTCString());
  } else if (pathname.startsWith(SHORT_CACHE_PREFIX))
    res.headers.set("Cache-Control", "private, max-age=60");
  return res;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Before everything: it applies to any page, and the redirect it returns is
  // what the rules below should be deciding about.
  const claimed = claimedLang(req);
  if (claimed) return claimed;

  // The gate decides, then the headers decorate. Each cache rule used to
  // `return` its own fresh response, which meant a path in `NO_STORE` never
  // reached the gate at all -- `/account`, `/report` and `/search` are all in
  // that set, so the redirect below was dead for exactly the three pages it was
  // most obviously for. Nothing was reachable that should not have been, because
  // `requireUser()` is the real check and redirects on its own; what was broken
  // was the guarantee, and the trap it left. Adding a page to `NO_STORE` looks
  // like adding a header and silently removed it from the gate.
  return cached(pathname, gate(req, pathname));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
