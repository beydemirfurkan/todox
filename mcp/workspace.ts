import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { isInside, isWindowsPath, scrubRemote } from "../lib/util/paths";

/**
 * The half of todox that needs a filesystem.
 *
 * This process runs where the developer's code is; the web server does not.
 * Everything that reads a path therefore belongs here, and the server is only
 * ever told the result. Keeping the split honest is what makes staleness work
 * at all — and it stops a caller-supplied path being a `readFileSync` on a
 * machine full of other people's data.
 */

const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

/** null means unreadable, which for our purposes means gone. */
export function hashFile(path: string): string | null {
  try {
    const stat = statSync(path);
    // Directories and device files are not notes about code. /dev/zero would
    // otherwise read until the process dies.
    if (!stat.isFile()) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function asDirectory(p: string) {
  try {
    return statSync(p).isDirectory() ? p : dirname(p);
  } catch {
    return dirname(p);
  }
}

/**
 * Walk up from a path looking for a project root marker, so an agent can hand
 * over any file it happens to be editing and still get the repository rather
 * than the folder the file sits in.
 *
 * `stopAt` bounds the walk to a subtree. Nothing in the product passes it: a
 * developer's checkout really can be anywhere. It exists because a test cannot
 * make claims about the fallback otherwise -- the machine running it owns every
 * directory above the sandbox, and a stray `package.json` in one of them (this
 * happens in `%TEMP%`) is the function working, not failing.
 */
export function findProjectRoot(start: string, stopAt?: string): string {
  let dir = asDirectory(start);
  for (let i = 0; i < 40; i++) {
    if (ROOT_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const up = dirname(dir);
    if (up === dir || (stopAt && !isInside(up, stopAt))) break;
    dir = up;
  }
  return asDirectory(start);
}

/**
 * The repository's remote, which is the one name it has on every machine.
 *
 * Reading `.git/config` by hand would mean parsing includes, conditional
 * includes and insteadOf rewrites; `git` already does that correctly, so this
 * asks it. `execFileSync` with an argument array and no shell, because `dir`
 * comes from the caller -- a path with a semicolon in it is a directory name
 * here, not a second command. The timeout is there because a remote on a dead
 * network mount can hang, and a hung `get_context` is worse than one that
 * degrades to matching on the path.
 *
 * Returns undefined for anything that is not a checkout with an origin, which
 * the resolver treats as "no better identity than the path" rather than an
 * error.
 */
export function gitRemote(dir: string): string | undefined {
  if (!existsSync(join(dir, ".git"))) return undefined;
  try {
    const out = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const url = out.trim().split("\n")[0] ?? "";
    // Scrubbed here as well as on the server: this is the point where a token
    // sitting in one developer's git config would start travelling.
    return url ? scrubRemote(url) : undefined;
  } catch {
    return undefined;
  }
}

export type RefLike = { id: number; path: string; hash: string | null };
export type Checked = RefLike & { status: "fresh" | "changed" | "missing" | "unknown" };

/**
 * A path that was written on the developer's other computer.
 *
 * One project legitimately holds paths from two machines now, and a Windows
 * path cannot be read from a Mac. Hashing it returns null, which the rules
 * below would read as "the file was deleted" -- so the first briefing after a
 * merge would warn that every note written on the other machine is describing
 * code that is gone. It is not gone; it is somewhere this process cannot look.
 *
 * The same-platform case (two Macs, `/Users/a` vs `/Users/b`) is genuinely
 * indistinguishable from a deleted file, and is not covered.
 */
const onAnotherMachine = (path: string) => isWindowsPath(path) !== (process.platform === "win32");

/** Compare what was recorded when the note was written against what is there now. */
export function checkRefs(refs: RefLike[]): { checked: Checked[]; seen: { id: number; hash: string | null }[] } {
  const checked: Checked[] = [];
  const seen: { id: number; hash: string | null }[] = [];

  for (const r of refs) {
    // Left out of `seen` as well as marked unknown: reporting a null hash back
    // would overwrite what the machine that *can* read the file last saw.
    if (onAnotherMachine(r.path)) {
      checked.push({ ...r, status: "unknown" });
      continue;
    }
    const hash = hashFile(r.path);
    seen.push({ id: r.id, hash });
    checked.push({
      ...r,
      status: !r.hash ? "unknown" : hash === null ? "missing" : hash === r.hash ? "fresh" : "changed",
    });
  }
  return { checked, seen };
}
