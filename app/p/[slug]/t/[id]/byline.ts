import type { T } from "@/lib/i18n";

/**
 * Who wrote a log entry, when that is news.
 *
 * Every line used to carry `by agent`. In production 486 of 489 entries were
 * written by an agent with no name — a label that is true of almost everything
 * and therefore says almost nothing, repeated once per row down a log that
 * exists to be read.
 *
 * What is worth naming is a person: a collaborator's name in a shared project,
 * or the bare `human`, which is the exception in a log written agent-to-agent.
 * `author_name` is null for entries written before the column existed and for
 * an author who has since deleted their account; in both cases the bare
 * `author` still answers something, so the fallback stays — minus the one
 * value that answers nothing.
 *
 * Here rather than in the page for the same reason `./task-list` is: it is a
 * rule, and a rule can be asserted without standing a page up.
 */
export type Authored = { author: string; author_name?: string | null };

/** The name to print, or null when naming it would add nothing. */
export function authorWorthNaming(entry: Authored): string | null {
  return entry.author_name ?? (entry.author === "agent" ? null : entry.author);
}

/**
 * The rendered prefix, including its separator, or an empty string.
 *
 * The time is never part of this. It differs on every row, which is the test
 * for whether something belongs on every row.
 */
export function byline(t: T, entry: Authored): string {
  const who = authorWorthNaming(entry);
  return who ? `${t("by")} ${who} · ` : "";
}
