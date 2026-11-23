import { siteBase } from "@/lib/server/site-base";
import { oauthJson, preflight } from "@/lib/server/oauth-http";
import { authorizationServerMetadata } from "@/lib/services/oauth-rules";

export const dynamic = "force-dynamic";

/** RFC 8414: the endpoints a client needs to get a token for `/api/mcp`. */
export const GET = (req: Request): Response => oauthJson(authorizationServerMetadata(siteBase(req.headers)));
export const OPTIONS = preflight;
