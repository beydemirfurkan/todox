import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { instructions, registerTools, type Workspace } from "@/mcp/tools";
import { userForApiToken } from "@/lib/services/auth";
import { BadRequest } from "@/lib/services/errors";
import { NotYours } from "@/lib/services/ownership";
import * as limit from "@/lib/services/rate-limit";
import { invoke } from "@/lib/services/rpc";
import type { MethodName } from "@/lib/services/rpc-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A tool call is a handful of queries; anything longer is a bug, not a wait. */
export const maxDuration = 30;

/**
 * The agent surface, hosted. Point any MCP client at this URL with an agent
 * token and it works — no clone, no local process, nothing to install.
 *
 * The tools are the same objects the stdio server registers (`mcp/tools.ts`).
 * What is missing here is a filesystem, and that is stated rather than faked:
 * a note whose file cannot be hashed is recorded as never checked, never as
 * fresh. A wrong "this is still accurate" is worse than no claim at all.
 */
const remoteWorkspace: Workspace = {
  // Only the agent knows these, and the instructions ask it for them.
  tz: () => undefined,
  repoRoot: () => undefined,
  hash: () => null,
  checkRefs: () => null,
};

function json(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Deliberately no `WWW-Authenticate` with `resource_metadata`: that header is
 * what makes a client go looking for an OAuth authorisation server, and this
 * one is a pasted bearer token.
 */
const unauthorised = (error: string) =>
  json({ jsonrpc: "2.0", error: { code: -32001, message: error } }, 401);

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return unauthorised("missing bearer token");

  // Same bucket as /api/rpc: one token surface, one brute-force budget.
  const gate = await limit.check("badTokenPerIp", ip);
  if (!gate.allowed)
    return json(
      { jsonrpc: "2.0", error: { code: -32001, message: "too many failed authentications" } },
      429,
      { "retry-after": String(gate.retryAfterSec) },
    );

  const user = await userForApiToken(token);
  if (!user) {
    await limit.penalise("badTokenPerIp", ip);
    return unauthorised("invalid or revoked token");
  }

  // Same bucket as /api/rpc, keyed on the token: a valid one used to buy an
  // unlimited number of calls, and an agent loop is the likeliest thing on
  // earth to make several thousand of them by accident.
  const pace = await limit.consume("agentPerToken", token);
  if (!pace.allowed)
    return json(
      { jsonrpc: "2.0", error: { code: -32000, message: "too many calls; slow down" } },
      429,
      { "retry-after": String(pace.retryAfterSec) },
    );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: "body must be JSON" } },
      400,
    );
  }

  const server = new McpServer(
    { name: "todox", version: "1.0.0" },
    { instructions: instructions({ local: false }) },
  );
  // In-process rather than a fetch back to /api/rpc: a request to our own
  // domain is a second billed invocation and a second cold start, and it is
  // the thing that breaks first behind deployment protection. `invoke` already
  // validates params and enforces ownership, and takes the user id from here
  // rather than from the caller.
  //
  // What the HTTP hop did give us was the error split in /api/rpc, and calling
  // `invoke` directly skips it. Without this the tool result would carry
  // whatever the failure said -- Postgres' own parse errors included, which is
  // exactly the feedback loop `lib/services/errors.ts` was written to close --
  // and nothing would reach the log.
  const safeInvoke = async (method: MethodName, params: Record<string, unknown>) => {
    try {
      return await invoke({ userId: user.id }, method, params);
    } catch (e) {
      // Things the agent can act on keep their real message. Ownership
      // failures must not say whether the id exists for somebody else, and
      // `NotYours` is already worded for that.
      if (e instanceof BadRequest || e instanceof NotYours) throw e;
      console.error("mcp", method, e);
      throw new Error("the server could not complete that call");
    }
  };

  registerTools(server, safeInvoke, remoteWorkspace);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: consecutive requests land on different instances, so there is
    // nowhere to keep a session that both of them can see.
    sessionIdGenerator: undefined,
    // Buffer the reply instead of opening an SSE stream. A stream left open
    // outlives the answer and burns function time for nothing.
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req, { parsedBody: body });
  } catch (e) {
    console.error("mcp", e);
    return json(
      { jsonrpc: "2.0", error: { code: -32603, message: "the server could not complete that call" } },
      500,
    );
  } finally {
    // Safe with enableJsonResponse: handleRequest has already resolved with a
    // complete body by this point.
    await server.close();
  }
}

/** Stateless and buffered, so there is no stream to open and none to tear down. */
const methodNotAllowed = () =>
  json({ jsonrpc: "2.0", error: { code: -32000, message: "use POST" } }, 405, {
    allow: "POST",
  });

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
