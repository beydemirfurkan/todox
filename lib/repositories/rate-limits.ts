import { one, run } from "../db/client";
import { now } from "../util/time";

export type Window = { count: number; reset_at: string };

/**
 * Fixed-window counter, incremented atomically. The UPSERT resets an expired
 * window in the same statement, so two simultaneous requests cannot both see a
 * stale window and both start a fresh one. RETURNING saves a second round trip.
 */
export async function bump(bucket: string, windowMs: number): Promise<Window> {
  const nowIso = now();
  const resetAt = new Date(Date.now() + windowMs).toISOString();

  const row = await one<Window>(
    `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT (bucket) DO UPDATE SET
       count    = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= ? THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [bucket, resetAt, nowIso, nowIso],
  );
  return row!;
}

/** Read without counting -- used to reject before doing any expensive work. */
export const peek = (bucket: string) =>
  one<Window>(
    "SELECT count, reset_at FROM rate_limits WHERE bucket = ? AND reset_at > ?",
    [bucket, now()],
  );

export const clear = (bucket: string) =>
  run("DELETE FROM rate_limits WHERE bucket = ?", [bucket]);

export const purgeExpired = () =>
  run("DELETE FROM rate_limits WHERE reset_at <= ?", [now()]);
