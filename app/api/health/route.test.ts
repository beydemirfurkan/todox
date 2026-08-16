import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The check a container runtime acts on.
 *
 * Its only job is to stop being true when this process cannot serve, and the
 * failure mode of the previous one was that it never did: fetching `/login`
 * proved React could render, which stays true while the database is gone. So
 * what is asserted here is the part that makes it a liveness check at all --
 * it reaches the database, and it says no when the database does not answer.
 */
const mocks = vi.hoisted(() => ({ one: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/db/client", () => ({ one: mocks.one }));
vi.mock("@/lib/server/log", () => ({ logError: mocks.logError }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.one.mockResolvedValue({ ok: 1 });
});

describe("when the database answers", () => {
  it("reports healthy", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("actually asks it something", async () => {
    // The whole point. A check that does not reach the dependency is a check
    // that only ever passes.
    await GET();
    expect(mocks.one).toHaveBeenCalledTimes(1);
  });

  it("asks nothing that depends on a table", async () => {
    // `SELECT 1` proves a connection and a round trip. Reading a row would
    // make the check fail for reasons that are not about health, and would
    // put a query on a path called every thirty seconds forever.
    await GET();
    const [sql] = mocks.one.mock.calls[0] as [string];
    expect(sql).toMatch(/^SELECT 1\b/i);
    expect(sql).not.toMatch(/\bFROM\b/i);
  });
});

describe("when the database does not", () => {
  const DOWN = new Error("connection terminated unexpectedly");

  beforeEach(() => {
    mocks.one.mockRejectedValue(DOWN);
  });

  it("reports 503 rather than throwing", async () => {
    // 503 and not 500: this is "not ready to take traffic", which is the thing
    // an orchestrator, a load balancer and a deploy gate all act on.
    const res = await GET();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false });
  });

  it("says nothing about why to an unauthenticated caller", async () => {
    // The endpoint carries no token, so the body is the one thing anybody can
    // read. Which host, which database and what the driver said are not in it.
    const res = await GET();
    expect(JSON.stringify(await res.json())).not.toContain("connection terminated");
  });

  it("puts the reason in the log, where it is worth having", async () => {
    await GET();
    expect(mocks.logError).toHaveBeenCalledWith("health.database", DOWN);
  });
});
