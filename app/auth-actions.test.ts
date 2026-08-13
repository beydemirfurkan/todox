import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The account forms, as a caller reaches them.
 *
 * `lib/services/auth.ts` decides what each credential is worth;
 * this layer decides what is metered, in what order, and where the browser is
 * sent afterwards. Every property below is one a past version got wrong, and
 * none of them shows up as an error when it is wrong again.
 */
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  headerValues: new Map<string, string>(),
  check: vi.fn(),
  consume: vi.fn(),
  penalise: vi.fn(),
  forgive: vi.fn(),
  login: vi.fn(),
  issueSession: vi.fn(async () => "session-token"),
  changeEmail: vi.fn(),
  changePassword: vi.fn(),
  deleteAccount: vi.fn(),
  createApiToken: vi.fn(async () => ({ token: "todox_new", row: {}, preview: "todox_ne…" })),
  revokeApiToken: vi.fn(),
  requestPasswordReset: vi.fn(),
  sendVerification: vi.fn(),
  sendEmailChanged: vi.fn(),
  order: [] as string[],
}));

/** Next's redirect throws to stop the action; the tests need the same shape. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => mocks.headerValues.get(k) ?? null }),
}));
vi.mock("@/lib/lang", () => ({ getLang: async () => "en" }));
vi.mock("@/lib/session", () => ({
  requireUser: mocks.requireUser,
  setSessionCookie: mocks.setSessionCookie,
  clearSessionCookie: mocks.clearSessionCookie,
}));
vi.mock("@/lib/services/rate-limit", () => ({
  check: (...a: unknown[]) => (mocks.order.push("check"), mocks.check(...a)),
  consume: (...a: unknown[]) => (mocks.order.push("consume"), mocks.consume(...a)),
  penalise: mocks.penalise,
  forgive: mocks.forgive,
}));
vi.mock("@/lib/services/auth", () => ({
  login: (...a: unknown[]) => (mocks.order.push("login"), mocks.login(...a)),
  issueSession: mocks.issueSession,
  changeEmail: (...a: unknown[]) => (mocks.order.push("changeEmail"), mocks.changeEmail(...a)),
  changePassword: mocks.changePassword,
  deleteAccount: (...a: unknown[]) =>
    (mocks.order.push("deleteAccount"), mocks.deleteAccount(...a)),
  changeName: vi.fn(async () => ({ ok: true, value: true })),
  createApiToken: mocks.createApiToken,
  revokeApiToken: mocks.revokeApiToken,
  revokeAllApiTokens: vi.fn(),
  register: vi.fn(),
  validateRegistration: vi.fn(() => []),
}));
vi.mock("@/lib/services/account-recovery", () => ({
  requestPasswordReset: mocks.requestPasswordReset,
  completePasswordReset: vi.fn(),
  completeVerification: vi.fn(),
  sendVerification: mocks.sendVerification,
  sendEmailChanged: mocks.sendEmailChanged,
  sessionAfterReset: vi.fn(),
}));

const actions = await import("./auth-actions");

const USER = { id: 5, email: "bob@example.com", email_verified_at: null };
const ALLOWED = { allowed: true } as const;

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

/** Run an action, reporting a redirect as a value instead of a throw. */
async function outcome<T>(run: () => Promise<T>): Promise<T | { redirectedTo: string }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Redirected) return { redirectedTo: e.to };
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order = [];
  mocks.headerValues = new Map();
  mocks.requireUser.mockResolvedValue(USER);
  mocks.check.mockResolvedValue(ALLOWED);
  mocks.consume.mockResolvedValue(ALLOWED);
});

