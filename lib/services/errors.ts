/**
 * Errors whose message is safe — and useful — to hand back to the caller.
 *
 * The RPC route answers 400 for these and a generic 500 for everything else.
 * That split matters: it used to return `(e as Error).message` for any failure,
 * so a caller probing the query layer got Postgres' own parse errors back as
 * feedback. Anything an agent can act on ("pass either `project` or `cwd`")
 * should be a `BadRequest`; anything that means we broke should not.
 */
export class BadRequest extends Error {}

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
