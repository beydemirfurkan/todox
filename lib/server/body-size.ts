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
 * Two checks. The declared `content-length` refuses an honest oversize body
 * before a byte is read; `readJsonWithin` counts the bytes as they arrive, so
 * a chunked body that declares nothing is cut off at the same ceiling instead
 * of being buffered whole.
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

export class BodyTooLarge extends Error {
  constructor(max: number) {
    super(`body exceeds ${max} bytes`);
    this.name = "BodyTooLarge";
  }
}

/**
 * The body as JSON, read no further than `max` bytes. Throws `BodyTooLarge`
 * past the ceiling and `SyntaxError` for a body that is not JSON.
 */
export async function readJsonWithin(req: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  if (!req.body) return JSON.parse("");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new BodyTooLarge(max);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

