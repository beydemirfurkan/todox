import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { instructions, registerTools, type Workspace } from "@/mcp/tools";
import { clientIp } from "@/lib/server/client-ip";
import { normalise, record } from "@/lib/server/client-info";
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
 * The half of todox that has no filesystem -- so it answers every Workspace
 * probe that needs a disk with "unknown" rather than guessing. Built per
 * request so the bearer token is scoped to the call that authenticated it: one
 * process serves many requests at once, and a module-level token slot would
 * race between them -- handing one agent's token to another agent's call.
 */
function buildRemoteWorkspace(token: string): Workspace {
  return {
    tz: () => undefined,
    repoRoot: () => undefined,
    repoUrl: () => undefined,
    hash: () => null,
    checkRefs: () => null,
    bearerToken: () => token,
  };
}

function json(body: unknown, status: number, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Records the MCP client identity announced in the `initialize` JSON-RPC
 * message. The SDK handles `initialize` before any tool callback runs, so
 * the captured `clientInfo` only lives in the body we are about to discard.
 *
 * Best-effort: a missing name, a malformed body, or a database failure must
 * not break the request. The worst case is the briefing coming back without
 * the client-specific note, which is acceptable.
 */
async function captureClientInfo(token: string, body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  const method = (body as { method?: unknown }).method;
  if (method !== "initialize") return;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object") return;
  const info = normalise(
    (params as { clientInfo?: { name?: unknown; version?: unknown } }).clientInfo ?? {},
  );
  if (!info) return;
  try {
    await record(token, info);
  } catch (e) {
    console.error("mcp clientInfo", e);
  }
}

/**
 * Deliberately no `WWW-Authenticate` with `resource_metadata`: that header is
 * what makes a client go looking for an OAuth authorisation server, and this
 * one is a pasted bearer token.
 */
const unauthorised = (error: string) =>
  json({ jsonrpc: "2.0", error: { code: -32001, message: error } }, 401);

/**
 * The error boundary, and nothing else.
 *
 * Authentication and rate limiting used to run above every `try` in this file,
 * where a database that was down threw straight out of the handler: no log line
 * of ours, and the framework's own HTML 500 handed to a client that only parses
 * JSON-RPC. Keeping the work in its own function puts all of it inside one
 * catch without indenting the whole route a level.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    return await answer(req);
  } catch (e) {
    console.error("mcp", e);
    return json(
      { jsonrpc: "2.0", error: { code: -32603, message: "the server could not complete that call" } },
      500,
    );
  }
}

async function answer(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);

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

  // Fires-and-forgets the clientInfo capture, then awaits it before the MCP
  // server processes the body. Awaiting (not just calling) keeps the request
  // bound to the record attempt, which is what a `console.error` from the
  // helper then belongs to.
  await captureClientInfo(token, body);

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
      return await invoke({ userId: user.id, token }, method, params);
    } catch (e) {
      // Things the agent can act on keep their real message. Ownership
      // failures must not say whether the id exists for somebody else, and
      // `NotYours` is already worded for that.
      if (e instanceof BadRequest || e instanceof NotYours) throw e;
      console.error("mcp", method, e);
      throw new Error("the server could not complete that call");
    }
  };

  registerTools(server, safeInvoke, buildRemoteWorkspace(token));

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
