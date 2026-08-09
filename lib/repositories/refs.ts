import { all, groupBy, one, run } from "../db/client";
import type { Ref, RefStatus } from "../types";
import { hashFile } from "../util/paths";
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

export async function link(input: {
  task_id?: number | null;
  context_id?: number | null;
  paths: { path: string; note?: string | null }[];
}): Promise<Ref[]> {
  const out: Ref[] = [];
  for (const p of input.paths) {
    const row = await one<Ref>(
      `INSERT INTO refs (task_id, context_id, path, note, hash, linked_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        input.task_id ?? null,
        input.context_id ?? null,
        p.path,
        p.note ?? null,
        hashFile(p.path),
        now(),
      ],
    );
    if (row) out.push(row);
  }
  return out;
}

export const unlink = (id: number) => run("DELETE FROM refs WHERE id = ?", [id]);

export async function refresh(id: number) {
  const r = await byId(id);
  if (!r) return;
  await run("UPDATE refs SET hash = ?, linked_at = ? WHERE id = ?", [
    hashFile(r.path),
    now(),
    id,
  ]);
}

/**
 * Context that lies is worse than no context: re-hash the file and report
 * whether the note still describes what is on disk.
 *
 * Stays synchronous -- it touches the filesystem, not the database, and it
 * only means anything on the machine holding the code.
 */
export function freshness(r: Ref): RefStatus {
  if (!r.hash) return "unknown";
  const h = hashFile(r.path);
  if (h === null) return "missing";
  return h === r.hash ? "fresh" : "changed";
}
