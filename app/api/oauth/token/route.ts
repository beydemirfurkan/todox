import { clientIp } from "@/lib/server/client-ip";
import { logError } from "@/lib/server/log";
import { oauthError, oauthJson, preflight, readParams } from "@/lib/server/oauth-http";
import { exchangeCode, refreshGrant, type TokenResult } from "@/lib/services/oauth-server";
import * as limit from "@/lib/services/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const answer = (result: TokenResult): Response =>
  result.ok ? oauthJson(result.body) : oauthError(result.status, result.error, result.description);

/** The token endpoint: a code for a grant, or a refresh token for the next access token. */
export async function POST(req: Request): Promise<Response> {
  const gate = await limit.consume("oauthTokenPerIp", clientIp(req.headers));
  if (!gate.allowed)
    return oauthJson(
      { error: "slow_down", error_description: "too many token requests from this address" },
      429,
      { "retry-after": String(gate.retryAfterSec) },
    );

  let params: Record<string, string>;
  try {
    params = await readParams(req);
  } catch (error) {
    logError("oauth.token.badBody", error);
    return oauthError(400, "invalid_request", "the body could not be read");
  }

  const clientId = params.client_id ?? "";
  if (!clientId) return oauthError(400, "invalid_request", "client_id is required");

  if (params.grant_type === "authorization_code") {
    if (!params.code || !params.code_verifier || !params.redirect_uri)
      return oauthError(400, "invalid_request", "code, code_verifier and redirect_uri are required");
    return answer(
      await exchangeCode({
        code: params.code,
        code_verifier: params.code_verifier,
        client_id: clientId,
        redirect_uri: params.redirect_uri,
        resource: params.resource,
        device_name: params.device_name,
      }),
    );
  }
  if (params.grant_type === "refresh_token") {
    if (!params.refresh_token) return oauthError(400, "invalid_request", "refresh_token is required");
    return answer(await refreshGrant({ refresh_token: params.refresh_token, client_id: clientId }));
  }
  return oauthError(400, "unsupported_grant_type", "authorization_code or refresh_token");
}

export const OPTIONS = preflight;
