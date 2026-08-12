import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Read JSON if it exists, null if it does not. Caller decides what to merge.
 *
 * Only a missing file is "not configured". Unparseable JSON throws, because
 * the caller's next move is to write the file back: answering null for a
 * config the user had hand-edited into invalid JSON would overwrite every
 * other MCP server they had configured there.
 */
export async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Write to `<file>.tmp` then rename. Two installers racing still produce a
 * whole file -- one rename wins, the other retries. A true
 * read-modify-write lock is out of scope: installations are user-initiated
 * and serial in practice, and the alternative (a `proper-lockfile` dep) is
 * not worth its weight for a CLI.
 */
export async function writeJsonFile(p: string, value: unknown): Promise<void> {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  // Random, not `Date.now()`: two writes from the same process land in the
  // same millisecond, so the temporary names collided, both wrote to one
  // file, and the second rename failed with ENOENT because the first had
  // already moved it away.
  const tmp = `${p}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const data = JSON.stringify(value, null, 2);
  await fs.writeFile(tmp, data, { encoding: "utf8" });
  await renameWhenDestinationIsFree(tmp, p);
}

/** Windows sharing violations. POSIX renames do not report these. */
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Rename, waiting out the moments the destination is held open.
 *
 * Windows refuses a rename with EPERM while anything else has the destination
 * open, even briefly -- the other writer mid-replace, or an antivirus scanner
 * reading the file it just watched appear. The window is milliseconds, so
 * backing off and asking again turns a hard failure into a short wait. Codes
 * that are not that, and anything still failing on the last attempt, are
 * thrown for the CLI to show the user.
 */
async function renameWhenDestinationIsFree(from: string, to: string): Promise<void> {
  const lastAttempt = 5;
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (attempt >= lastAttempt || !TRANSIENT_RENAME_CODES.has(code)) throw e;
      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }
}
