import { logError } from "@/lib/server/log";
import { oauthError, preflight, readParams } from "@/lib/server/oauth-http";
import { revokeToken } from "@/lib/services/oauth-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RFC 7009. 200 whether or not the token was known: a revocation endpoint
 * that said "no such token" would be an oracle for which ones exist. A
 * failure on our side is a 503, never a 200 -- a client that believes its
 * token is dead when it is not is the one outcome worse than an error.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const params = await readParams(req);
    await revokeToken(params.token ?? "");
  } catch (error) {
    logError("oauth.revoke", error);
    return oauthError(503, "temporarily_unavailable", "the token could not be revoked; try again");
  }
  return new Response(null, {
    status: 200,
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
  });
}

export const OPTIONS = preflight;
