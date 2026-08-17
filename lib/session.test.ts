import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cookie the whole session rests on, and the check that reads it.
 *
 * This had no test. Every property below is one nobody would see go wrong from
 * the outside: a cookie without `httpOnly` is readable by any script on the
 * page, one without `secure` travels in clear over a downgraded request, one
 * scoped to the wrong path stops being sent and reads as a random sign-out --
 * and `requireUser` returning instead of redirecting hands an anonymous visitor
 * a page that then renders somebody's rows.
 */
const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  userForSession: vi.fn(),
}));

/** Next's redirect throws to stop rendering; the tests need the same shape. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.set, get: mocks.get, delete: mocks.del }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("./services/auth", () => ({ userForSession: mocks.userForSession }));

const { currentUser, requireUser, setSessionCookie, clearSessionCookie } = await import(
  "./session"
);
const { SESSION_COOKIE, SESSION_DAYS } = await import("./util/tokens");

const USER = { id: 7, username: "bob", name: "Bob", email: "b@example.com" };

const options = () => mocks.set.mock.calls[0]![2];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(undefined);
});

describe("the session cookie", () => {
  it("is written under the name every other reader looks for", async () => {
    // `proxy.ts` and `clearSessionCookie` both read this name. A mismatch is a
    // sign-in that appears to work and a gate that never sees it.
    await setSessionCookie("a-token");
    expect(mocks.set.mock.calls[0]![0]).toBe(SESSION_COOKIE);
    expect(mocks.set.mock.calls[0]![1]).toBe("a-token");
  });

  it("is httpOnly, so no script on the page can read it", async () => {
    await setSessionCookie("a-token");
    expect(options().httpOnly).toBe(true);
  });

  it("is sameSite lax, so it is not sent on a cross-site POST", async () => {
    // The app has no CSRF tokens; this and Next's own origin check are what
    // stand in for them.
    await setSessionCookie("a-token");
    expect(options().sameSite).toBe("lax");
  });

  it("is scoped to the whole site", async () => {
    // Scoped to anything narrower it stops being sent on the next page, which
    // reads to a user as being signed out at random.
    await setSessionCookie("a-token");
    expect(options().path).toBe("/");
  });

  it("expires, and after the number of days the rest of the code believes", async () => {
    await setSessionCookie("a-token");
    expect(options().maxAge).toBe(60 * 60 * 24 * SESSION_DAYS);
  });

  it("is not marked secure outside production, or nothing works on localhost", async () => {
    // http://localhost never receives a `secure` cookie, so the flag has to
    // follow the environment rather than being hardcoded either way.
    await setSessionCookie("a-token");
    expect(options().secure).toBe(false);
  });
});

describe("clearing it", () => {
  it("hands back the token it removed, so the row can be deleted too", async () => {
    // Dropping the cookie without deleting the row leaves a live session that
    // the browser has simply forgotten -- still valid to anyone holding it.
    mocks.get.mockReturnValue({ value: "a-token" });
    const token = await clearSessionCookie();
    expect(token).toBe("a-token");
    expect(mocks.del).toHaveBeenCalledWith(SESSION_COOKIE);
  });

  it("still clears the cookie when there was nothing to hand back", async () => {
    const token = await clearSessionCookie();
    expect(token).toBeUndefined();
    expect(mocks.del).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});

describe("reading the current user", () => {
  it("does not ask the database when there is no cookie", async () => {
    // Every page calls this. A lookup per anonymous request is a round trip
    // spent to learn what the absent cookie already said.
    expect(await currentUser()).toBeNull();
    expect(mocks.userForSession).not.toHaveBeenCalled();
  });

  it("looks the token up rather than trusting it", async () => {
    // The cookie is a bearer of a hash, not a claim. Anyone can send a string.
    mocks.get.mockReturnValue({ value: "a-token" });
    mocks.userForSession.mockResolvedValue(USER);
    expect(await currentUser()).toEqual(USER);
    expect(mocks.userForSession).toHaveBeenCalledWith("a-token");
  });

  it("answers null for a token the database does not know", async () => {
    // Expired, revoked, or invented. All three are the same answer.
    mocks.get.mockReturnValue({ value: "stale" });
    mocks.userForSession.mockResolvedValue(undefined);
    expect(await currentUser()).toBeNull();
  });
});

describe("requireUser", () => {
  it("redirects rather than returning when nobody is signed in", async () => {
    // This is the real gate -- `proxy.ts` only checks that a cookie exists and
    // cannot reach the database. Returning here would render the page.
    await expect(requireUser()).rejects.toThrow(Redirected);
    await expect(requireUser()).rejects.toMatchObject({ to: "/login" });
  });

  it("redirects on a cookie the database has never heard of", async () => {
    // A present-but-invalid cookie satisfies the proxy and must not satisfy
    // this: that gap is the whole reason the two checks are different.
    mocks.get.mockReturnValue({ value: "forged" });
    mocks.userForSession.mockResolvedValue(undefined);
    await expect(requireUser()).rejects.toThrow(Redirected);
  });

  it("returns the user when the session resolves", async () => {
    mocks.get.mockReturnValue({ value: "a-token" });
    mocks.userForSession.mockResolvedValue(USER);
    expect(await requireUser()).toEqual(USER);
  });
});
