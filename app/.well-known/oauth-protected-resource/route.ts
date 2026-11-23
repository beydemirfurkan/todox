import { publicUrl } from "@/lib/public-url";
import { oauthJson, preflight } from "@/lib/server/oauth-http";
import { protectedResourceMetadata } from "@/lib/services/oauth-rules";

export const dynamic = "force-dynamic";

/**
 * RFC 9728 at the root. The path-specific copy beside it is the one `/api/mcp`
 * names in its 401; this one is for a client that tries the root first.
 */
export const GET = (): Response => oauthJson(protectedResourceMetadata(publicUrl()));
export const OPTIONS = preflight;
