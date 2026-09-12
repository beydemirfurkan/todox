/**
 * Errors whose message is safe — and useful — to hand back to the caller.
 *
 * The RPC route answers 400 for these and a generic 500 for everything else.
 * That split matters: it used to return `(e as Error).message` for any failure,
 * so a caller probing the query layer got Postgres' own parse errors back as
 * feedback. Anything an agent can act on ("pass either `project` or `cwd`")
 * should be a `BadRequest`; anything that means we broke should not.
 */
export class BadRequest extends Error {
  /**
   * Why, in a word the log can keep.
   *
   * The message names paths and slugs, so the log never carries it, and for a
   * month that meant the log carried nothing: production counted twenty-six
   * refused agent calls in ten days and the container log had no line for any
   * of them. A code says what kind of refusal it was -- a shape the schema
   * rejected, a path no project matched, a directory nobody could show was a
   * repository -- and nothing about whose.
   */
  constructor(
    message: string,
    readonly reason: RefusalReason = "other",
  ) {
    super(message);
  }
}

export type RefusalReason =
  /** The parameters did not fit the method's schema. */
  | "schema"
  /** No method by that name. */
  | "unknown_method"
  /** Neither `project` nor `cwd` was sent. */
  | "no_ref"
  /** The reference matched no project the caller can see. */
  | "no_project"
  /** A path nobody could show was a repository, so nothing was registered. */
  | "no_evidence"
  | "other";

/**
 * The statement ran out of time and Postgres stopped it.
 *
 * `lib/db/client.ts` sets a `statement_timeout`, so this is the shape a query
 * that will not finish comes back in — and until it had a name it fell through
 * to the generic 500. The only thing an agent can reasonably do with "the
 * server could not complete that call" is make the call again, which times out
 * again, and the retry loop that follows is stopped by a rate limit rather than
 * by anything having been explained. Naming it lets the answer say the one
 * useful thing: not this call, unchanged.
 *
 * Separate from `BadRequest` because the request was fine. What failed is a
 * promise about how long an answer takes, which is ours.
 */
export class TooSlow extends Error {}

/**
 * The word the log keeps for a refusal.
 *
 * Anything that is not a `BadRequest` and reached this is a `NotYours` from
 * `ownership.ts`, which this module does not import -- it sits below the
 * services, and the ownership check sits on top of the repositories. One word
 * for every ownership failure on purpose: which kind of row was somebody
 * else's is a fact about the row.
 */
export const refusalReason = (e: unknown): RefusalReason | "not_yours" =>
  e instanceof BadRequest ? e.reason : "not_yours";
