import { describe, expect, it } from "vitest";

import {
  CONTEXT_KINDS,
  ENTRY_KINDS,
  MAX_PRIORITY,
  MIN_PRIORITY,
  STATUSES,
  isContextKind,
  isEntryKind,
  isPriority,
  isStatus,
} from "./constants";

/**
 * These guards stand where a `value as Status` cast used to, on the server
 * actions that read `FormData`. Nothing else checks: the columns behind them
 * are plain `TEXT` and `INTEGER` with no `CHECK`, so a word that gets past
 * here is stored, and a task whose status is not in `STATUSES` disappears from
 * every `status = ?` filter the app has.
 *
 * The cases below are the ones a cast let through, not a tour of the type
 * system: a plausible-looking word, a near miss on a real one, and the values
 * `Number()` produces from junk.
 */
describe("vocabulary guards", () => {
  it("accepts every word the app actually uses", () => {
    for (const status of STATUSES) expect(isStatus(status)).toBe(true);
    for (const kind of ENTRY_KINDS) expect(isEntryKind(kind)).toBe(true);
    for (const kind of CONTEXT_KINDS) expect(isContextKind(kind)).toBe(true);
  });

  it("refuses a word that is not one of them", () => {
    expect(isStatus("archived")).toBe(false);
    expect(isEntryKind("dead-end")).toBe(false); // the real one is dead_end
    expect(isContextKind("gotchas")).toBe(false);
  });

  it("refuses a status that belongs to another vocabulary", () => {
    // Every one of these is a valid word somewhere else in the app, which is
    // what makes a cast at the boundary look harmless.
    expect(isStatus("note")).toBe(false);
    expect(isStatus("decision")).toBe(false);
    expect(isEntryKind("todo")).toBe(false);
    expect(isContextKind("handoff")).toBe(false);
  });

  it("refuses what a missing field turns into", () => {
    // `fd.get` answers null when the field was never submitted, and the old
    // code cast that straight through.
    for (const empty of [null, undefined, ""]) {
      expect(isStatus(empty)).toBe(false);
      expect(isEntryKind(empty)).toBe(false);
      expect(isContextKind(empty)).toBe(false);
    }
  });

  it("refuses a non-string that happens to be truthy", () => {
    expect(isStatus(1)).toBe(false);
    expect(isEntryKind({ toString: () => "note" })).toBe(false);
    expect(isContextKind(["decision"])).toBe(false);
  });
});

describe("priority bounds", () => {
  it("accepts the whole documented range and nothing beside it", () => {
    for (let p = MIN_PRIORITY; p <= MAX_PRIORITY; p++) expect(isPriority(p)).toBe(true);
    expect(isPriority(MIN_PRIORITY - 1)).toBe(false);
    expect(isPriority(MAX_PRIORITY + 1)).toBe(false);
  });

  it("refuses the out-of-range numbers a crafted POST can carry", () => {
    // These reached the column: the old code was `Number(fd.get(k)) || 2`,
    // which only replaced the falsy ones.
    expect(isPriority(999)).toBe(false);
    expect(isPriority(-5)).toBe(false);
  });

  it("refuses NaN, which is what Number() makes of a word", () => {
    // `Number("high")` is NaN, and NaN is falsy -- so `|| 2` quietly turned a
    // nonsense priority into a normal one instead of refusing it.
    expect(isPriority(Number("high"))).toBe(false);
    expect(isPriority(Number.NaN)).toBe(false);
  });

  it("refuses a fraction and an infinity", () => {
    expect(isPriority(1.5)).toBe(false);
    expect(isPriority(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("refuses a numeric string, because the caller must convert first", () => {
    // Left as a string it would compare fine with < and >, and sort wrong
    // everywhere afterwards.
    expect(isPriority("2")).toBe(false);
  });
});
