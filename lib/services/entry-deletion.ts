import { tx } from "../db/client";
import * as entryDeletions from "../repositories/entry-deletions";
import * as entries from "../repositories/entries";
import { assertCanDeleteEntry, NotYours } from "./ownership";

/**
 * Deletes an entry and records that it was deleted, in one transaction.
 *
 * Two tables, so a service: the entry goes, and a row in `entry_deletions`
 * keeps its kind, its author and who removed it, so a shared log never loses
 * a line silently. Whether the caller may do it is decided in `ownership.ts`.
 */
export async function deleteEntry(userId: number, entryId: number): Promise<{ deleted: boolean }> {
  await assertCanDeleteEntry(userId, entryId);
  const entry = await entries.byId(entryId);
  if (!entry) throw new NotYours("entry", entryId);
  await tx([
    entries.removeStmt(entryId),
    entryDeletions.createStmt({
      task_id: entry.task_id,
      kind: entry.kind,
      author_id: entry.user_id ?? null,
      deleted_by: userId,
      created_at: entry.created_at,
    }),
  ]);
  return { deleted: true };
}
