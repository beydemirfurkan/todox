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

/**
 * Letters that carry no combining mark to strip, so NFD cannot reach them.
 * Turkish dotless ı is the one that matters here; the rest are cheap.
 */
const TRANSLITERATE: Record<string, string> = {
  ı: "i",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
};

export const SLUG_FALLBACK = "project";

/**
 * A URL-safe name, with accented letters folded rather than deleted.
 *
 * Stripping everything outside [a-z0-9] mangled exactly the language this app
 * defaults to: "Çiğdem" became "i-dem", "ışık" became "k", and "Öç" became the
 * empty string — which `/p/` cannot route to, so the project was unreachable
 * the moment it was created. NFD splits the accent off its base letter and the
 * combining mark is what gets dropped, leaving the letter behind.
 */
export function slugify(s: string) {
  const folded = s
    .toLowerCase()
    .replace(/[ıßæœøđðłþ]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize("NFD")
    // Combining diacritics: ğ, ü, ş, ö, ç, é … all decompose to letter + mark.
    .replace(/[̀-ͯ]/g, "");

  return folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    // A trailing dash can reappear after the slice.
    .replace(/-+$/, "");
}

/** Never empty, so the result is always something `/p/<slug>` can route to. */
export const slugifyOr = (s: string, fallback = SLUG_FALLBACK) =>
  slugify(s) || fallback;

/**
 * Paths arrive from the developer's machine, and that machine is often not the
 * one this code runs on. The server is Linux; the agent may be on Windows, in
 * which case every path it sends looks like `C:\Users\me\repo`. Treating those
 * as relative meant a Windows agent could never register a project from its
 * working directory — the one thing the tool is supposed to do without asking.
 */
const isWindowsPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p);

export const isAbsolutePath = (p: string) => p.startsWith("/") || isWindowsPath(p);

/** Backslashes folded to slashes and any trailing separator dropped. */
export const normalisePath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** The last segment of a path, whichever separator it was written with. */
export function lastSegment(p: string) {
  const parts = normalisePath(p).split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * Path containment on segment boundaries: "/src/todox-old" must not be treated
 * as living inside "/src/todox".
 *
 * Windows roots compare case-insensitively, because its filesystem does and an
 * agent reporting `c:\users\...` for a project registered as `C:\Users\...` is
 * reporting the same directory.
 */
export function isInside(child: string, root: string) {
  const fold = isWindowsPath(root);
  const norm = (p: string) => {
    const s = normalisePath(p);
    return fold ? s.toLowerCase() : s;
  };
  const c = norm(child);
  const r = norm(root);
  return c === r || c.startsWith(`${r}/`);
}
