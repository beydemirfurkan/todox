import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The limits that stand between the account pages and a script.
 *
 * The counters live in Postgres so they hold across instances; the repository
 * is mocked here because what needs pinning is the policy — which comparison
 * each entry point makes, and what ends up written in the key.
 */
const repo = vi.hoisted(() => ({
  bump: vi.fn(),
  peek: vi.fn(),
  clear: vi.fn(),
  purgeExpired: vi.fn(),
}));

vi.mock("../repositories/rate-limits", () => repo);

const { POLICIES, check, consume, forgive, penalise } = await import("./rate-limit");

/** A window row as the repository returns it. */
const window = (count: number, resetInSec = 90) => ({
  count,
  reset_at: new Date(Date.now() + resetInSec * 1000).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the key written to the table", () => {
  it("hashes the subject, so the table holds no addresses", async () => {
    // Subjects are emails and IPs. A rate-limit table is not a place to keep
    // either, and it is read by anyone debugging a lockout.
    repo.bump.mockResolvedValue(window(1));
    await consume("resetPerEmail", "someone@example.com");

    const [key] = repo.bump.mock.calls[0] as [string];
    expect(key).not.toContain("someone@example.com");
    expect(key).not.toContain("example.com");
    expect(key).toMatch(/^resetPerEmail:[A-Za-z0-9_-]{22}$/);
  });

  it("folds case, so Bob@x.com and bob@x.com share one budget", async () => {
    // Otherwise the limit is per spelling, and the spellings are unlimited.
    repo.bump.mockResolvedValue(window(1));
    await consume("resetPerEmail", "Bob@X.com");
    await consume("resetPerEmail", "bob@x.com");

    const [first] = repo.bump.mock.calls[0] as [string];
    const [second] = repo.bump.mock.calls[1] as [string];
    expect(first).toBe(second);
  });

  it("keeps policies apart, so one budget is not spent by another", async () => {
    repo.bump.mockResolvedValue(window(1));
    await consume("loginPerIp", "1.2.3.4");
    await consume("registerPerIp", "1.2.3.4");

    const [first] = repo.bump.mock.calls[0] as [string];
    const [second] = repo.bump.mock.calls[1] as [string];
    expect(first).not.toBe(second);
  });
});

describe("consume counts the attempt it is asked about", () => {
  it("allows the attempt that reaches the limit exactly", async () => {
    // `bump` has already counted this one, so `count === limit` is the last
    // allowed attempt rather than the first refused one.
    repo.bump.mockResolvedValue(window(POLICIES.resetPerEmail.limit));

    await expect(consume("resetPerEmail", "a@b.c")).resolves.toEqual({ allowed: true });
  });

  it("refuses the one after it, and says how long to wait", async () => {
    repo.bump.mockResolvedValue(window(POLICIES.resetPerEmail.limit + 1, 90));

    const verdict = await consume("resetPerEmail", "a@b.c");

    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ retryAfterSec: expect.any(Number) });
    if (!verdict.allowed) expect(verdict.retryAfterSec).toBeGreaterThan(0);
  });

  it("passes the policy's own window to the counter", async () => {
    repo.bump.mockResolvedValue(window(1));
    await consume("registerPerIp", "1.2.3.4");

    expect(repo.bump.mock.calls[0]![1]).toBe(POLICIES.registerPerIp.windowMs);
  });

  it("never asks the caller to wait a negative or zero number of seconds", async () => {
    // A window that expired between the write and the read would otherwise
    // produce "retry in -3", which a UI renders as nonsense.
    repo.bump.mockResolvedValue(window(POLICIES.resetPerEmail.limit + 1, -600));

    const verdict = await consume("resetPerEmail", "a@b.c");

    if (verdict.allowed) throw new Error("expected a refusal");
    expect(verdict.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});

describe("check reads without counting", () => {
  it("allows when nothing has been recorded", async () => {
    repo.peek.mockResolvedValue(undefined);

    await expect(check("loginPerIdentity", "bob")).resolves.toEqual({ allowed: true });
    expect(repo.bump).not.toHaveBeenCalled();
  });

  it("refuses one attempt earlier than consume, because it has not counted this one", async () => {
    // The asymmetry is the point: login checks before it verifies and only
    // counts failures, so `check` must refuse at the limit while `consume`
    // allows at it.
    const at = POLICIES.loginPerIdentity.limit;
    repo.peek.mockResolvedValue(window(at));
    await expect(check("loginPerIdentity", "bob")).resolves.toMatchObject({ allowed: false });

    repo.peek.mockResolvedValue(window(at - 1));
    await expect(check("loginPerIdentity", "bob")).resolves.toEqual({ allowed: true });
  });
});

describe("penalise and forgive", () => {
  it("penalise counts against the same key consume would use", async () => {
    repo.bump.mockResolvedValue(window(1));
    await consume("loginPerIdentity", "bob");
    const [viaConsume] = repo.bump.mock.calls[0] as [string];

    repo.bump.mockClear();
    await penalise("loginPerIdentity", "bob");
    const [viaPenalise] = repo.bump.mock.calls[0] as [string];

    expect(viaPenalise).toBe(viaConsume);
  });

  it("forgive clears that key, so one typo does not haunt the next hour", async () => {
    repo.bump.mockResolvedValue(window(1));
    await consume("loginPerIdentity", "bob");
    const [counted] = repo.bump.mock.calls[0] as [string];

    await forgive("loginPerIdentity", "bob");

    expect(repo.clear).toHaveBeenCalledWith(counted);
  });
});

describe("the policy table", () => {
  it("gives every policy a positive limit and a real window", () => {
    for (const [name, policy] of Object.entries(POLICIES)) {
      expect(policy.limit, name).toBeGreaterThan(0);
      expect(policy.windowMs, name).toBeGreaterThan(0);
    }
  });

  it("keeps the per-identity login limit below the per-IP one", () => {
    // Otherwise the per-identity limit never bites: an attacker working one
    // account from one address hits the IP ceiling first, and a shared office
    // address locks out everybody at once.
    expect(POLICIES.loginPerIdentity.limit).toBeLessThan(POLICIES.loginPerIp.limit);
  });

  it("leaves an agent room for a busy session but not for a scan", () => {
    // A leaked token used to buy unlimited calls, which made it an unmetered
    // way to run ILIKE scans over somebody's whole log.
    expect(POLICIES.agentPerToken.limit).toBeGreaterThan(100);
    expect(POLICIES.agentPerToken.limit).toBeLessThan(5000);
  });
});
