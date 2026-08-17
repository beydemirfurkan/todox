import { describe, expect, it } from "vitest";

import proxy from "./proxy";
import { LANG_COOKIE, SESSION_COOKIE } from "./lib/cookies";

/**
 * The session gate, as a request meets it.
 *
 * This file had no test and the failure modes at either end of it are the two
 * worst the app has. Its own comment says a `"/"` in `PUBLIC` "would hand the
 * entire application to anyone who asked", because the match is a *prefix*
 * match; and leaving an agent surface out turns every tool call into an HTML
 * login page, which reads to a client as a broken server rather than a refusal.
 * Neither shows up as an error. One is a breach and the other is a silent
 * outage, so both are asserted here by name.
 *
 * The gate is UX only -- `requireUser()` in `lib/session.ts` is what actually
 * refuses -- but a hole here is still what decides whether a stranger is handed
 * a page to look at.
 */

/** Enough of a NextRequest for the function under test: a URL and cookies. */
const request = (path: string, cookies: Record<string, string> = {}) => {
  const url = new URL(`https://todox.dev${path}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
  } as unknown as Parameters<typeof proxy>[0];
};

const signedIn = { [SESSION_COOKIE]: "a-session" };

const location = (res: ReturnType<typeof proxy>) => res.headers.get("location");
const redirected = (res: ReturnType<typeof proxy>) => res.status >= 300 && res.status < 400;

describe("the gate on a signed-out visitor", () => {
  it("sends a private page to the login form", () => {
    const res = proxy(request("/report"));
    expect(redirected(res)).toBe(true);
    expect(location(res)).toContain("/login");
  });

  it.each(["/p/todox", "/p/todox/t/12", "/account", "/search", "/report"])(
    "does not hand out %s",
    (path) => {
      expect(location(proxy(request(path)))).toContain("/login");
    },
  );

  it("drops the query string on the way to /login", () => {
    // Whatever was being asked for is not the login form's business, and a
    // parameter carried across is a parameter that can be reflected back.
    const res = proxy(request("/report?period=month&project=todox"));
    expect(location(res)).not.toContain("period");
  });
});

describe("what stays reachable without a session", () => {
  it.each(["/", "/about", "/contact", "/privacy"])("serves %s", (path) => {
    expect(redirected(proxy(request(path)))).toBe(false);
  });

  it.each(["/login", "/register", "/forgot", "/reset", "/verify", "/invite"])(
    "serves %s, because a signed-out visitor is the only one who wants it",
    (path) => {
      expect(redirected(proxy(request(path)))).toBe(false);
    },
  );

  it.each(["/api/rpc", "/api/mcp"])(
    "lets %s answer for itself rather than redirecting it",
    (path) => {
      // Both carry a bearer token and never a cookie. Redirected, an agent gets
      // HTML where it expected JSON and reports a broken server.
      expect(redirected(proxy(request(path)))).toBe(false);
    },
  );

  it("lets the container's own health check through", () => {
    // A 307 is a perfectly healthy answer to "can you serve anything", so a
    // redirect here keeps a container up with its database unreachable.
    expect(redirected(proxy(request("/api/health")))).toBe(false);
  });

  it.each(["/icon.svg", "/opengraph-image.png", "/robots.txt", "/sitemap.xml", "/llms.txt"])(
    "serves %s, so previews and crawlers are not sent to a login form",
    (path) => {
      expect(redirected(proxy(request(path)))).toBe(false);
    },
  );

  it("serves a share link and its children", () => {
    expect(redirected(proxy(request("/s/abc123")))).toBe(false);
  });
});

describe("the prefix match, which is the dangerous part", () => {
  it("does not treat the dashboard as public because the landing page is", () => {
    // "/" and the dashboard are the same address. `PUBLIC_EXACT` exists only to
    // stop "/" being matched as a prefix -- if it ever moves into `PUBLIC`,
    // every path in the app matches it and this is the test that says so.
    expect(location(proxy(request("/p/secret")))).toContain("/login");
  });

  it("does not let a private path win by starting like a public one", () => {
    // `/searchable` is not `/search`; `/logins` is not `/login`. The concern is
    // the other direction too: a public entry must not open a private sibling.
    expect(location(proxy(request("/accounts-payable")))).toContain("/login");
    expect(location(proxy(request("/reportage")))).toContain("/login");
  });
});

describe("cache headers", () => {
  it("marks a signed-in page uncacheable", () => {
    // These render one account's rows. A shared cache holding one is the
    // failure worth spending a header on.
    const res = proxy(request("/report", signedIn));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets crawlers share the metadata routes for a short window", () => {
    const res = proxy(request("/robots.txt"));
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("last-modified")).toBeTruthy();
  });

  it("caches a share link privately, never publicly", () => {
    // The render depends on the language cookie, so a shared cache keyed on the
    // URL alone would hand one reader another reader's language.
    const res = proxy(request("/s/abc123"));
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("keeps a share link reachable while caching it", () => {
    // The cache branch returns early, so it has to be a pass-through and not an
    // accidental gate of its own.
    expect(redirected(proxy(request("/s/abc123")))).toBe(false);
  });
});

describe("?lang=", () => {
  it("stores the choice and sends the reader to the clean address", () => {
    // A launch post or a directory listing needs a URL whose language does not
    // depend on the reader's settings; the parameter must not travel further.
    const res = proxy(request("/?lang=en"));
    expect(redirected(res)).toBe(true);
    expect(location(res)).not.toContain("lang");
    expect(res.cookies.get(LANG_COOKIE)?.value).toBe("en");
  });

  it("runs before the gate, so the redirect is not a login redirect", () => {
    const res = proxy(request("/report?lang=tr"));
    expect(location(res)).not.toContain("/login");
    expect(res.cookies.get(LANG_COOKIE)?.value).toBe("tr");
  });

  it("ignores a language it does not have", () => {
    // Anything else is a stranger's string; storing it would put an unknown
    // value in the cookie every later request reads.
    const res = proxy(request("/?lang=klingon"));
    expect(res.cookies.get(LANG_COOKIE)).toBeUndefined();
  });
});
