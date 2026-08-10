import { all, groupBy, one, run } from "../db/client";
import type { Ref, RefStatus } from "../types";
import { now } from "../util/time";

export const listByTask = (taskId: number) =>
  all<Ref>("SELECT * FROM refs WHERE task_id = ? ORDER BY path", [taskId]);

/** Batch sibling of listByTask, for anything rendering more than one task. */
export async function listByTasks(taskIds: number[]): Promise<Map<number, Ref[]>> {
  if (!taskIds.length) return new Map();
  const rows = await all<Ref>(
    `SELECT * FROM refs WHERE task_id IN (${taskIds.map(() => "?").join(",")})
     ORDER BY task_id, path`,
    taskIds,
  );
  return groupBy(rows, (r) => r.task_id!);
}

export const listByContext = (contextId: number) =>
  all<Ref>("SELECT * FROM refs WHERE context_id = ? ORDER BY path", [contextId]);

export const byId = (id: number) => one<Ref>("SELECT * FROM refs WHERE id = ?", [id]);

/**
 * `hash` is supplied by the caller, because only the caller has the file.
 *
 * This used to run `hashFile(p.path)` here. That was true when the MCP server
 * talked to a local SQLite file; since it moved to HTTP, this code runs on the
 * web host, which has no copy of the repository. Every hash it computed was
 * therefore null, `freshness` answered "unknown" forever, and the whole
 * staleness feature quietly did nothing. It also turned an unvalidated caller
 * path into a server-side `readFileSync`.
 *
 * One statement rather than a loop: over HTTP each row was a round trip.
 */
export async function link(input: {
  task_id?: number | null;
  context_id?: number | null;
  paths: { path: string; note?: string | null; hash?: string | null }[];
}): Promise<Ref[]> {
  if (!input.paths.length) return [];

  // Deduplicated before the statement is built, not only by the index below:
  // `ON CONFLICT DO UPDATE` refuses to touch the same row twice inside one
  // command, so a caller listing a path twice would take the whole call down.
  const byPath = new Map(input.paths.map((p) => [p.path, p]));
  const paths = [...byPath.values()];

  const ts = now();
  const values: unknown[] = [];
  const tuples = paths.map((p) => {
    values.push(input.task_id ?? null, input.context_id ?? null, p.path, p.note ?? null, p.hash ?? null, ts);
    return "(?, ?, ?, ?, ?, ?)";
  });

  // Re-linking a file is not an error, it is an agent doing what the tool
  // description tells it to. The first link keeps its `hash`, because that is
  // the baseline the existing note was written against; a note supplied later
  // fills in one that was missing.
  const onConflict = input.task_id
    ? `ON CONFLICT (task_id, path) WHERE task_id IS NOT NULL
       DO UPDATE SET note      = COALESCE(EXCLUDED.note, refs.note),
                     hash      = COALESCE(refs.hash, EXCLUDED.hash),
                     linked_at = EXCLUDED.linked_at`
    : "";

  return all<Ref>(
    `INSERT INTO refs (task_id, context_id, path, note, hash, linked_at)
     VALUES ${tuples.join(", ")}
     ${onConflict} RETURNING *`,
    values,
  );
}

export const unlink = (id: number) => run("DELETE FROM refs WHERE id = ?", [id]);

/**
 * Adopts the last state the agent reported as the new baseline: "yes, I have
 * read the change, stop flagging it".
 *
 * The web server cannot re-hash the file — it has no copy — so this is the
 * only re-baselining it can honestly offer, and it is a no-op until an agent
 * has actually looked.
 */
export const acceptSeen = (id: number) =>
  run(
    `UPDATE refs SET hash = hash_seen, linked_at = ?
     WHERE id = ? AND checked_at IS NOT NULL AND hash_seen IS NOT NULL`,
    [now(), id],
  );

/**
 * Records what the agent found on disk. `hash: null` means the file is gone.
 *
 * The web UI cannot check for itself, so this is how it ever has an answer --
 * and why the answer is always reported with `checked_at` beside it.
 */
export async function recordCheck(seen: { id: number; hash: string | null }[]) {
  if (!seen.length) return;
  const ts = now();

  // One statement, for the same reason `link` above is one: over HTTP each row
  // was a round trip. An agent reporting on a couple of hundred linked files
  // spent that many hops here, in series, inside a 30-second function -- and
  // the caller swallows a failure, so it simply stopped recording staleness
  // without telling anyone.
  const values: unknown[] = [ts];
  const tuples = seen.map((s) => {
    values.push(s.id, s.hash);
    // The casts are not decoration: a column of all-NULL hashes gives Postgres
    // nothing to infer a type from, and the statement fails to plan.
    return "(?::int, ?::text)";
  });

  await run(
    // COALESCE gives a baseline to rows linked from the web form, where the
    // browser cannot hash a path on the developer's machine. The first time
    // an agent looks, what it finds becomes the reference; without this those
    // rows would read "unknown" for ever.
    `UPDATE refs r
     SET hash = COALESCE(r.hash, v.hash), hash_seen = v.hash, checked_at = ?
     FROM (VALUES ${tuples.join(", ")}) AS v(id, hash)
     WHERE r.id = v.id`,
    values,
  );
}

/**
 * Compares two recorded hashes. Pure, and deliberately so: context that lies is
 * worse than no context, and a server that guesses would be lying.
 */
export function freshness(r: Ref): RefStatus {
  if (!r.hash || !r.checked_at) return "unknown";
  if (r.hash_seen === null) return "missing";
  return r.hash_seen === r.hash ? "fresh" : "changed";
}