describe("loginAction", () => {
  const creds = form({ identifier: "bob", password: "hunter2" });

  it("checks both buckets before it hashes anything", async () => {
    mocks.login.mockResolvedValue({ ok: false, errors: [] });

    await outcome(() => actions.loginAction(null, creds));

    // `auth.login` is where scrypt runs. A limiter consulted afterwards meters
    // nothing that costs anything.
    expect(mocks.order).toEqual(["check", "check", "login"]);
    expect(mocks.check).toHaveBeenCalledWith("loginPerIdentity", "bob");
    expect(mocks.check).toHaveBeenCalledWith("loginPerIp", "unknown");
  });

  it("refuses before hashing when a bucket is spent", async () => {
    mocks.check.mockResolvedValueOnce({ allowed: false, retryAfterSec: 120 });

    const state = await outcome(() => actions.loginAction(null, creds));

    expect(mocks.login).not.toHaveBeenCalled();
    expect(state).toMatchObject({ errors: [{ code: "tooManyAttempts", retryAfterSec: 2 }] });
  });

  it("counts a failure against both buckets, and starts no session", async () => {
    mocks.login.mockResolvedValue({ ok: false, errors: [{ field: "form", code: "bad" }] });

    await outcome(() => actions.loginAction(null, creds));

    expect(mocks.penalise).toHaveBeenCalledWith("loginPerIdentity", "bob");
    expect(mocks.penalise).toHaveBeenCalledWith("loginPerIp", "unknown");
    expect(mocks.setSessionCookie).not.toHaveBeenCalled();
  });

  it("counts nothing against a success, so signing in all day never locks you out", async () => {
    mocks.login.mockResolvedValue({ ok: true, value: USER });

    await outcome(() => actions.loginAction(null, creds));

    expect(mocks.penalise).not.toHaveBeenCalled();
    expect(mocks.forgive).toHaveBeenCalledWith("loginPerIdentity", "bob");
    expect(mocks.setSessionCookie).toHaveBeenCalledWith("session-token");
  });

  it("takes the left-most forwarded hop as the address", async () => {
    mocks.headerValues.set("x-forwarded-for", "203.0.113.7, 10.0.0.1, 10.0.0.2");
    mocks.login.mockResolvedValue({ ok: false, errors: [] });

    await outcome(() => actions.loginAction(null, creds));

    expect(mocks.check).toHaveBeenCalledWith("loginPerIp", "203.0.113.7");
  });

  it("falls back to a shared bucket rather than to no limit", async () => {
    // A missing header must degrade into "everyone counts together", not into
    // an unmetered path somebody can arrange by stripping it.
    mocks.login.mockResolvedValue({ ok: false, errors: [] });

    await outcome(() => actions.loginAction(null, creds));

    expect(mocks.check).toHaveBeenCalledWith("loginPerIp", "unknown");
  });

  describe("the post-login destination", () => {
    beforeEach(() => mocks.login.mockResolvedValue({ ok: true, value: USER }));

    it("accepts an invite link that looks like one", async () => {
      const token = "a".repeat(32);
      const state = await outcome(() =>
        actions.loginAction(null, form({ identifier: "bob", password: "p", next: `/invite?token=${token}` })),
      );

      expect(state).toEqual({ redirectedTo: `/invite?token=${token}` });
    });

    it("sends everything else home", async () => {
      // `next` comes from the query string, so it is an open redirect unless
      // the one shape that is allowed is spelled out.
      for (const next of [
        "https://evil.example/steal",
        "//evil.example",
        "/account",
        "/invite?token=short",
        "/invite?token=" + "a".repeat(32) + "&then=https://evil.example",
        "javascript:alert(1)",
      ]) {
        const state = await outcome(() =>
          actions.loginAction(null, form({ identifier: "bob", password: "p", next })),
        );
        expect(state, next).toEqual({ redirectedTo: "/" });
      }
    });
  });
});

describe("requestResetAction", () => {
  it("answers the same whether or not the address has an account", async () => {
    // The service is told either way and says nothing back; the action cannot
    // leak what it does not learn. Asserted so a future version that starts
    // branching on a return value fails here.
    mocks.requestPasswordReset.mockResolvedValue(undefined);
    const known = await outcome(() => actions.requestResetAction(null, form({ email: "bob@example.com" })));

    mocks.requestPasswordReset.mockResolvedValue(undefined);
    const unknown = await outcome(() => actions.requestResetAction(null, form({ email: "nobody@example.com" })));

    expect(known).toEqual({ redirectedTo: "/forgot?sent=1" });
    expect(known).toEqual(unknown);
  });

  it("meters by address as well as by address-of-origin", async () => {
    await outcome(() => actions.requestResetAction(null, form({ email: "bob@example.com" })));

    expect(mocks.consume).toHaveBeenCalledWith("resetPerIp", "unknown");
    expect(mocks.consume).toHaveBeenCalledWith("resetPerEmail", "bob@example.com");
  });

  it("sends no mail once the bucket is spent", async () => {
    mocks.consume.mockResolvedValueOnce({ allowed: false, retryAfterSec: 600 });

    const state = await outcome(() => actions.requestResetAction(null, form({ email: "b@c.d" })));

    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
    expect(state).toMatchObject({ errors: [{ code: "tooManyAttempts" }] });
  });
});

