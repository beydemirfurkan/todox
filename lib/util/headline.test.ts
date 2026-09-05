import { describe, expect, it } from "vitest";

import { firstLine, splitHeadline } from "./headline";

describe("splitHeadline", () => {
  it("promotes a short first line when there is a body under it", () => {
    const { headline, rest } = splitHeadline("FAZ 2 BİTTİ, PUSH EDİLMEDİ.\n\nÜç dal, üç commit.");
    expect(headline).toBe("FAZ 2 BİTTİ, PUSH EDİLMEDİ.");
    expect(rest).toBe("Üç dal, üç commit.");
  });

  /**
   * The property that makes this safe to apply to every entry: it never cuts.
   * A caller renders `headline` and `rest`, so anything the split drops would
   * be text the reader can no longer reach.
   */
  it("never loses a character it did not promote", () => {
    for (const body of [
      "one line only",
      "a headline\nand a body",
      "   \n\nleading blank lines\nthen more",
      `${"x".repeat(400)}\nrest`,
      "a headline\n   \n  ",
    ]) {
      const { headline, rest } = splitHeadline(body);
      const shown = (headline ? `${headline}\n` : "") + rest;
      // Every non-whitespace character survives, in order.
      expect(shown.replace(/\s/g, "")).toBe(body.replace(/\s/g, ""));
    }
  });

  it("declines on a single line, so nothing gets a heading and no body", () => {
    expect(splitHeadline("just the one line").headline).toBeNull();
  });

  it("declines when the first line is a sentence rather than a headline", () => {
    // Otherwise the page looks structured while telling the reader nothing.
    const long = `${"a sentence that keeps going and going ".repeat(4)}\nrest`;
    expect(splitHeadline(long).headline).toBeNull();
  });

  it("declines when there is nothing under the first line", () => {
    expect(splitHeadline("a headline\n\n   \n").headline).toBeNull();
  });
});

describe("firstLine", () => {
  it("marks a line it had to shorten", () => {
    expect(firstLine("x".repeat(200), 140)).toMatch(/…$/);
  });

  it("leaves a line that fits alone", () => {
    expect(firstLine("short enough\nrest")).toBe("short enough");
  });

  it("skips leading blank lines rather than answering with nothing", () => {
    expect(firstLine("\n\nREAL HEADLINE\nrest")).toBe("REAL HEADLINE");
  });
});
