/**
 * Shared vocabulary. Kept out of db.ts so client components can import it
 * without dragging the native sqlite binding into the browser bundle.
 */

export const ENTRY_KINDS = [
  "note",
  "decision",
  "dead_end",
  "question",
  "handoff",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const CONTEXT_KINDS = [
  "decision",
  "convention",
  "gotcha",
  "preference",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export const STATUSES = ["todo", "doing", "blocked", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ["todo", "doing", "blocked"];
