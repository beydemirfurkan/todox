import { describe, expect, it } from "vitest";

import { maskToken, promptForToken, type TokenInput } from "./prompt";

/**
 * A stand-in for `process.stdin` that records what was done to it. The
 * lifecycle is the point: a prompt that resolves the right string and leaves
 * the stream resumed still hangs the CLI, and that is how the hang shipped --
 * every test asked what the function returned, none asked what it left behind.
 */
function fakeStdin(options: { isTTY?: boolean } = {}) {
  let listener: ((chunk: Buffer) => void) | undefined;
  const calls: string[] = [];
  const stream: TokenInput = {
    isTTY: options.isTTY ?? true,
    setRawMode(mode) {
      calls.push(mode ? "rawMode(true)" : "rawMode(false)");
    },
    resume() {
      calls.push("resume");
    },
    pause() {
      calls.push("pause");
    },
    on(_event, fn) {
      listener = fn;
      calls.push("on(data)");
    },
    removeListener(_event, fn) {
      if (fn === listener) listener = undefined;
      calls.push("removeListener(data)");
    },
  };
  return {
    stream,
    calls,
    /** True while a data listener is still attached. */
    get listening() {
      return listener !== undefined;
    },
    type(text: string) {
      listener?.(Buffer.from(text, "utf8"));
    },
    send(...bytes: number[]) {
      listener?.(Buffer.from(bytes));
    },
  };
}

function fakeStdout() {
  const written: string[] = [];
  return { written, write: (text: string) => void written.push(text) };
}

describe("maskToken", () => {
  it("never prints a short token, however short", () => {
    // The regression: the bound was 8, and at exactly 8 the first four plus the
    // last four are the entire string — the "masked" line printed the secret.
    for (const token of ["", "a", "todox_12", "todox_1234x"]) {
      expect(maskToken(token)).toBe("***");
    }
  });

  it("shows the ends of a token long enough to have a middle", () => {
    expect(maskToken("todox_abcdef1234")).toBe("todo…1234");
  });

  it("never contains the whole token", () => {
    for (const token of ["todox_12", "todox_abcdef1234", "x".repeat(64)]) {
      expect(maskToken(token)).not.toContain(token);
    }
  });
});

describe("promptForToken", () => {
  it("resolves what was typed, without the newline", async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const promise = promptForToken(input.stream, output);
    input.type("todox_secret\r");

    await expect(promise).resolves.toBe("todox_secret");
  });

  it("pauses stdin when it resolves, so the process can exit", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.type("todox_secret\r");
    await promise;

    // The regression: `resume()` refs the stdin handle and keeps the event loop
    // alive. Removing the listener is not enough — the CLI finished its work
    // and then hung, on the one path a first-time user takes.
    expect(input.calls).toContain("pause");
    expect(input.calls.indexOf("pause")).toBeGreaterThan(input.calls.indexOf("resume"));
    expect(input.listening).toBe(false);
  });

  it("pauses stdin on Ctrl-C too", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.send(0x03);

    await expect(promise).rejects.toThrow(/interrupted/);
    expect(input.calls).toContain("pause");
    expect(input.listening).toBe(false);
  });

  it("leaves raw mode the way it found it", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.type("tk\n");
    await promise;

    expect(input.calls).toContain("rawMode(true)");
    expect(input.calls).toContain("rawMode(false)");
  });

  it("never echoes the token", async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const promise = promptForToken(input.stream, output);
    input.type("todox_secret\r");
    await promise;

    const printed = output.written.join("");
    expect(printed).not.toContain("todox_secret");
    expect(printed).toContain("todox token: ");
  });

  it("accepts a newline as well as a carriage return", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.type("tk\n");

    await expect(promise).resolves.toBe("tk");
  });

  it("trims what a paste brings with it", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.type("  todox_padded \r");

    await expect(promise).resolves.toBe("todox_padded");
  });

  it("survives input arriving one byte at a time", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    for (const byte of Buffer.from("abc", "utf8")) input.send(byte);
    input.send(0x0d);

    await expect(promise).resolves.toBe("abc");
  });

  it("keeps a non-ASCII token byte-for-byte", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    // Decoding per byte turned each of these into two wrong characters, which
    // for a credential means an install that authenticates as nobody.
    input.type("tökèn_ğüş\r");

    await expect(promise).resolves.toBe("tökèn_ğüş");
  });

  it("stars one character, not one byte, for multi-byte input", async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const promise = promptForToken(input.stream, output);
    input.type("ğüş\r");
    await promise;

    // Three characters, six bytes. Six stars would leak the encoded length.
    expect(output.written.filter((chunk) => chunk === "*")).toHaveLength(3);
  });

  it("backspace removes a whole multi-byte character", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.type("ağ");
    input.send(0x7f);
    input.type("b\r");

    // Popping a single byte would leave the lead byte of "ğ" behind and decode
    // to a replacement character.
    await expect(promise).resolves.toBe("ab");
  });

  it("drops control bytes instead of putting them in the token", async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const promise = promptForToken(input.stream, output);
    input.send(0x04); // Ctrl-D, which a piped pty sends before the line
    input.type("tk");
    input.send(0x1b); // ESC, the head of every arrow-key sequence
    input.send(0x0d);

    // These used to be appended like any other byte, and the masked line
    // rendered them as nothing — a credential nobody typed, looking right.
    await expect(promise).resolves.toBe("tk");
    expect(output.written.filter((chunk) => chunk === "*")).toHaveLength(2);
  });

  it("backspace on an empty buffer is not an error", async () => {
    const input = fakeStdin();
    const promise = promptForToken(input.stream, fakeStdout());
    input.send(0x7f, 0x7f);
    input.type("tk\r");

    await expect(promise).resolves.toBe("tk");
  });

  it("refuses to prompt when the input is not a TTY", async () => {
    const input = fakeStdin({ isTTY: false });

    await expect(promptForToken(input.stream, fakeStdout())).rejects.toThrow(
      /pass --token <value> or set TODOX_TOKEN/,
    );
    // And it must not have touched the stream: CI has no terminal to restore.
    expect(input.calls).toEqual([]);
  });
});
