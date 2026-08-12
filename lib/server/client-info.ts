/**
 * DB-backed record of the last MCP client to use a given token. Three columns
 * on `api_tokens` -- last_client_name, last_client_version,
 * last_client_seen_at -- keyed on the existing unique token_hash.
 *
 * Serverless-safe: a Vercel cold start resets any in-memory Map, but Postgres
 * is shared by every instance. The trade-off is a round-trip per request on
 * the `get_context` path; acceptable because that is also the path that needs
 * the data.
 */

import { lastClientUse, recordClientUse } from "../repositories/api-tokens";
import { hashToken } from "../util/tokens";

export type ClientInfo = {
  name: string;
  version: string;
  capturedAt: number;
};

const TTL_MS = 60 * 60 * 1000; // one hour; longer than any realistic session

/** Coerce an unknown clientInfo payload into a usable record, or null. */
export function normalise(raw: { name?: unknown; version?: unknown }): ClientInfo | null {
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "unknown",
    capturedAt: Date.now(),
  };
}

export async function record(token: string, info: ClientInfo): Promise<void> {
  await recordClientUse(hashToken(token), {
    name: info.name,
    version: info.version,
    seenAt: new Date(info.capturedAt).toISOString(),
  });
}

export async function lookup(token: string): Promise<ClientInfo | null> {
  const use = await lastClientUse(hashToken(token));
  if (!use) return null;
  const seenAt = Date.parse(use.seenAt);
  if (!Number.isFinite(seenAt)) return null;
  if (Date.now() - seenAt > TTL_MS) return null;
  return { name: use.name, version: use.version, capturedAt: seenAt };
}

export type ClientFamily =
  | "claude-code"
  | "codex"
  | "cursor"
  | "vscode"
  | "opencode"
  | "unknown";

/**
 * Map a captured client name onto a client family. Loose on purpose -- a new
 * Claude Code build that announces itself as "claude-code-experimental" still
 * routes to the same advice.
 */
export function clientFamily(name: string): ClientFamily {
  const n = name.toLowerCase();
  if (n.includes("claude")) return "claude-code";
  if (n.includes("codex")) return "codex";
  if (n.includes("cursor")) return "cursor";
  if (n.includes("vscode") || n.includes("copilot")) return "vscode";
  if (n.includes("opencode")) return "opencode";
  return "unknown";
}
