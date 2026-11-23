import { publicUrl } from "@/lib/public-url";
import { oauthJson, preflight } from "@/lib/server/oauth-http";
import { protectedResourceMetadata } from "@/lib/services/oauth-rules";

export const dynamic = "force-dynamic";

/** RFC 9728, path-specific: the address `/api/mcp` names in its 401. */
export const GET = (): Response => oauthJson(protectedResourceMetadata(publicUrl()));
export const OPTIONS = preflight;
