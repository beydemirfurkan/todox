import { describe, expect, it } from "vitest";

import type { Ref } from "../types";
import { freshness } from "./refs";

const A = "a".repeat(64);
const B = "b".repeat(64);

const ref = (over: Partial<Ref> = {}): Ref => ({
  id: 1,
  task_id: 1,
  context_id: null,
  path: "/repo/lib/thing.ts",
  note: null,
  hash: A,
  linked_at: "2026-08-01T00:00:00.000Z",
  hash_seen: null,
  checked_at: null,
  ...over,
});

/**
 * freshness compares two recorded hashes and nothing else. It used to re-read
 * the file, which stopped meaning anything the moment this code started
 * running on a web host with no checkout — every hash came back null and the
 * answer was "unknown" for ever.
 */
describe("freshness", () => {
  it("is unknown until an agent has looked", () => {
    expect(freshness(ref())).toBe("unknown");
  });

  it("is unknown when nothing was recorded at link time", () => {
    expect(freshness(ref({ hash: null, hash_seen: A, checked_at: "x" }))).toBe("unknown");
  });

  it("is fresh when the file still matches", () => {
    expect(freshness(ref({ hash_seen: A, checked_at: "x" }))).toBe("fresh");
  });

  it("is changed when it does not", () => {
    expect(freshness(ref({ hash_seen: B, checked_at: "x" }))).toBe("changed");
  });

  it("is missing when the agent looked and found nothing", () => {
    // Distinct from "never checked": null hash_seen only means gone once
    // checked_at is set.
    expect(freshness(ref({ hash_seen: null, checked_at: "x" }))).toBe("missing");
  });
});
