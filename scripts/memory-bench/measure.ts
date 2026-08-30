/**
 * The arithmetic behind `pnpm bench:memory`, kept apart from the seeding so it
 * can be tested without a database.
 *
 * Two numbers matter here and neither is a benchmark score. The briefing is the
 * call every session opens with, so what it costs is a tax on every session;
 * and search is the call an agent makes when it has a question, so whether it
 * answers is the difference between a log and a log nobody can reach.
 */

/**
 * Bytes of JSON, which is what actually crosses the wire.
 *
 * The primary unit on purpose. Tokens are what an agent pays, but the count
 * depends on a tokenizer this repo does not ship and would have to guess at;
 * bytes are exact, and the two move together. Anything reported in tokens here
 * says so and shows its assumption.
 */
export const bytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value ?? null), "utf8");

/**
 * Characters per token, for the rough conversion.
 *
 * English prose runs about four; this log is half Turkish, whose agglutination
 * and non-ASCII letters both push the ratio down, so three is the closer guess
 * for the mixture. It is a guess either way, which is why nothing in this
 * script decides anything on the token figure alone.
 */
export const CHARS_PER_TOKEN = 3.3;

export const approxTokens = (value: unknown): number =>
  Math.round(bytes(value) / CHARS_PER_TOKEN);

export const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

/**
 * A search result, reduced to the fields that say which row it is.
 *
 * `task_id` is set on an entry hit and is why `reachable` below exists: an
 * entry names the task it belongs to, so finding the entry finds the task.
 */
export type Hit = { type: string; id: number; task_id?: number };

/**
 * Did the answer itself come back in the first `k`?
 *
 * Recall rather than precision, and at a small k, because that is the shape of
 * the real cost: an agent reads the top few hits and moves on. A right answer
 * at rank twelve is a right answer nobody sees.
 */
export function foundWithin(hits: Hit[], expected: Hit, k: number): boolean {
  return hits.slice(0, k).some((h) => h.type === expected.type && h.id === expected.id);
}

/**
 * Did anything come back that gets the agent to the answer?
 *
 * The looser of the two, and the gap between them is a real cost rather than a
 * rounding detail. Searching for a term that appears in a dead end returns the
 * *entry*, not the task it hangs off — so the answer is reachable, in one more
 * call, from a 240-character snippet that may not even contain the match. That
 * second call is the thing `get_context_note` and `get_task` are for, and the
 * distance between these two columns is how much of the log is only reachable
 * that way.
 */
export function reachableWithin(hits: Hit[], expected: Hit, k: number): boolean {
  if (foundWithin(hits, expected, k)) return true;
  if (expected.type !== "task") return false;
  return hits.slice(0, k).some((h) => h.type === "entry" && h.task_id === expected.id);
}

export type RecallReport = {
  asked: number;
  found: number;
  /** The questions that found nothing, so a run says what it failed at. */
  missed: string[];
};

export function recallAt(
  k: number,
  answers: { question: string; hits: Hit[]; expected: Hit }[],
  hit: (hits: Hit[], expected: Hit, k: number) => boolean = foundWithin,
): RecallReport {
  const missed = answers.filter((a) => !hit(a.hits, a.expected, k)).map((a) => a.question);
  return { asked: answers.length, found: answers.length - missed.length, missed };
}

/** `19/25  (76%)`, padded so a column of them lines up. */
export function score({ asked, found }: RecallReport): string {
  const ratio = asked === 0 ? 0 : Math.round((found / asked) * 100);
  return `${String(found).padStart(3)}/${asked}  (${String(ratio).padStart(3)}%)`;
}
