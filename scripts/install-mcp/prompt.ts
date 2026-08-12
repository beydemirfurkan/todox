/**
 * Read a token from the terminal without echoing it.
 *
 * `readline` echoes by default, so this drops into raw mode and accumulates
 * bytes itself. The streams are parameters rather than `process.stdin` reached
 * for directly, because the interesting behaviour here is lifecycle — what the
 * function leaves behind when it resolves — and that is only observable to a
 * test that can hold the stream afterwards.
 */

/** The part of `process.stdin` this needs. */
export type TokenInput = {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: Buffer) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer) => void): unknown;
};

/** The part of `process.stdout` this needs. */
export type TokenOutput = { write(text: string): unknown };

/**
 * Show enough of a token to recognise it, never enough to use it.
 *
 * The bound is 12, not 8: at exactly 8 the first four and the last four are
 * the whole string, so the "masked" form printed the secret in full. It lives
 * here rather than beside its caller because `index.ts` runs the CLI on
 * import, so nothing in that file can be reached by a test.
 */
export function maskToken(token: string): string {
  if (token.length < 12) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

const ENTER = new Set([0x0d, 0x0a]);
const CTRL_C = 0x03;
const BACKSPACE = new Set([0x08, 0x7f]);

/**
 * True for a C0 control byte we have no meaning for — arrow keys, Ctrl-D,
 * anything a terminal emits that is not text.
 *
 * They used to be appended to the token like any other byte, invisibly: the
 * masked line rendered a leading Ctrl-D as nothing at all, so a token with a
 * stray control character in it looked correct on screen and then failed
 * authentication with a message about the token being wrong. Silently dropping
 * them is the only reading that cannot produce a credential nobody typed.
 */
function isIgnorableControl(byte: number): boolean {
  return byte < 0x20 && !ENTER.has(byte) && byte !== CTRL_C && byte !== 0x08;
}

/** True for a UTF-8 continuation byte (0b10xxxxxx) — the tail of a character. */
function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * Throws when the input is not a TTY: CI without `TODOX_TOKEN` is a
 * configuration error, not a prompt opportunity.
 */
export function promptForToken(
  input: TokenInput = process.stdin,
  output: TokenOutput = process.stdout,
): Promise<string> {
  if (!input.isTTY) {
    return Promise.reject(
      new Error(
        "no --token given and TODOX_TOKEN is unset; pass --token <value> or set TODOX_TOKEN",
      ),
    );
  }
  output.write("todox token: ");
  return new Promise<string>((resolve, reject) => {
    // Bytes, decoded as UTF-8 once at the end. Decoding per byte turned every
    // non-ASCII character into two wrong ones, and a token is a credential --
    // it has to survive the prompt exactly as it was pasted.
    const bytes: number[] = [];

    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode?.(false);
      // Not optional. `resume()` refs the stdin handle and keeps the event loop
      // alive, so without this the CLI did all of its work, printed its last
      // line and then hung forever instead of exiting -- on the interactive
      // path, which is the one a first-time user takes.
      input.pause();
    };

    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (ENTER.has(byte)) {
          cleanup();
          output.write("\n");
          resolve(Buffer.from(bytes).toString("utf8").trim());
          return;
        }
        if (byte === CTRL_C) {
          cleanup();
          output.write("\n");
          reject(new Error("interrupted"));
          return;
        }
        if (BACKSPACE.has(byte)) {
          // Drop a whole character: continuation bytes are the tail of the one
          // before them, so popping a single byte leaves half a character.
          while (bytes.length > 0 && isContinuation(bytes[bytes.length - 1]!)) bytes.pop();
          if (bytes.length > 0) {
            bytes.pop();
            output.write("\b \b");
          }
          continue;
        }
        if (isIgnorableControl(byte)) continue;
        bytes.push(byte);
        // One asterisk per byte would leak the length in bytes rather than in
        // characters; only the bytes that start one get a star.
        if (!isContinuation(byte)) output.write("*");
      }
    };

    input.setRawMode?.(true);
    input.resume();
    input.on("data", onData);
  });
}
