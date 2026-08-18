/**
 * Which MCP client is on the other end, as a value rather than as a lookup.
 *
 * Split out of `lib/server/client-info.ts`, which stores and reads this in
 * Postgres. Everything here is pure, and that matters for more than tidiness:
 * `mcp/tools.ts` is shared by both transports and the stdio process has no
 * database, so importing the storage module into the tool surface pulled a
 * Postgres driver into a program that can never use one.
 */

export type ClientInfo = {
  name: string;
  version: string;
  capturedAt: number;
};

/** Coerce an unknown clientInfo payload into a usable record, or null. */
export function normalise(raw: { name?: unknown; version?: unknown }): ClientInfo | null {
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    version: typeof raw.version === "string" ? raw.version : "unknown",
    capturedAt: Date.now(),
  };
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
