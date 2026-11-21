import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

/**
 * What one Claude Code session has done, as far as the plugin's hooks saw.
 *
 * One JSON object per line, append-only, one file per session id. Append-only
 * because Claude Code runs tool calls in parallel and fires a PostToolUse hook
 * for each: two processes rewriting one JSON document lose a write, two
 * appends of a short line do not. Nothing in here is sent anywhere; it is how
 * the Stop hook knows whether this session edited files and which tasks it
 * touched, without reading the transcript.
 */
export type SessionEvent =
  | { t: "start"; at: string; head?: string }
  | { t: "edit"; at: string }
  | { t: "task"; at: string; id: number }
  | { t: "blocked"; at: string }
  | { t: "nudged"; at: string }
  | { t: "optout"; at: string }
  | { t: "observed"; at: string; head?: string; dirty?: number };

/** Kept a week: long enough for a resumed session, short enough to never matter. */
const KEEP_DAYS = 7;

export function sessionPath(dataDir: string, sessionId: string): string {
  // A session id is Claude Code's own, but it becomes a file name here, so
  // anything that is not plainly an id character is folded away.
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) || "unknown";
  return join(dataDir, "sessions", `${safe}.jsonl`);
}

export function appendEvent(dataDir: string, sessionId: string, event: SessionEvent): void {
  const path = sessionPath(dataDir, sessionId);
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

/** Every event of the session, oldest first; a torn last line is skipped. */
export function readEvents(dataDir: string, sessionId: string): SessionEvent[] {
  const path = sessionPath(dataDir, sessionId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => JSON.parse(line) as SessionEvent);
}

/** Removes session files untouched for `KEEP_DAYS`. Returns how many went. */
export function pruneSessions(dataDir: string, nowMs = Date.now()): number {
  const dir = join(dataDir, "sessions");
  if (!existsSync(dir)) return 0;
  const cutoff = nowMs - KEEP_DAYS * 86_400_000;
  let removed = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).mtimeMs >= cutoff) continue;
    unlinkSync(path);
    removed++;
  }
  return removed;
}
