/**
 * One JSON object per line, on stdout.
 *
 * Everything here logged with a bare `console.error` and a couple of loose
 * arguments, which is fine to read over somebody's shoulder and useless to
 * anything else: no level to filter on, no timestamp the collector did not
 * invent, and no way to tie the line to the request that produced it. Two of
 * the failures this project cares about most -- a dropped email, a sending
 * limit reached -- are documented in SECURITY.md as things that "show up only
 * in the log", so the log is the whole story and it was not a story anything
 * could read.
 *
 * JSON lines rather than a logging library: eight runtime dependencies is a
 * number this project keeps on purpose, and `JSON.stringify` with a fixed set
 * of keys is the entire feature. Anything that reads container logs -- `docker
 * logs`, a collector, `jq` -- parses this without configuration.
 *
 * Nothing here writes a body, a path, a token or an address. A log is a place
 * secrets go to be kept for a long time in plain text.
 */

type Level = "info" | "warn" | "error";

/** Anything worth attaching to a line, as long as it is not somebody's data. */
export type Fields = Record<string, string | number | boolean | null | undefined>;

/**
 * What an unknown throw is worth saying.
 *
 * The message, never the stack: a stack is the one part likely to carry a
 * query, and a driver error's message is already the most useful line.
 */
function describe(error: unknown): Fields {
  if (error instanceof Error) return { error: error.name, message: error.message };
  return { error: "unknown", message: String(error) };
}

function emit(level: Level, event: string, fields: Fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  // Errors to stderr so a container runtime keeps the two streams apart, which
  // is what makes "show me only the failures" possible without parsing.
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logInfo = (event: string, fields?: Fields) => emit("info", event, fields);
export const logWarn = (event: string, fields?: Fields) => emit("warn", event, fields);

/** For a throw. Everything else that failed on purpose is a warning. */
export const logError = (event: string, error: unknown, fields?: Fields) =>
  emit("error", event, { ...fields, ...describe(error) });

/**
 * A short id for one request, so the lines it produced can be found together.
 *
 * Generated here rather than read from a header: nothing in front of this
 * process sets one today, and a caller-supplied value is a caller-supplied
 * value -- it would let anyone stamp their own traffic with somebody else's
 * id. It goes back on the response as `x-request-id` so a report can name the
 * exact call.
 */
export const newRequestId = () => crypto.randomUUID().slice(0, 8);
