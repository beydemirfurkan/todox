import { siteBase } from "@/lib/server/site-base";
import { oauthJson, preflight } from "@/lib/server/oauth-http";
import { protectedResourceMetadata } from "@/lib/services/oauth-rules";

export const dynamic = "force-dynamic";

/** RFC 9728, path-specific: the address `/api/mcp` names in its 401. */
export const GET = (req: Request): Response => oauthJson(protectedResourceMetadata(siteBase(req.headers)));
export const OPTIONS = preflight;
