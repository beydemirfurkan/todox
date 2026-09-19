import type { ContextKind } from "@/lib/constants";

/**
 * How a list of standing notes is grouped for reading.
 *
 * The project page showed the first six notes in the order the database
 * returned them -- by kind alphabetically, then newest -- and cut the rest.
 * Alphabetical put conventions first, so a project with seven of them never
 * showed a gotcha, which is the note somebody about to edit the code most
 * needs. Here rather than in the repository because the home page reads the
 * same shape for account-wide notes, and `contexts.listByProject` is read by
 * `project-merge` too and must keep answering every row in its own order.
 */

/** What bites first, then why things are the way they are, then how, then taste. */
export const NOTE_KIND_ORDER: readonly ContextKind[] = [
  "gotcha",
  "decision",
  "convention",
  "preference",
];

/**
 * Rows a kind shows before the rest go behind a fold.
 *
 * A row is one line -- a chip and a title -- so eight of them are a screen's
 * worth on a phone; past that the kind is a backlog, and a fold with a count
 * says so without hiding anything.
 */
export const NOTES_PER_KIND = 8;

export type NoteGroup<T> = { kind: ContextKind; shown: T[]; rest: T[] };

/**
 * Kinds in reading order, empty kinds left out, newest first inside a kind,
 * the ninth and later in `rest`.
 */
export function groupNotes<T extends { kind: ContextKind; updated_at: string; id: number }>(
  notes: readonly T[],
  perKind = NOTES_PER_KIND,
): NoteGroup<T>[] {
  return NOTE_KIND_ORDER.flatMap((kind) => {
    const ofKind = notes
      .filter((n) => n.kind === kind)
      // Newest first; the id breaks a tie the same way the repository does,
      // so two notes written in one second keep one order everywhere.
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
    if (!ofKind.length) return [];
    return [{ kind, shown: ofKind.slice(0, perKind), rest: ofKind.slice(perKind) }];
  });
}
