import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

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
 */
export function findProjectRoot(start: string): string {
  let dir = asDirectory(start);
  for (let i = 0; i < 40; i++) {
    if (ROOT_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return asDirectory(start);
}

export type RefLike = { id: number; path: string; hash: string | null };
export type Checked = RefLike & { status: "fresh" | "changed" | "missing" | "unknown" };

/** Compare what was recorded when the note was written against what is there now. */
export function checkRefs(refs: RefLike[]): { checked: Checked[]; seen: { id: number; hash: string | null }[] } {
  const checked: Checked[] = [];
  const seen: { id: number; hash: string | null }[] = [];

  for (const r of refs) {
    const hash = hashFile(r.path);
    seen.push({ id: r.id, hash });
    checked.push({
      ...r,
      status: !r.hash ? "unknown" : hash === null ? "missing" : hash === r.hash ? "fresh" : "changed",
    });
  }
  return { checked, seen };
}
