import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boundary every agent call crosses, and the only place that decides what
 * a caller is told when something goes wrong.
 *
 * Nothing covered it. The handler itself is short, but everything short about
 * it is a policy: which failures keep their message and which are replaced,
 * what a bad token costs, whether a database that is down answers in the shape
 * clients parse or in the framework's own HTML. Each of those is invisible
 * when it is wrong -- the route keeps answering, just differently.
 */
const mocks = vi.hoisted(() => ({
  userForApiToken: vi.fn(),
  check: vi.fn(),
  consume: vi.fn(),
  penalise: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/lib/services/auth", () => ({ userForApiToken: mocks.userForApiToken }));
vi.mock("@/lib/services/rate-limit", () => ({
  check: mocks.check,
  consume: mocks.consume,
  penalise: mocks.penalise,
}));
vi.mock("@/lib/services/rpc", () => ({ invoke: mocks.invoke }));

const { POST } = await import("./route");
const { BadRequest } = await import("@/lib/services/errors");
const { NotYours } = await import("@/lib/services/ownership");

const USER = { id: 7 };
const ALLOWED = { allowed: true, retryAfterSec: 0 };

type Options = { token?: string | null; body?: unknown; headers?: Record<string, string> };

function post({ token = "todox_good", body = { method: "listProjects" }, headers = {} }: Options = {}) {
  const req = new Request("http://localhost/api/rpc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(ALLOWED);
  mocks.consume.mockResolvedValue(ALLOWED);
  mocks.penalise.mockResolvedValue(undefined);
  mocks.userForApiToken.mockResolvedValue(USER);
  mocks.invoke.mockResolvedValue({ projects: [] });
});

describe("authentication", () => {
  it("refuses a request with no bearer token", async () => {
    const res = await post({ token: null });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "missing bearer token" });
  });

  it("does not spend a query or a rate-limit slot on one", async () => {
    // Unauthenticated traffic is the cheapest thing to receive and should stay
    // that way; metering it would also let anyone fill somebody else's bucket.
    await post({ token: null });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.userForApiToken).not.toHaveBeenCalled();
  });

  it("refuses a token that resolves to nobody", async () => {
    mocks.userForApiToken.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "invalid or revoked token" });
  });

  it("charges a failed token to the address it came from", async () => {
    // Tokens are long random strings, but nothing should be free to guess.
    mocks.userForApiToken.mockResolvedValue(null);
    await post({ headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(mocks.penalise).toHaveBeenCalledWith("badTokenPerIp", "203.0.113.7");
  });

  it("takes the account from the token, never from the payload", async () => {
    await post({ body: { method: "listProjects", params: {}, userId: 99 } });
    const [ctx] = mocks.invoke.mock.calls[0] as [{ userId: number }];
    expect(ctx.userId).toBe(USER.id);
  });
});

describe("rate limiting", () => {
  it("answers 429 with retry-after when the bad-token gate is shut", async () => {
    mocks.check.mockResolvedValue({ allowed: false, retryAfterSec: 42 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mocks.userForApiToken).not.toHaveBeenCalled();
  });

  it("answers 429 with retry-after when a valid token is going too fast", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, retryAfterSec: 7 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("paces on the token rather than the account", async () => {
    // One runaway agent must not be able to lock the account's others out.
    await post();
    expect(mocks.consume).toHaveBeenCalledWith("agentPerToken", "todox_good");
  });
});

describe("what a failure is allowed to say", () => {
  it("maps a foreign row to 404, with a message that does not confirm it exists", async () => {
    mocks.invoke.mockRejectedValue(new NotYours("task", 12));
    const res = await post();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("task #12 does not exist or is not yours");
  });

  it("hands back the real message when the agent can act on it", async () => {
    mocks.invoke.mockRejectedValue(new BadRequest("pass at least one of title, body"));
    const res = await post();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "pass at least one of title, body",
    });
  });

  it("replaces anything else, so a driver error is not a probe result", async () => {
    // Returning the raw text handed callers Postgres' own parse errors, which
    // is exactly the feedback loop you want when probing a query.
    mocks.invoke.mockRejectedValue(
      new Error('syntax error at or near "SELECT password_hash FROM users"'),
    );
    const res = await post();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("the server could not complete that call");
    expect(JSON.stringify(body)).not.toContain("password_hash");
  });

  it("refuses a body that is not JSON", async () => {
    const res = await post({ body: "{not json" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: "body must be JSON" });
  });

  it("refuses a method that is not a string", async () => {
    const res = await post({ body: { method: 12 } });
    expect(res.status).toBe(400);
  });
});

/**
 * The half that used to run above every `try`.
 *
 * Rate limiting and token resolution both talk to Postgres, and both sat
 * outside the guard: a database that was down threw straight out of the
 * handler, so the caller got the framework's HTML 500 and no log line of ours
 * was written. A client that only parses JSON reads that as a broken server
 * rather than a failed call.
 */
describe("a database that is not answering", () => {
  const DOWN = new Error("connection terminated unexpectedly");

  it("still answers in this route's shape when the rate limiter cannot be read", async () => {
    mocks.check.mockRejectedValue(DOWN);
    const res = await post();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      error: "the server could not complete that call",
    });
  });

  it("still answers in this route's shape when the token cannot be resolved", async () => {
    mocks.userForApiToken.mockRejectedValue(DOWN);
    const res = await post();
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("does not leak what the driver said", async () => {
    mocks.consume.mockRejectedValue(DOWN);
    const res = await post();
    expect(JSON.stringify(await res.json())).not.toContain("connection terminated");
  });
});
