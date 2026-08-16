import { one } from "@/lib/db/client";
import { logError } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A check that has not answered in five seconds has answered. */
export const maxDuration = 10;

/**
 * Whether this container can actually serve a request.
 *
 * The Docker healthcheck used to fetch `/login`, which renders a React page
 * and touches nothing else -- so a container whose database was unreachable
 * reported itself healthy for as long as it kept serving HTML, which is
 * exactly the window where restarting it or holding a deploy would have
 * helped. Liveness that does not reach the dependency is a check that only
 * ever passes.
 *
 * `SELECT 1` and no more: it proves a connection can be taken from the pool
 * and a statement can round-trip, without depending on any table's contents.
 *
 * Deliberately unauthenticated -- the runtime has no token -- so the body says
 * only whether it worked. Which host, which database, which version and what
 * the driver said are all things an unauthenticated caller does not learn
 * here; the detail goes to the log instead, where it is already keyed by
 * request id.
 */
export async function GET() {
  try {
    await one<{ ok: number }>("SELECT 1 AS ok");
    return Response.json({ ok: true }, { status: 200 });
  } catch (e) {
    logError("health.database", e);
    // 503, not 500: this is "not ready to take traffic", which is what an
    // orchestrator, a load balancer and a deploy gate all act on.
    return Response.json({ ok: false }, { status: 503 });
  }
}
