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
export const isWindowsPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p);

/**
 * Whether two paths were written on the same kind of machine.
 *
 * `C:/Users/me/repo` and `/Users/me/repo` cannot be the same directory, so a
 * project registered from one and a `cwd` arriving from the other are the same
 * repository on a second machine rather than two repositories. That is the only
 * thing this answers, and it is a hint -- the remote is the real identity.
 */
export const sameOsFamily = (a: string, b: string) =>
  isWindowsPath(a) === isWindowsPath(b);

export const isAbsolutePath = (p: string) => p.startsWith("/") || isWindowsPath(p);

/** Backslashes folded to slashes and any trailing separator dropped. */
export const normalisePath = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** The last segment of a path, whichever separator it was written with. */
export function lastSegment(p: string) {
  const parts = normalisePath(p).split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * A git remote as something a browser can open.
 *
 * `git remote get-url origin` answers in whichever form the clone used, and
 * the two common ones are not links: `git@github.com:me/repo.git` is an scp
 * address, and even the https form usually carries a `.git` nobody wants to
 * read. Credentials sometimes ride along in the userinfo, which must not end
 * up rendered on a page.
 *
 * Returns null when it is not something worth linking to, rather than guessing.
 */
export function repoLink(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;

  // scp-like: [user@]host:path — no scheme, and the colon is not a port.
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)([\w./~-]+?)(?:\.git)?\/?$/.exec(s);
  if (scp) return `https://${scp[1]}/${scp[2]}`;

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return null;
  // Anything in the userinfo is a credential, and this string gets rendered.
  url.username = "";
  url.password = "";
  url.pathname = url.pathname.replace(/\.git$/, "").replace(/\/$/, "");
  return url.pathname && url.pathname !== "/" ? url.toString() : null;
}

/** What to print for a repository: "github.com/me/repo", not the whole URL. */
export const repoLabel = (link: string) =>
  link.replace(/^https:\/\//, "").replace(/^www\./, "");

/**
 * The name a repository has on every machine: "github.com/me/repo", or null.
 *
 * A project used to be identified by its absolute path, which is a different
 * string on the next laptop -- so the same repo opened on a second machine
 * registered a second project and the log silently split in two. This is the
 * key that survives the move. `repoLink` already folds the scp form, the `.git`
 * suffix and any credential in the userinfo, so all that is left is case: git
 * hosts are case-insensitive about owner and repo, and a clone written
 * `github.com/Me/Repo` is the same place as `github.com/me/repo`.
 */
export const repoKey = (raw: string | null | undefined) => {
  const link = repoLink(raw);
  if (link) return repoLabel(link).toLowerCase();

  // `repoLink` answers "what can a browser open", so it returns null for
  // `ssh://` and `git://` remotes. Those are perfectly good identities -- they
  // are just not links -- and this is the comparison key, not something shown.
  const s = raw?.trim();
  if (!s) return null;
  const other =
    /^(?:ssh|git|git\+ssh):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(s);
  return other ? `${other[1]}/${other[2]}`.toLowerCase() : null;
};

/**
 * The remote with any embedded credential removed.
 *
 * `git remote get-url origin` answers with whatever the clone used, and that
 * can be `https://user:ghp_xxx@github.com/me/repo.git`. The MCP server now
 * reads and sends this automatically, so a token that used to sit in one
 * developer's git config would otherwise be stored in the database and copied
 * into any log that records a request body. `repoLink` strips userinfo, but
 * only at render time and only for URLs it is willing to link to.
 *
 * Anything unparseable is returned as-is: the raw form is what the developer
 * will recognise, and this is not the function that decides what is valid.
 */
export function scrubRemote(raw: string): string {
  const s = raw.trim();
  try {
    const url = new URL(s);
    if (!url.username && !url.password) return s;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return s;
  }
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

/**
 * The part of `child` below `root`, or null when it is not below it.
 *
 * The repo-relative path is the only name a file has that means the same thing
 * on two machines, which is the same argument `repo_url` wins on for projects:
 * `/Users/me/todox/lib/auth.ts` and `C:/work/todox/lib/auth.ts` are one file,
 * and `lib/auth.ts` is what they agree on.
 *
 * Cut from the *un-folded* string even when the comparison folded case, so a
 * Windows path comes back with the capitalisation it was stored with. Slicing
 * the lowercased copy would hand back a path that no longer matches the one on
 * disk, which is worse than not answering.
 */
export function relativeTo(child: string, root: string): string | null {
  if (!isInside(child, root)) return null;
  const c = normalisePath(child);
  const r = normalisePath(root);
  return c.length === r.length ? "" : c.slice(r.length + 1);
}
