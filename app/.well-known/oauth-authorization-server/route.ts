import { publicUrl } from "@/lib/public-url";
import { oauthJson, preflight } from "@/lib/server/oauth-http";
import { authorizationServerMetadata } from "@/lib/services/oauth-rules";

export const dynamic = "force-dynamic";

/** RFC 8414: the endpoints a client needs to get a token for `/api/mcp`. */
export const GET = (): Response => oauthJson(authorizationServerMetadata(publicUrl()));
export const OPTIONS = preflight;
