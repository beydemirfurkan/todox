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
 *
 * Two functions rather than one, and the difference is whether "I found
 * nothing" is sayable. `findProjectRoot` falls back to the directory it started
 * from, which is right for the observer and for asking git about a remote --
 * both want a directory to work in and can cope with a plain one. It is wrong
 * for the question "is this a repository at all", because the fallback answers
 * yes for every directory on the disk. That question now has its own function,
 * and registering a project is what asks it.
 */
export function projectRootOf(start: string, stopAt?: string): string | undefined {
  let dir = asDirectory(start);
  for (let i = 0; i < 40; i++) {
    if (ROOT_MARKERS.some((m) => existsSync(join(dir, m)))) return dir;
    const up = dirname(dir);
    if (up === dir || (stopAt && !isInside(up, stopAt))) break;
    dir = up;
  }
  return undefined;
}

export function findProjectRoot(start: string, stopAt?: string): string {
  return projectRootOf(start, stopAt) ?? asDirectory(start);
}

/**
 * One `git` call, and the only way anything here reaches the binary.
 *
 * `execFileSync` with an argument array and no shell, because `dir` comes from
 * the caller -- a path with a semicolon in it is a directory name here, not a
 * second command. The timeout is there because a repository on a dead network
 * mount can hang, and a hung tool call is worse than one that degrades.
 *
 * Returns undefined for anything that is not a checkout or any call git
 * refuses, which every caller reads as "I do not know". That distinction
 * matters more here than it looks: an empty string is a real answer (no
 * uncommitted files, no commits since the baseline) and undefined is the
 * absence of one, and a caller that conflates them reports zero where it
 * should report nothing.
 */
function git(dir: string, args: string[]): string | undefined {
  if (!existsSync(join(dir, ".git"))) return undefined;
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * The repository's remote, which is the one name it has on every machine.
 *
 * Reading `.git/config` by hand would mean parsing includes, conditional
 * includes and insteadOf rewrites; `git` already does that correctly, so this
 * asks it.
 *
 * Returns undefined for anything that is not a checkout with an origin, which
 * the resolver treats as "no better identity than the path" rather than an
 * error.
 */
export function gitRemote(dir: string): string | undefined {
  const url = git(dir, ["remote", "get-url", "origin"])?.split("\n")[0] ?? "";
  // Scrubbed here as well as on the server: this is the point where a token
  // sitting in one developer's git config would start travelling.
  return url ? scrubRemote(url) : undefined;
}

/**
 * The branch, or nothing when HEAD is detached.
 *
 * `branch --show-current` rather than `rev-parse --abbrev-ref HEAD`, and the
 * difference is not cosmetic: `rev-parse` fails outright in a repository with
 * no commits -- the state every `git init` starts in -- and answers the literal
 * string "HEAD" when detached, which would put a branch called HEAD in front
 * of a reader. This one answers the branch before the first commit and an
 * empty string when there is genuinely no branch to name.
 */
export const gitBranch = (dir: string): string | undefined =>
  git(dir, ["branch", "--show-current"]) || undefined;

/** Where HEAD is now. Undefined in a repository with no commits. */
export const gitHead = (dir: string): string | undefined =>
  git(dir, ["rev-parse", "HEAD"]) || undefined;

/** How many files carry uncommitted changes. */
export function gitDirtyCount(dir: string): number | undefined {
  const out = git(dir, ["status", "--porcelain"]);
  if (out === undefined) return undefined;
  return out ? out.split("\n").length : 0;
}

/** Subject lines carried per observation, and how much of each. */
const SUBJECTS = 3;
const SUBJECT_CHARS = 200;

/**
 * A commit id, and nothing git would read as something else.
 *
 * The baseline arrives from two places. One is git's own `rev-parse`, which
 * needs no checking. The other is the reply to `recordObservation` -- whatever
 * string an earlier client stored in `head_sha`, which the schema bounds only
 * by length -- and `base..HEAD` is built as a single argument, so a value
 * beginning with `-` reaches git as an option rather than a revision.
 *
 * That is not reachable today: `rev-list` runs first and rejects the unknown
 * option, so the call fails before `log` sees it. But the only thing standing
 * between that and `git log --output=<file>`, which does write the file, is
 * the order of two calls in the function below. This turns an accident into a
 * property. There is no shell to escape here and the value can only come from
 * the caller's own account, so this is not the injection the SET-clause rule
 * was written for -- it is the same shape, caught one step earlier and for one
 * line.
 *
 * Anything that is not a hex object id answers undefined, which every caller
 * already reads as "I do not know" rather than as zero.
 */
const COMMIT_ID = /^[0-9a-f]{4,64}$/i;

/**
 * What landed since a baseline commit.
 *
 * Two calls rather than one, because the count and the text want different
 * bounds: a session that lands two hundred commits should say two hundred, and
 * should not put two hundred subject lines in a briefing. Counting separately
 * also keeps the text call bounded, so a busy repository cannot overflow the
 * buffer and turn a real answer into undefined.
 *
 * `base..HEAD` is right even when the baseline is not an ancestor -- after a
 * branch switch it answers what is reachable from HEAD and not from there,
 * which is the honest reading of "new since I last looked". A baseline git
 * cannot find at all (rebased away, or recorded on another machine) is an
 * error rather than zero, because zero is a claim and this does not have one.
 */
export function gitCommitsSince(
  dir: string,
  base: string,
): { count: number; subjects: string[] } | undefined {
  if (!COMMIT_ID.test(base)) return undefined;

  const counted = git(dir, ["rev-list", "--count", `${base}..HEAD`]);
  if (counted === undefined) return undefined;

  const count = Number.parseInt(counted, 10);
  if (!Number.isFinite(count)) return undefined;

  const log = git(dir, ["log", "--format=%s", `--max-count=${SUBJECTS}`, `${base}..HEAD`]) ?? "";
  return {
    count,
    subjects: log
      ? log.split("\n").map((s) => s.slice(0, SUBJECT_CHARS))
      : [],
  };
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
