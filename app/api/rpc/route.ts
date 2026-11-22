import { NextResponse, type NextRequest } from "next/server";

import { bodyTooLarge, MAX_BODY_BYTES } from "@/lib/server/body-size";
import { bearerToken } from "@/lib/server/bearer";
import { clientIp } from "@/lib/server/client-ip";
import { logError, logWarn, newRequestId } from "@/lib/server/log";
import { metered, serverTiming } from "@/lib/db/client";
import { userForApiToken } from "@/lib/services/auth";
import { BadRequest, refusalReason, TooSlow } from "@/lib/services/errors";
import { NotYours } from "@/lib/services/ownership";
import * as limit from "@/lib/services/rate-limit";
import { CARRIERS, invoke, type Carrier } from "@/lib/services/rpc";

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

    const token = bearerToken(req.headers);
    if (!token) return fail(401, "missing bearer token", requestId);

    // Tokens are long random strings, but nothing should be free to brute force.
    // The lookup rides alongside the gate; its answer is ignored until the
    // gate has allowed the call. One round trip instead of two.
    const [gate, user] = await Promise.all([limit.check("badTokenPerIp", ip), userForApiToken(token)]);
    if (!gate.allowed)
      return NextResponse.json(
        { ok: false, error: "too many failed authentications" },
        { status: 429, headers: { "retry-after": String(gate.retryAfterSec), ...idHeader(requestId) } },
      );

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
    const name = payload.method;

    const { result, meter } = await metered(() =>
      invoke({ userId: user.id, token, ...carrierOf(req.headers) }, name, payload.params),
    );
    return NextResponse.json(
      { ok: true, result },
      { headers: { ...idHeader(requestId), "server-timing": serverTiming(meter) } },
    );
  } catch (e) {
    // Ownership failures are the caller's problem, not a server fault, and
    // they must not reveal whether the id exists for somebody else.
    if (e instanceof NotYours) {
      logWarn("rpc.refused", { method: methodName(method), reason: refusalReason(e), requestId });
      return fail(404, e.message, requestId);
    }

    // A statement that ran out of time. 504 rather than 500 so a dashboard can
    // tell "we are broken" from "that question was too big", and so an HTTP
    // retry layer that treats every 500 as transient does not sit in a loop
    // asking the same unanswerable question.
    if (e instanceof TooSlow) return fail(504, e.message, requestId);

    // Things the agent can fix get the real message. Anything else is ours:
    // returning the raw text handed a caller Postgres' own parse errors, which
    // is exactly the feedback loop you want when probing a query.
    if (e instanceof BadRequest) {
      // The reason, never the message: it names paths and ids.
      logWarn("rpc.refused", { method: methodName(method), reason: refusalReason(e), requestId });
      return fail(400, e.message, requestId);
    }

    // The method, never the params: those are the task bodies and the notes.
    logError("rpc.failed", e, { requestId, method: methodName(method) });
    return fail(500, "the server could not complete that call", requestId);
  }
}

/** The method for a log line: the name if the body had one, null before the parse. */
const methodName = (method: unknown): string | null => (typeof method === "string" ? method : null);

/**
 * Echoed on every answer, so a report of "it returned 500" can name the exact
 * call rather than a minute of them.
 */
const idHeader = (requestId: string) => ({ "x-request-id": requestId });

const fail = (status: number, error: string, requestId: string) =>
  NextResponse.json({ ok: false, error }, { status, headers: idHeader(requestId) });

/**
 * A client-side hook says so in a header, and only the known values are taken:
 * anything else is an ordinary agent call. It changes nothing but the name the
 * call is counted under (`usageName`), so a caller that lies about it can only
 * hide its own calls from its own account's numbers.
 */
function carrierOf(headers: Headers): { carrier?: Carrier } {
  const claimed = headers.get("x-todox-carrier");
  const carrier = CARRIERS.find((c) => c === claimed);
  return carrier ? { carrier } : {};
}
