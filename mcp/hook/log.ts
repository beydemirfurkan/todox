import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a hook says what went wrong, since it must never say it to the session.
 *
 * Every hook fails open: todox being down, a token missing or a slow network
 * must cost the developer nothing, so a failure prints nothing and exits 0.
 * That makes a log the only place a broken hook is visible at all -- the
 * observer lesson from task #174, where a carrier that swallowed its errors
 * stayed broken for months. One line per event: the hook, what it was doing,
 * and the error message. Never the token, never a body, never a path the
 * developer did not already put in the message.
 *
 * Bounded by rotation rather than growth: past `MAX_BYTES` the file becomes
 * `hook.log.1` (replacing the one before), so it costs at most twice that.
 */
const MAX_BYTES = 64 * 1024;

export type Logger = (event: string, message: string) => void;

export function fileLogger(dataDir: string): Logger {
  const path = join(dataDir, "hook.log");
  return (event, message) => {
    try {
      mkdirSync(dataDir, { recursive: true });
      rotateIfFull(path);
      appendFileSync(path, `${new Date().toISOString()} ${event} ${oneLine(message)}\n`);
    } catch (e) {
      // The last resort, and still not silent: stderr from a hook is shown to
      // the developer in verbose mode and never to the model.
      process.stderr.write(`todox hook: cannot write ${path}: ${(e as Error).message}\n`);
    }
  };
}

function rotateIfFull(path: string): void {
  if (existsSync(path) && statSync(path).size >= MAX_BYTES) renameSync(path, `${path}.1`);
}

const oneLine = (message: string) => message.replace(/\s+/g, " ").slice(0, 500);
