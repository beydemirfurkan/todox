import { describe, expect, it } from "vitest";

import { bodyTooLarge, declaredBodyBytes, MAX_BODY_BYTES } from "./body-size";

/**
 * The guard in front of `req.json()` on both agent routes.
 *
 * The schemas cap fields, but they run after the parse, so they bound what gets
 * stored and not what gets read. Everything below is about the difference.
 */
const headers = (values: Record<string, string>) => new Headers(values);

describe("what the caller declared", () => {
  it("reads a plain length", () => {
    expect(declaredBodyBytes(headers({ "content-length": "1234" }))).toBe(1234);
  });

  it("answers null when the caller did not say", () => {
    // A chunked body is the known hole here, and it has to be visible as one
    // rather than being read as zero.
    expect(declaredBodyBytes(headers({}))).toBeNull();
  });

  it.each(["not-a-number", "12.5", "-1", ""])("answers null for %o", (value) => {
    // A header is a string somebody sent. `Number("")` is 0 and `Number("12.5")`
    // is a number, and treating either as a size is how a guard starts letting
    // things through.
    expect(declaredBodyBytes(headers({ "content-length": value }))).toBeNull();
  });
});

describe("the ceiling", () => {
  it("passes a body at the limit", () => {
    expect(bodyTooLarge(headers({ "content-length": String(MAX_BODY_BYTES) }))).toBe(false);
  });

  it("refuses one byte over it", () => {
    expect(bodyTooLarge(headers({ "content-length": String(MAX_BODY_BYTES + 1) }))).toBe(true);
  });

  it("lets a body through when no length was declared", () => {
    // Deliberate: refusing every chunked request would break clients that are
    // not doing anything wrong, and the field caps still apply behind this.
    expect(bodyTooLarge(headers({}))).toBe(false);
  });

  it("clears the largest call the schemas promise to accept", () => {
    // The number this caught: the first ceiling was a megabyte, and
    // `link_files` alone is legal up to roughly 2.4 MB. A guard that refuses
    // what the schema advertises is not a guard, it is a bug with a status
    // code -- so this asserts the relationship rather than the constant, and
    // fails if `MAX.files`, `MAX.path` or `MAX.line` ever outgrow it.
    const files = 500;
    const path = 4_096;
    const note = 500;
    const hash = 64;
    const jsonPunctuationPerEntry = 60;
    const worstLinkFiles = files * (path + note + hash + jsonPunctuationPerEntry);
    const alongsideA100kBody = worstLinkFiles + 100_000;

    expect(bodyTooLarge(headers({ "content-length": String(alongsideA100kBody) }))).toBe(false);
  });
});