describe("deleteAccountAction", () => {
  it("reads the bucket without spending it, and charges only a failure", async () => {
    // Consuming up front meant five mistyped confirmations locked you out of
    // deleting the account *and* changing the address for an hour, having
    // succeeded at neither.
    mocks.deleteAccount.mockResolvedValue({ ok: false, errors: [{ code: "confirmMismatch" }] });

    await outcome(() => actions.deleteAccountAction(null, form({ password: "p", confirm: "x" })));

    expect(mocks.check).toHaveBeenCalledWith("emailChangePerUser", "5");
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.penalise).toHaveBeenCalledWith("emailChangePerUser", "5");
  });

  it("charges nothing when the account is actually deleted", async () => {
    mocks.deleteAccount.mockResolvedValue({ ok: true, value: true });

    const state = await outcome(() =>
      actions.deleteAccountAction(null, form({ password: "p", confirm: "bob" })),
    );

    expect(mocks.penalise).not.toHaveBeenCalled();
    // The session row went with the account; the cookie pointing at it has to
    // go too, or the next request spends a query proving it is dead.
    expect(mocks.clearSessionCookie).toHaveBeenCalled();
    expect(state).toEqual({ redirectedTo: "/login" });
  });

  it("stops at a spent bucket without touching the account", async () => {
    mocks.check.mockResolvedValue({ allowed: false, retryAfterSec: 3600 });

    await outcome(() => actions.deleteAccountAction(null, form({ password: "p", confirm: "bob" })));

    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});

describe("changeEmailAction", () => {
  const change = form({ current: "p", email: "new@example.com" });

  it("meters before it does the work", async () => {
    mocks.changeEmail.mockResolvedValue({ ok: false, errors: [] });

    await outcome(() => actions.changeEmailAction(null, change));

    // Unmetered, this was "send mail from your domain to any address I name",
    // routing around the limit on resending a verification.
    expect(mocks.order).toEqual(["consume", "changeEmail"]);
    expect(mocks.consume).toHaveBeenCalledWith("emailChangePerUser", "5");
  });

  it("warns the address being left behind", async () => {
    mocks.changeEmail.mockResolvedValue({
      ok: true,
      value: {
        user: { ...USER, email: "new@example.com" },
        previousEmail: "bob@example.com",
      },
    });

    await outcome(() => actions.changeEmailAction(null, change));

    // The old address is the only channel left to someone locked out.
    expect(mocks.sendEmailChanged).toHaveBeenCalled();
    expect(mocks.sendEmailChanged.mock.calls[0]![0]).toBe("bob@example.com");
    expect(mocks.sendVerification).toHaveBeenCalled();
  });

  it("sends nothing when the address did not actually change", async () => {
    mocks.changeEmail.mockResolvedValue({
      ok: true,
      value: { user: USER, previousEmail: "BOB@example.com" },
    });

    await outcome(() => actions.changeEmailAction(null, change));

    expect(mocks.sendEmailChanged).not.toHaveBeenCalled();
    expect(mocks.sendVerification).not.toHaveBeenCalled();
  });
});

describe("changePasswordAction", () => {
  it("drops the cookie on success, because every session just died", async () => {
    mocks.changePassword.mockResolvedValue({ ok: true, value: true });

    const state = await outcome(() =>
      actions.changePasswordAction(null, form({ current: "a", password: "bbbbbbbb" })),
    );

    expect(mocks.clearSessionCookie).toHaveBeenCalled();
    expect(state).toEqual({ redirectedTo: "/login" });
  });

  it("keeps the caller signed in when the change was refused", async () => {
    mocks.changePassword.mockResolvedValue({ ok: false, errors: [{ code: "badCredentials" }] });

    const state = await outcome(() =>
      actions.changePasswordAction(null, form({ current: "wrong", password: "bbbbbbbb" })),
    );

    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
    expect(state).toMatchObject({ errors: [{ code: "badCredentials" }] });
  });
});

describe("api token actions", () => {
  it("returns the new token in the reply rather than a redirect", async () => {
    // It used to travel as ?created=, which left a live token in browser
    // history, in Referer, and in every access log on the way.
    const state = await outcome(() => actions.createTokenAction(null, form({ name: "laptop" })));

    expect(state).toEqual({ token: "todox_new" });
  });

  it("refuses an id that is not an integer, rather than handing NaN to a column", async () => {
    for (const token_id of ["", "abc", "1.5", "NaN", "1e999"]) {
      await outcome(() => actions.revokeTokenAction(form({ token_id })));
    }

    expect(mocks.revokeApiToken).not.toHaveBeenCalled();
  });

  it("scopes a revoke to the session user", async () => {
    await outcome(() => actions.revokeTokenAction(form({ token_id: "11" })));

    expect(mocks.revokeApiToken).toHaveBeenCalledWith(11, USER.id);
  });
});
