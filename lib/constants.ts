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

/**
 * The statuses that stop the clock, and the one place that says so.
 *
 * `closed_at` is written from this in two places that do not otherwise know
 * about each other -- `tasks.create`, where a task can open already closed, and
 * `task-service.update`, which is the only caller that knows the previous
 * status. Written out twice, the two would disagree the day a status is added.
 */
export const CLOSED_STATUSES: Status[] = ["done", "dropped"];

export function isClosedStatus(status: Status): boolean {
  return CLOSED_STATUSES.includes(status);
}

/**
 * 1 high, 2 normal, 3 low. The bounds live beside the vocabulary because two
 * surfaces enforce them -- the RPC schema and the web form -- and a number
 * written twice is a number that drifts.
 */
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 3;
export const DEFAULT_PRIORITY = 2;

/**
 * Guards for the words above.
 *
 * A `value as Status` cast is erased at build time, so on a surface that reads
 * what a caller sent -- a server action reading `FormData` -- it checks
 * nothing. Neither does the database: `status` and `kind` are plain `TEXT` and
 * `priority` a plain `INTEGER`, with no `CHECK` behind them. These predicates
 * are the only thing between a forged POST and a row nothing can read back: a
 * task whose status is not in this list is invisible to every `status = ?`
 * filter in the app, and `closed_at` never moves for it again.
 *
 * `isLang` in `lib/i18n` is the same shape, for the same reason.
 */
export function isStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === "string" && (ENTRY_KINDS as readonly string[]).includes(value);
}

export function isContextKind(value: unknown): value is ContextKind {
  return typeof value === "string" && (CONTEXT_KINDS as readonly string[]).includes(value);
}

export function isPriority(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_PRIORITY &&
    value <= MAX_PRIORITY
  );
}
