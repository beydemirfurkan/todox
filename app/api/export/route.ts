import { clientIp } from "@/lib/server/client-ip";
import { logError, logInfo, newRequestId } from "@/lib/server/log";
import { currentUser } from "@/lib/session";
import { userForApiToken } from "@/lib/services/auth";
import { exportAccount, ExportTooLarge } from "@/lib/services/export";
import * as limit from "@/lib/services/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Your data, as a file.
 *
 * NOT AN MCP TOOL, deliberately. Every other capability here is one, and the
 * pattern is good — but a tool's result lands in the model's context, and this
 * one is the whole account. The successful case would be the failure: an agent
 * that called it would spend its window on a backup nobody asked it to read.
 *
 * A route serves both callers instead. A browser gets the button on the Account
 * page; an agent that genuinely wants to write the file — the stdio process has
 * a disk, which is the reason it exists — can fetch it with the same token it
 * already uses and never pass it through a model.
 *
 * Both ways in are accepted for that reason: the session cookie for the person,
 * a bearer token for the process acting for them.
 */
export async function GET(req: Request): Promise<Response> {
  const requestId = newRequestId();
  const headers = { "x-request-id": requestId };

  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    // The cookie first: a browser hitting this has no Authorization header, and
    // asking `userForApiToken("")` would be a lookup for nothing.
    const user = token ? await userForApiToken(token) : await currentUser();
    if (!user) {
      if (token) await limit.penalise("badTokenPerIp", clientIp(req.headers));
      return Response.json({ ok: false, error: "sign in, or send a token" }, { status: 401, headers });
    }

    // Its own policy rather than the agent one: this is the most expensive read
    // the app can be asked for, and nobody needs it more than a few times a day.
    const gate = await limit.consume("exportPerUser", String(user.id));
    if (!gate.allowed)
      return Response.json(
        { ok: false, error: "too many exports; try again shortly" },
        { status: 429, headers: { ...headers, "retry-after": String(gate.retryAfterSec) } },
      );

    const bundle = await exportAccount(user.id);
    logInfo("account.exported", { userId: user.id, requestId, ...bundle.counts });

    const stamp = bundle.exported_at.slice(0, 10);
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
        // Named so a folder full of them stays sortable, and marked as an
        // attachment so a browser saves it rather than rendering megabytes.
        "content-disposition": `attachment; filename="todox-export-${stamp}.json"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    // The one error worth telling the caller about: it is theirs to act on, and
    // the message says what to do about it.
    if (e instanceof ExportTooLarge)
      return Response.json({ ok: false, error: e.message }, { status: 413, headers });

    logError("export.failed", e, { requestId });
    return Response.json(
      { ok: false, error: "the server could not build that export" },
      { status: 500, headers },
    );
  }
}
