import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The same boundary as `/api/rpc`, answering in a different language.
 *
 * This one speaks JSON-RPC, and an MCP client parses nothing else -- so a
 * refusal shaped like the other route's, or the framework's own HTML 500,
 * reads to it as a broken server rather than a failed call. That is the whole
 * reason these two files are tested apart: the policy is shared and the
 * envelope is not.
 */
const mocks = vi.hoisted(() => ({
  userForApiToken: vi.fn(),
  check: vi.fn(),
  consume: vi.fn(),
  penalise: vi.fn(),
  invoke: vi.fn(),
  registerTools: vi.fn(),
  handleRequest: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/services/auth", () => ({ userForApiToken: mocks.userForApiToken }));
vi.mock("@/lib/services/rate-limit", () => ({
  check: mocks.check,
  consume: mocks.consume,
  penalise: mocks.penalise,
}));
vi.mock("@/lib/services/rpc", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/server/client-info", () => ({
  normalise: () => ({ name: "claude-code", version: "1" }),
  record: mocks.record,
}));
vi.mock("@/mcp/tools", () => ({
  instructions: () => "instructions",
  registerTools: mocks.registerTools,
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    connect = mocks.connect;
    close = mocks.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  WebStandardStreamableHTTPServerTransport: class {
    handleRequest = mocks.handleRequest;
  },
}));

const route = await import("./route");

const USER = { id: 7 };
const ALLOWED = { allowed: true, retryAfterSec: 0 };
const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };

function post({
  token = "todox_good",
  body = INITIALIZE,
  headers = {},
}: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  return route.POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(ALLOWED);
  mocks.consume.mockResolvedValue(ALLOWED);
  mocks.userForApiToken.mockResolvedValue(USER);
  mocks.connect.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.handleRequest.mockResolvedValue(new Response("{}", { status: 200 }));
});

/** Every refusal this route makes has to be one an MCP client can read. */
async function jsonRpcError(res: Response) {
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = await res.json();
  expect(body.jsonrpc).toBe("2.0");
  return body.error as { code: number; message: string };
}

describe("authentication", () => {
  it("refuses a request with no bearer token, in JSON-RPC", async () => {
    const res = await post({ token: null });
    expect(res.status).toBe(401);
    expect((await jsonRpcError(res)).message).toBe("missing bearer token");
  });

  it("does not offer OAuth discovery on the way out", async () => {
    // A `WWW-Authenticate` with `resource_metadata` is what sends a client
    // looking for an authorisation server. This one is a pasted token.
    const res = await post({ token: null });
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("refuses a token that resolves to nobody", async () => {
    mocks.userForApiToken.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
    expect((await jsonRpcError(res)).message).toBe("invalid or revoked token");
  });

  it("charges a failed token to the address it came from", async () => {
    mocks.userForApiToken.mockResolvedValue(null);
    await post({ headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(mocks.penalise).toHaveBeenCalledWith("badTokenPerIp", "203.0.113.9");
  });

  it("shares the bad-token budget with the other surface", async () => {
    // One token surface, one brute-force budget: metering them separately
    // would double what guessing is allowed to cost.
    await post();
    expect(mocks.check).toHaveBeenCalledWith("badTokenPerIp", expect.any(String));
    expect(mocks.consume).toHaveBeenCalledWith("agentPerToken", "todox_good");
  });
});

describe("rate limiting", () => {
  it("answers 429 with retry-after when the bad-token gate is shut", async () => {
    mocks.check.mockResolvedValue({ allowed: false, retryAfterSec: 42 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(await jsonRpcError(res)).toMatchObject({ code: -32001 });
  });

  it("answers 429 when a valid token is going too fast, without building a server", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, retryAfterSec: 7 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(mocks.registerTools).not.toHaveBeenCalled();
  });
});

describe("the methods this endpoint does not have", () => {
  it("answers 405 to GET and DELETE, and says what to use", async () => {
    // Stateless and buffered: there is no stream to open and none to tear
    // down, so a client trying either should be told rather than left waiting.
    for (const handler of [route.GET, route.DELETE]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect((await jsonRpcError(res)).message).toBe("use POST");
    }
  });
});

describe("a failure inside the request", () => {
  const DOWN = new Error("connection terminated unexpectedly");

  it("answers in JSON-RPC when the rate limiter cannot be read", async () => {
    // This ran above every `try`: the caller used to get the framework's HTML.
    mocks.check.mockRejectedValue(DOWN);
    const res = await post();
    expect(res.status).toBe(500);
    expect(await jsonRpcError(res)).toMatchObject({ code: -32603 });
  });

  it("answers in JSON-RPC when the token cannot be resolved", async () => {
    mocks.userForApiToken.mockRejectedValue(DOWN);
    const res = await post();
    expect(res.status).toBe(500);
    expect((await jsonRpcError(res)).message).toBe("the server could not complete that call");
  });

  it("does not repeat what the driver said", async () => {
    mocks.handleRequest.mockRejectedValue(DOWN);
    const res = await post();
    expect(JSON.stringify(await res.json())).not.toContain("connection terminated");
  });

  it("closes the server even when the request fails", async () => {
    // `finally`, not the happy path: the transport holds a connection open
    // and a request that throws would otherwise leave it behind.
    mocks.handleRequest.mockRejectedValue(DOWN);
    await post();
    expect(mocks.close).toHaveBeenCalled();
  });

  it("does not let recording the client break the call", async () => {
    // Bookkeeping. It is worth a log line and nothing more.
    mocks.record.mockRejectedValue(DOWN);
    const res = await post();
    expect(res.status).toBe(200);
  });
});
