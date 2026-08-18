/**
 * A ceiling on the request body, checked before anything buffers it.
 *
 * Both agent routes went straight to `req.json()`, so the whole body was read
 * and parsed before zod saw a field. The schemas cap fields -- `MAX.text` is
 * 100 KB, `link_files` takes 500 paths -- but a cap that runs after the parse
 * bounds what is *stored*, not what is *read*, and the read is where the memory
 * goes. Vercel used to bound this at the platform edge; the shipped Dockerfile
 * bounds nothing.
 *
 * `content-length` rather than a counting stream: every MCP and HTTP client that
 * reaches these endpoints sends one, and a streaming guard is a lot of
 * machinery for a case none of them produce. The honest limit of this is that a
 * chunked body with no `content-length` is not caught here -- it still meets
 * every schema cap behind it.
 */

/**
 * Above every call the schemas allow, and well below "buffer anything".
 *
 * Derived rather than picked. `link_files` takes `MAX.files` (500) entries of
 * `MAX.path` (4096) plus a `MAX.line` (500) note and a 64-character hash, which
 * is about 2.4 MB before JSON punctuation -- and `create_task` may carry a
 * `MAX.text` (100 KB) body alongside the same array. A megabyte was the first
 * number here and it would have refused calls the schema promises to accept,
 * which is worse than no ceiling: the limit would have been a bug rather than a
 * guard. Four leaves room for the envelope and still bounds the read.
 *
 * If those constants grow, this has to grow with them -- `body-size.test.ts`
 * asserts the relationship rather than the number.
 */
export const MAX_BODY_BYTES = 4_000_000;

/** The declared size, or null when the caller did not say. */
export function declaredBodyBytes(headers: Pick<Headers, "get">): number | null {
  const raw = headers.get("content-length");
  // `Number("")` is 0 and `Number("  ")` is 0, and a blank header is the caller
  // saying nothing rather than saying zero. Reading it as a size is the same
  // trap `priorityOf` in `app/actions.ts` exists to avoid.
  if (raw === null || raw.trim() === "") return null;
  const bytes = Number(raw);
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : null;
}

export const bodyTooLarge = (headers: Pick<Headers, "get">, max = MAX_BODY_BYTES) => {
  const bytes = declaredBodyBytes(headers);
  return bytes !== null && bytes > max;
};
