import { NextResponse, type NextRequest } from "next/server";

import { bodyTooLarge, MAX_BODY_BYTES } from "@/lib/server/body-size";
import { clientIp } from "@/lib/server/client-ip";
import { logError, newRequestId } from "@/lib/server/log";
import { userForApiToken } from "@/lib/services/auth";
import { BadRequest } from "@/lib/services/errors";
import { NotYours } from "@/lib/services/ownership";
import * as limit from "@/lib/services/rate-limit";
import { invoke } from "@/lib/services/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Matches the hosted MCP endpoint. Without it this route inherits the platform
// default, so a slow query holds a function open far longer than any agent is
// willing to wait for an answer.
export const maxDuration = 30;

/**
 * The endpoint the MCP server talks to. Bearer token in, one method call out.
 *
 * Deliberately not a REST sprawl: the method list is the agent's tool list,
 * and keeping them one-to-one means there is nothing to keep in sync.
 */
export async function POST(req: NextRequest) {
  // Named out here so the catch can say which call failed. Everything that
  // talks to the database is inside the try below -- authentication and rate
  // limiting used to sit above it, where a database that was down threw
  // straight out of the handler: no log line of ours, and the framework's own
  // 500 rather than the shape every client of this route parses.
  let method: unknown;
  const requestId = newRequestId();
  try {
    const ip = clientIp(req.headers);

    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail(401, "missing bearer token", requestId);

    // Tokens are long random strings, but nothing should be free to brute force.
    const gate = await limit.check("badTokenPerIp", ip);
    if (!gate.allowed)
      return NextResponse.json(
        { ok: false, error: "too many failed authentications" },
        { status: 429, headers: { "retry-after": String(gate.retryAfterSec), ...idHeader(requestId) } },
      );

    const user = await userForApiToken(token);
    if (!user) {
      await limit.penalise("badTokenPerIp", ip);
      return fail(401, "invalid or revoked token", requestId);
    }

    // A valid token bought unlimited calls until now. The subject is the token
    // rather than the account, so one runaway agent cannot lock the others out.
    const pace = await limit.consume("agentPerToken", token);
    if (!pace.allowed)
      return NextResponse.json(
        { ok: false, error: "too many calls; slow down" },
        { status: 429, headers: { "retry-after": String(pace.retryAfterSec), ...idHeader(requestId) } },
      );

    // Before the parse, because the parse is what costs. 413 rather than 400:
    // the request is well formed, there is just too much of it.
    if (bodyTooLarge(req.headers))
      return fail(413, `body must be under ${MAX_BODY_BYTES} bytes`, requestId);

    let payload: { method?: unknown; params?: unknown };
    try {
      payload = await req.json();
    } catch {
      return fail(400, "body must be JSON", requestId);
    }
    if (typeof payload.method !== "string") return fail(400, "method must be a string", requestId);
    method = payload.method;

    const result = await invoke({ userId: user.id, token }, payload.method, payload.params);
    return NextResponse.json({ ok: true, result }, { headers: idHeader(requestId) });
  } catch (e) {
    // Ownership failures are the caller's problem, not a server fault, and
    // they must not reveal whether the id exists for somebody else.
    if (e instanceof NotYours) return fail(404, e.message, requestId);

    // Things the agent can fix get the real message. Anything else is ours:
    // returning the raw text handed a caller Postgres' own parse errors, which
    // is exactly the feedback loop you want when probing a query.
    if (e instanceof BadRequest) return fail(400, e.message, requestId);

    // The method, never the params: those are the task bodies and the notes.
    logError("rpc.failed", e, {
      requestId,
      method: typeof method === "string" ? method : null,
    });
    return fail(500, "the server could not complete that call", requestId);
  }
}

/**
 * Echoed on every answer, so a report of "it returned 500" can name the exact
 * call rather than a minute of them.
 */
const idHeader = (requestId: string) => ({ "x-request-id": requestId });

const fail = (status: number, error: string, requestId: string) =>
  NextResponse.json({ ok: false, error }, { status, headers: idHeader(requestId) });
