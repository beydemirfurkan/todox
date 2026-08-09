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
  "/s/",
  "/api/rpc",
  // Metadata files. Redirecting these to /login silently breaks the favicon
  // and every social link preview, which is the sort of thing nobody notices
  // until somebody pastes the URL into Slack.
  "/icon.svg",
  "/opengraph-image.png",
  "/robots.txt",
  "/sitemap.xml",
];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
