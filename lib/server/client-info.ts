/**
 * DB-backed record of the last MCP client to use a given token. Three columns
 * on `api_tokens` -- last_client_name, last_client_version,
 * last_client_seen_at -- keyed on the existing unique token_hash.
 *
 * In the database rather than in memory, because a Map only survives as long as
 * the process: a deploy, a restart or a second replica loses it, and the answer
 * would then depend on which instance the agent happened to reach. The
 * trade-off is a round-trip per request on the `get_context` path; acceptable
 * because that is also the path that needs the data.
 *
 * Only the storage lives here. The shape and the family mapping are pure and
 * live in `lib/client-identity.ts`, because `mcp/tools.ts` needs them on a side
 * that has no database.
 */

import type { ClientInfo } from "../client-identity";
import { lastClientUse, recordClientUse } from "../repositories/api-tokens";
import { hashToken } from "../util/tokens";

export async function record(token: string, info: ClientInfo): Promise<void> {
  await recordClientUse(hashToken(token), {
    name: info.name,
    version: info.version,
    seenAt: new Date(info.capturedAt).toISOString(),
  });
}

/**
 * Returns the last captured client for a token, or null when nothing has
 * ever been recorded. There is no TTL: HTTP re-records on every
 * `initialize` and the stdio process writes once at startup, so a stale
 * row is either the developer's actual current client or a token that
 * has been rotated -- both safe to surface, and rotating a token is what
 * clears the value the next time the new client calls in. A TTL silently
 * hid the notes from a long-running stdio session, which is the failure
 * mode this whole capture exists to close.
 */
export async function lookup(token: string): Promise<ClientInfo | null> {
  const use = await lastClientUse(hashToken(token));
  if (!use) return null;
  const seenAt = Date.parse(use.seenAt);
  if (!Number.isFinite(seenAt)) return null;
  return { name: use.name, version: use.version, capturedAt: seenAt };
}
