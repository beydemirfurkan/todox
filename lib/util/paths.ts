import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

export function hashFile(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

export function shareToken() {
  return randomBytes(12).toString("base64url");
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function asDirectory(p: string) {
  return existsSync(p) && statSync(p).isDirectory() ? p : dirname(p);
}

/**
 * Walk up from a path looking for a project root marker. Lets an agent hand us
 * any file it happens to be editing and still get the repo, not the folder the
 * file lives in.
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

/**
 * Path containment on segment boundaries: "/src/todox-old" must not be treated
 * as living inside "/src/todox".
 */
export function isInside(child: string, root: string) {
  const r = root.replace(/\/+$/, "");
  return child === r || child.startsWith(`${r}/`);
}
