/**
 * The opening line of something somebody wrote, and the rest of it.
 *
 * This log has a writing convention: an entry starts with a headline, and the
 * tool instructions ask for it in so many words -- "write the first line as a
 * headline that stands on its own". Measured across production on 2026-09-05,
 * 347 of 605 entries (57%) are multi-line with a first line of 120 characters
 * or fewer, averaging 73. The convention is real, and nothing rendered it.
 *
 * Three surfaces now read that line: the briefing computes it in SQL for its
 * budget, the project page shows it as a preview of where work left off, and
 * the task page uses it to give a long log some structure. That is the third
 * repetition, which is when this codebase extracts.
 */

/**
 * How long a first line may be and still read as a headline.
 *
 * Deliberately shorter than the 240 the briefing cuts a preview to, because
 * this decides whether to give a paragraph a heading rather than how much of
 * it to show. A 200-character "headline" is a sentence, and promoting it would
 * make the page look structured while telling the reader nothing.
 */
const HEADLINE_MAX = 120;

/** Leading blank lines and spaces, which `log_entry` allows. */
const lead = (body: string) => body.replace(/^[\s﻿]+/, "");

/**
 * A one-line preview, cut with an ellipsis so a whole line and a shortened one
 * are distinguishable. For places that link to the full text.
 */
export function firstLine(body: string, max = 140): string {
  const line = lead(body).split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/**
 * Split a body into its headline and the rest, or decline to.
 *
 * `headline` is null unless the first line really looks like one AND there is
 * something after it -- so nothing is ever truncated and nothing is ever
 * promoted that would leave an empty body behind. When it declines, `rest` is
 * the whole body and the caller renders exactly what it renders today.
 */
export function splitHeadline(body: string): { headline: string | null; rest: string } {
  const text = lead(body);
  const nl = text.indexOf("\n");
  if (nl === -1) return { headline: null, rest: text };

  const first = text.slice(0, nl).trim();
  const remainder = lead(text.slice(nl + 1));
  if (!first || first.length > HEADLINE_MAX || !remainder) {
    return { headline: null, rest: text };
  }
  return { headline: first, rest: remainder };
}
