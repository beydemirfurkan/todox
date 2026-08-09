import { randomBytes } from "node:crypto";

/**
 * Path handling for the server, which has no filesystem worth reading.
 *
 * Hashing files and locating a repository root used to live here and were
 * called from request handlers. That only made sense when the MCP server was
 * the same process as the database; on a web host there is no checkout, so
 * both silently returned nonsense -- and both turned a caller-supplied path
 * into a real `readFileSync`/`existsSync`. They now live in `mcp/workspace.ts`,
 * on the machine that actually holds the code. Nothing here touches disk.
 */

export function shareToken() {
  // Matches the 32 bytes used for sessions and API tokens; there is no reason
  // for the share link to be the weakest secret in the app.
  return randomBytes(32).toString("base64url");
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Path containment on segment boundaries: "/src/todox-old" must not be treated
 * as living inside "/src/todox".
 */
export function isInside(child: string, root: string) {
  const r = root.replace(/\/+$/, "");
  return child === r || child.startsWith(`${r}/`);
}
