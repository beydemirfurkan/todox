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
