import { all, one, run, type Statement } from "../db/client";
import type { BriefingObservation, NewObservation, Observation } from "../types";
import { ms, now } from "../util/time";

/**
 * What an agent did, as opposed to what an agent said it did.
 *
 * One table, no cross-table logic: an observation becoming an entry is a
 * two-table write, so it is sequenced in `lib/services/`, not here.
 */

/**
 * How long an observation lives if nobody promotes it.
 *
 * Long enough that a session on Monday can still read what Friday's did --
 * which is the gap this feature exists to close -- and short enough that
 * unverified material never accumulates into a second log. Everything here is
 * derived and re-derivable: the git history it describes is still in git.
 */
export const RETENTION_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export const expiryFrom = (at: string) =>
  new Date(ms(at) + RETENTION_DAYS * DAY_MS).toISOString();

/**
 * What the briefing selects. `id` is in it because an agent that reads an
 * observation and wants to act on it -- promote it, quote it in a handoff --
 * has to be able to name the row.
 *
 * `source` is deliberately NOT in it, and the column is still in the schema.
 * It exists to tell a reader which carrier saw a row, and there is exactly one
 * carrier: `recordObservation` has no `source` parameter, so every row ever
 * written says "stdio". A field with one possible value tells a reader nothing
 * and costs bytes in the payload every session opens with -- the same argument
 * the log's byte budget is built on. Put it back in the moment a second
 * carrier can write, and not before: a column carried without a reader is what
 * `repo_url` and `refs.context_id` both were.
 */
const COLUMNS = `id, client, branch, base_sha, head_sha, commits,
                 files_changed, commit_subjects, started_at, observed_at`;

/**
 * The SQL, named so it can be read by a test that has no database.
 *
 * `pnpm test` runs without one, so the shape of these strings is the only
 * thing CI checks on every push -- and shape is where the expensive mistakes
 * live: a dropped filter, a placeholder inside a literal, a missing conflict
 * target. Behaviour is proved against a real Postgres in `smoke:observe`.
 */
export const QUERIES = {
  /**
   * One row per session per project.
   *
   * `started_at` is deliberately absent from the update: it is when the
   * session opened, and overwriting it on every throttled write would make
   * every session look like it began at its last one.
   */
  record: `INSERT INTO observations
             (user_id, project_id, session_id, source, client, branch, base_sha,
              head_sha, commits, files_changed, commit_subjects, started_at,
              observed_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, project_id, session_id) DO UPDATE
              SET source          = EXCLUDED.source,
                  client          = EXCLUDED.client,
                  branch          = EXCLUDED.branch,
                  base_sha        = EXCLUDED.base_sha,
                  head_sha        = EXCLUDED.head_sha,
                  commits         = EXCLUDED.commits,
                  files_changed   = EXCLUDED.files_changed,
                  commit_subjects = EXCLUDED.commit_subjects,
                  observed_at     = EXCLUDED.observed_at,
                  expires_at      = EXCLUDED.expires_at
           RETURNING *`,

  /**
   * Where this account last saw HEAD in this project, which is how the next
   * session notices work the last one never got to report.
   *
   * Scoped by account as well as project on purpose: two people sharing a
   * project have two checkouts, and one person's HEAD is not a baseline for
   * the other's.
   */
  lastHead: `SELECT head_sha FROM observations
              WHERE user_id = ? AND project_id = ?
              ORDER BY observed_at DESC, id DESC
              LIMIT 1`,

  /**
   * The briefing's read, with its own honest total.
   *
   * `count(*) OVER ()` is evaluated after the WHERE and before the LIMIT, so
   * it is the eligible count rather than the returned one -- the number the
   * agent needs to know it was not given everything. It rides along on the
   * call every session opens with rather than costing a second round trip.
   *
   * Not scoped by account: in a shared project a collaborator's observations
   * are about the same repository, and hiding them would make the briefing
   * quieter and less true. The project has already been authorised by the
   * caller, exactly as it has for `tasks.pageByProject`.
   */
  page: `SELECT ${COLUMNS}, count(*) OVER () AS total
           FROM observations
          WHERE project_id = ? AND promoted_at IS NULL AND expires_at > ?
          ORDER BY observed_at DESC, id DESC
          LIMIT ?`,

  purge: `DELETE FROM observations WHERE expires_at <= ?`,
} as const;

export async function record(input: NewObservation): Promise<Observation> {
  const at = input.observed_at ?? now();
  const row = await one<Observation>(QUERIES.record, [
    input.user_id,
    input.project_id,
    input.session_id,
    input.source ?? "stdio",
    input.client ?? null,
    input.branch ?? null,
    input.base_sha ?? null,
    input.head_sha ?? null,
    input.commits,
    input.files_changed,
    input.commit_subjects ?? null,
    input.started_at ?? at,
    at,
    // Never taken from the caller. The clock that matters is this one: a
    // machine with a skewed date would otherwise write a row that either never
    // expires or is invisible the moment it lands.
    expiryFrom(at),
  ]);
  return row!;
}

export const lastHeadFor = async (userId: number, projectId: number) =>
  (await one<{ head_sha: string | null }>(QUERIES.lastHead, [userId, projectId]))?.head_sha ??
  null;

type Paged = BriefingObservation & { total: number };

/** What the limit cut. Never negative: the total is taken from the same rows. */
export const OMITTED_FROM = (rows: { total: number }[]) =>
  Math.max(0, (rows[0]?.total ?? 0) - rows.length);

export async function pageByProject(
  projectId: number,
  limit: number,
): Promise<{ rows: BriefingObservation[]; omitted: number }> {
  const rows = await all<Paged>(QUERIES.page, [projectId, now(), limit]);
  return {
    rows: rows.map(({ total: _total, ...row }) => row),
    omitted: OMITTED_FROM(rows),
  };
}

/**
 * Beside `record` because promoting an observation also writes an entry, and
 * only a service may sequence the two. The SQL stays with the table that owns
 * it -- see the transaction rule in CONTRIBUTING.md.
 *
 * Ownership is not asserted here. It belongs in `lib/services/ownership.ts`
 * and nowhere else, and inlining a second check at the call site is exactly
 * what that rule forbids. What this does guard is the one thing ownership
 * cannot: promoting twice, which would relabel a record an agent has already
 * turned into an entry.
 */
export const promoteStmt = (id: number, promotedAs: string, at = now()): Statement => ({
  text: `UPDATE observations SET promoted_at = ?, promoted_as = ?
          WHERE id = ? AND promoted_at IS NULL`,
  params: [at, promotedAs, id],
});

/**
 * Every observation on an account, newest first.
 *
 * For `smoke:mcp`, which is the only thing that can prove the carrier and the
 * server ever meet -- the briefing's read is scoped to one project and filters
 * out anything promoted, neither of which is what that assertion is asking.
 */
export const byUser = (userId: number) =>
  all<Observation>(
    `SELECT * FROM observations WHERE user_id = ? ORDER BY observed_at DESC, id DESC`,
    [userId],
  );

export const byId = (id: number) =>
  one<Observation>("SELECT * FROM observations WHERE id = ?", [id]);

export const purgeExpired = () => run(QUERIES.purge, [now()]);
