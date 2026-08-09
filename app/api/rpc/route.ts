import { NextResponse, type NextRequest } from "next/server";

import { userForApiToken } from "@/lib/services/auth";
import { BadRequest } from "@/lib/services/errors";
import { NotYours } from "@/lib/services/ownership";
import * as limit from "@/lib/services/rate-limit";
import { invoke } from "@/lib/services/rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The endpoint the MCP server talks to. Bearer token in, one method call out.
 *
 * Deliberately not a REST sprawl: the method list is the agent's tool list,
 * and keeping them one-to-one means there is nothing to keep in sync.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return fail(401, "missing bearer token");

  // Tokens are long random strings, but nothing should be free to brute force.
  const gate = await limit.check("badTokenPerIp", ip);
  if (!gate.allowed)
    return NextResponse.json(
      { ok: false, error: "too many failed authentications" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSec) } },
    );

  const user = await userForApiToken(token);
  if (!user) {
    await limit.penalise("badTokenPerIp", ip);
    return fail(401, "invalid or revoked token");
  }

  let payload: { method?: unknown; params?: unknown };
  try {
    payload = await req.json();
  } catch {
    return fail(400, "body must be JSON");
  }
  if (typeof payload.method !== "string") return fail(400, "method must be a string");

  try {
    const result = await invoke({ userId: user.id }, payload.method, payload.params);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    // Ownership failures are the caller's problem, not a server fault, and
    // they must not reveal whether the id exists for somebody else.
    if (e instanceof NotYours) return fail(404, e.message);

    // Things the agent can fix get the real message. Anything else is ours:
    // returning the raw text handed a caller Postgres' own parse errors, which
    // is exactly the feedback loop you want when probing a query.
    if (e instanceof BadRequest) return fail(400, e.message);

    console.error("rpc", payload.method, e);
    return fail(500, "the server could not complete that call");
  }
}

const fail = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });
