import { all, run } from "../db/client";
import { now } from "../util/time";

/**
 * Which tools an agent reached for, counted rather than logged.
 *
 * One table, no cross-table logic. The write is a single upsert on a bucket
 * that already identifies itself, so there is nothing here for a service to
 * sequence.
 */

/**
 * The SQL, named so a test with no database can read it.
 *
 * `pnpm test` runs without one, so the shape of these strings is the only thing
 * CI checks on every push -- and shape is where the expensive mistakes live: a
 * missing conflict target turns every call into a new row, and an `EXCLUDED`
 * referenced on the wrong side turns a counter into a constant.
 */
export const QUERIES = {
  /**
   * One row per account per method per day.
   *
   * `calls` counts from the row rather than from `EXCLUDED`, because the
   * incoming row always carries 1 and the point is the running total. `errors`
   * counts from `EXCLUDED`, because the incoming row is the only thing that
   * knows whether *this* call failed.
   *
   * `first_at` is deliberately absent from the update: it is when the day's
   * first call landed, and overwriting it would make every bucket look like it
   * began at its last call.
   */
  record: `INSERT INTO tool_usage (user_id, method, day, calls, errors, first_at, last_at)
           VALUES (?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT (user_id, method, day) DO UPDATE
              SET calls   = tool_usage.calls + 1,
                  errors  = tool_usage.errors + EXCLUDED.errors,
                  last_at = EXCLUDED.last_at`,

  /**
   * What every account called inside a window.
   *
   * Grouped rather than listed: the question is always "how much of what", and
   * a per-day breakdown is a second call for whoever actually wants one.
   */
  since: `SELECT user_id, method,
                 sum(calls)  AS calls,
                 sum(errors) AS errors,
                 min(first_at) AS first_at,
                 max(last_at)  AS last_at
            FROM tool_usage
           WHERE day >= ?
           GROUP BY user_id, method
           ORDER BY user_id, calls DESC`,
} as const;

export type UsageRow = {
  user_id: number;
  method: string;
  calls: number;
  errors: number;
  first_at: string;
  last_at: string;
};

/**
 * Count one call. Never throws, and that is the contract the caller relies on.
 *
 * This runs inside every agent tool call, so a measurement that fails has to
 * fail quietly: a table that does not exist yet, a database that refused, a
 * column added in a migration nobody has run -- none of those are reasons to
 * break work that had nothing to do with being measured.
 */
export async function record(userId: number, method: string, ok: boolean): Promise<void> {
  const at = now();
  try {
    await run(QUERIES.record, [userId, method, at.slice(0, 10), ok ? 0 : 1, at, at]);
  } catch {
    // Deliberately silent. See above: the caller is somebody else's work.
  }
}

/** Everything counted on or after `day`, which is an ISO date. */
export const since = (day: string) => all<UsageRow>(QUERIES.since, [day]);
