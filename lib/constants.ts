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

/**
 * What a notification can be about.
 *
 * A union rather than free text, because every kind needs a sentence in both
 * dictionaries and nothing else guarantees that a new one gets written. The
 * test walks this list.
 */
export const NOTIFICATION_KINDS = [
  "invite_received",
  "invite_accepted",
  "member_removed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const STATUSES = ["todo", "doing", "blocked", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export const OPEN_STATUSES: Status[] = ["todo", "doing", "blocked"];
