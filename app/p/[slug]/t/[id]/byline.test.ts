import { describe, expect, it } from "vitest";

import { authorWorthNaming, byline } from "./byline";

/**
 * Which authors are worth printing on a log line.
 *
 * The rule came from the data: 486 of 489 entries in production were written
 * by an agent with no name, so `by agent` was a label true of almost every row
 * and therefore carrying almost nothing — while costing a line of chrome on
 * each of them.
 *
 * The failure to guard against is not the noise, though. It is the fix going
 * too far and swallowing an author that *is* news: a collaborator's name, or a
 * human entry in a log otherwise written agent-to-agent. Those are the two
 * cases that make a shared project readable.
 */

const t = ((key: string) => (key === "by" ? "by" : key)) as unknown as Parameters<
  typeof byline
>[0];

describe("an author worth naming", () => {
  it("names a person", () => {
    expect(authorWorthNaming({ author: "agent", author_name: "furkan" })).toBe("furkan");
  });

  /**
   * The exception the log is unusual for. An entry somebody typed themselves
   * is worth marking as such even without a name attached.
   */
  it("names a human entry", () => {
    expect(authorWorthNaming({ author: "human" })).toBe("human");
  });

  /**
   * Null for entries written before the column existed, and for an author who
   * has since deleted their account. The bare value still answers something.
   */
  it("falls back to the bare author when there is no name", () => {
    expect(authorWorthNaming({ author: "human", author_name: null })).toBe("human");
  });
});

describe("an author that adds nothing", () => {
  it("stays silent for a nameless agent", () => {
    expect(authorWorthNaming({ author: "agent" })).toBeNull();
    expect(authorWorthNaming({ author: "agent", author_name: null })).toBeNull();
  });
});

describe("the rendered prefix", () => {
  it("carries its own separator, so the caller composes nothing", () => {
    expect(byline(t, { author: "agent", author_name: "furkan" })).toBe("by furkan · ");
  });

  it("is empty rather than a stray separator when there is nobody to name", () => {
    expect(byline(t, { author: "agent" })).toBe("");
  });
});
