/**
 * DB-backed record of the last MCP client to use a given token. Three columns
 * on `api_tokens` -- last_client_name, last_client_version,
 * last_client_seen_at -- keyed on the existing unique token_hash.
 *
 * In the database rather than in memory, because a Map only survives as long as
 * the process: a deploy, a restart or a second replica loses it, and the answer
 * would then depend on which instance the agent happened to reach.
 *
 * Only the write lives here. The read rides on the row every authenticated
 * call already fetches (`api-tokens.userForToken`), so `get_context` no longer
 * spends a second query on three columns the first had just passed over. The
 * shape and the family mapping are pure and live in `lib/client-identity.ts`,
 * because `mcp/tools.ts` needs them on a side that has no database.
 */

import type { ClientInfo } from "../client-identity";
import { recordClientUse, type ClientUse } from "../repositories/api-tokens";
import { hashToken } from "../util/tokens";

export async function record(token: string, info: ClientInfo): Promise<void> {
  await recordClientUse(hashToken(token), {
    name: info.name,
    version: info.version,
    seenAt: new Date(info.capturedAt).toISOString(),
  });
}

/**
 * How long after a token is minted the briefing keeps naming the memory file.
 *
 * The notes exist for one moment: an agent that has just been connected and
 * does not yet have the habit written down anywhere. After that they are the
 * same paragraph in every briefing, and production on 2026-09-12 showed what
 * that is worth -- two accounts had read "put the snippet in ~/.claude/CLAUDE.md"
 * at the top of every session for a month, five hundred characters a time,
 * whether or not the snippet was already there. The server cannot see the
 * file, so the token's age is the nearest honest proxy for "still setting up".
 *
 * A week rather than the day of minting: a token made on Friday and connected
 * on Monday is still being set up, and the cost of a week is a few sessions of
 * one paragraph.
 *
 * Not `TokenUse`'s "first", which looks like the obvious signal and cannot be
 * one here: on the hosted transport every POST authenticates, and it is the
 * session's `initialize` that flips a token from first to same-day, so the
 * `get_context` that follows would never see it.
 */
export const SETUP_WINDOW_DAYS = 7;

/**
 * The client to give setup advice to, or null: nothing was ever recorded, the
 * record cannot be read, or the token is past the window and the advice is no
 * longer news. `appendClientNotes` reads null as "say nothing".
 */
export function clientDuringSetup(
  identity: { createdAt: string; client: ClientUse | null },
  now: () => number = Date.now,
): ClientInfo | null {
  if (!identity.client) return null;
  const minted = Date.parse(identity.createdAt);
  if (!Number.isFinite(minted)) return null;
  if (now() - minted > SETUP_WINDOW_DAYS * 86_400_000) return null;
  const seenAt = Date.parse(identity.client.seenAt);
  if (!Number.isFinite(seenAt)) return null;
  return { name: identity.client.name, version: identity.client.version, capturedAt: seenAt };
}
