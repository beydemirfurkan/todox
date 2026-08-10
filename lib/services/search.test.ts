import { describe, expect, it } from "vitest";

import { escapeLike } from "./search";

/**
 * The query went into `%…%` and straight to ILIKE. Two characters in that
 * string mean something to ILIKE and nothing to the person typing them, so a
 * search for either matched every row in the account, and a search for a
 * literal one found nothing at all.
 */
describe("escapeLike", () => {
  it("escapes the wildcards", () => {
    expect(escapeLike("%")).toBe("\\%");
    expect(escapeLike("_")).toBe("\\_");
    expect(escapeLike("100%_sure")).toBe("100\\%\\_sure");
  });

  it("escapes the escape character itself, or the next one gets away", () => {
    expect(escapeLike("a\\%b")).toBe("a\\\\\\%b");
  });

  it("leaves an ordinary query alone", () => {
    expect(escapeLike("neon timeout")).toBe("neon timeout");
    expect(escapeLike("useEffect()")).toBe("useEffect()");
    // Turkish is the default language here; none of it is a wildcard.
    expect(escapeLike("şifre sıfırlama")).toBe("şifre sıfırlama");
  });
});
