import { clientIp } from "@/lib/server/client-ip";
import { logError } from "@/lib/server/log";
import { oauthError, oauthJson, preflight } from "@/lib/server/oauth-http";
import { registerClient } from "@/lib/services/oauth-server";
import * as limit from "@/lib/services/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dynamic Client Registration (RFC 7591). The 2026 MCP spec deprecates it in
 * favour of metadata documents, but Cursor and older SDKs still register
 * this way, and a client that cannot register cannot connect at all.
 */
export async function POST(req: Request): Promise<Response> {
  const gate = await limit.consume("clientRegisterPerIp", clientIp(req.headers));
  if (!gate.allowed)
    return oauthJson(
      { error: "slow_down", error_description: "too many registrations from this address" },
      429,
      { "retry-after": String(gate.retryAfterSec) },
    );

  let body: unknown;
  try {
    body = await req.json();
  } catch (error) {
    logError("oauth.register.badBody", error);
    return oauthError(400, "invalid_client_metadata", "the body must be JSON");
  }
  const client = await registerClient(body);
  if (!client)
    return oauthError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must list 1-10 https, loopback http or app-scheme URIs",
    );
  return oauthJson(
    {
      client_id: client.client_id,
      client_id_issued_at: Math.floor(Date.parse(client.created_at) / 1000),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
}

export const OPTIONS = preflight;
