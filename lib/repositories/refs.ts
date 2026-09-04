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

/*
 * There is no `listByContext`. A note's linked files are asked for from the
 * other direction -- `get_file_context` takes a path and answers with the
 * notes attached to it -- and that is the reader context #37 required when
 * `link_files(context_id:)` was added. A second reader by note id existed,
 * had no caller anywhere, and was removed rather than left looking like a
 * surface somebody could use: production has 29 refs and none of them on a
 * context, so building for it would be guessing.
 */

/**
 * Every link on any of these exact paths.
 *
 * Plural because one file has as many absolute paths as it has machines, and
 * the caller expands the repo-relative form back across the project's known
 * roots before asking. Equality rather than a suffix match: `LIKE '%/auth.ts'`
 * cannot use an index and would answer `vendor/lib/auth.ts` to a question
 * about `lib/auth.ts`, which is the kind of wrong that reads as right.
 *
 * Unscoped by project on purpose -- this table has no project column, and
 * reaching into `tasks` and `contexts` for one would make a repository do
 * cross-table work. The caller narrows it, and the caller is the only side
 * that has already proved what the account may see.
 */
export const listByPaths = (paths: string[]): Promise<Ref[]> =>
  paths.length
    ? all<Ref>(
        `SELECT * FROM refs WHERE path IN (${paths.map(() => "?").join(",")})
         ORDER BY linked_at DESC, id DESC`,
        paths,
      )
    : Promise.resolve([]);

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

  // Deduplicated before the statement is built: the same path listed twice in
  // one call would otherwise be inserted twice by the same command, which no
  // constraint can catch.
  const byPath = new Map(input.paths.map((p) => [p.path, p]));
  const paths = [...byPath.values()];

  const ts = now();
  const values: unknown[] = [];
  const tuples = paths.map((p) => {
    values.push(input.task_id ?? null, input.context_id ?? null, p.path, p.note ?? null, p.hash ?? null, ts);
    // Casts, not decoration: a column of only NULLs -- every `hash` on a link
    // from the web form -- gives Postgres nothing to infer a type from.
    return "(?::int, ?::int, ?::text, ?::text, ?::text, ?::text)";
  });

  // Update what is already linked, insert what is not, in one statement.
  //
  // Deliberately not `ON CONFLICT (task_id, path)`: a conflict target has to
  // name an index that already exists, which would make this code fail on
  // every call until the migration adding that index had run. Deploys and
  // migrations are separate steps here, so anything that only works in one
  // order is a broken window waiting to happen. `NOT EXISTS` behaves the same
  // before and after. The bare `DO NOTHING` needs no target and is there for
  // the race two concurrent calls could still lose once the index exists.
  //
  // Re-linking a file is not an error; it is an agent doing what the tool
  // description tells it to. The first link keeps its `hash`, because that is
  // the baseline the existing note was written against; a note or a hash
  // supplied later fills in one that was missing.
  const same = `r.task_id IS NOT DISTINCT FROM v.task_id
                AND r.context_id IS NOT DISTINCT FROM v.context_id
                AND r.path = v.path`;

  return all<Ref>(
    `WITH v (task_id, context_id, path, note, hash, linked_at) AS (
       VALUES ${tuples.join(", ")}
     ), updated AS (
       UPDATE refs r
       SET note      = COALESCE(v.note, r.note),
           hash      = COALESCE(r.hash, v.hash),
           linked_at = v.linked_at
       FROM v WHERE ${same}
       RETURNING r.*
     ), inserted AS (
       INSERT INTO refs (task_id, context_id, path, note, hash, linked_at)
       SELECT v.task_id, v.context_id, v.path, v.note, v.hash, v.linked_at
       FROM v
       WHERE NOT EXISTS (SELECT 1 FROM refs r WHERE ${same})
       ON CONFLICT DO NOTHING
       RETURNING *
     )
     SELECT * FROM updated UNION ALL SELECT * FROM inserted`,
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
export async function recordCheck(
  seen: { id: number; hash: string | null }[],
): Promise<number> {
  if (!seen.length) return 0;
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

  // The count comes back rather than being dropped. A ref deleted between the
  // ownership check and this statement matches nothing, and the caller used to
  // answer with the number it was *sent* -- so an agent could be told its
  // staleness report was recorded when none of it was. `unlink`, `acceptSeen`
  // and their siblings all check what they wrote; this was the one that did not.
  return run(
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
