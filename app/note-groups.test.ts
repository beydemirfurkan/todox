import { describe, expect, it } from "vitest";

import type { ContextKind } from "@/lib/constants";

import { groupNotes, NOTE_KIND_ORDER, NOTES_PER_KIND } from "./note-groups";

/**
 * The order standing notes are read in. The database answers by kind
 * alphabetically -- conventions first -- and the page used to show the first
 * six, so a project with seven conventions never showed a gotcha. What bites
 * comes first here, and nothing is cut: past `NOTES_PER_KIND` a kind folds.
 */
let seq = 0;
const note = (kind: ContextKind, updated_at = "2026-08-01T00:00:00Z") => ({
  id: ++seq,
  kind,
  updated_at,
});

describe("groupNotes", () => {
  it("reads gotchas first, then decisions, conventions, preferences", () => {
    const groups = groupNotes([
      note("preference"),
      note("convention"),
      note("decision"),
      note("gotcha"),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(NOTE_KIND_ORDER);
  });

  it("leaves out a kind with nothing in it, rather than an empty heading", () => {
    const groups = groupNotes([note("decision"), note("gotcha")]);
    expect(groups.map((g) => g.kind)).toEqual(["gotcha", "decision"]);
  });

  it("puts the newest first inside a kind, whatever order they arrived in", () => {
    const old = note("gotcha", "2026-01-01T00:00:00Z");
    const mid = note("gotcha", "2026-05-01T00:00:00Z");
    const recent = note("gotcha", "2026-08-01T00:00:00Z");
    const [group] = groupNotes([mid, old, recent]);
    expect(group!.shown).toEqual([recent, mid, old]);
  });

  it("breaks a same-second tie on id, newest id first", () => {
    const a = note("decision", "2026-08-01T00:00:00Z");
    const b = note("decision", "2026-08-01T00:00:00Z");
    const [group] = groupNotes([a, b]);
    expect(group!.shown.map((n) => n.id)).toEqual([b.id, a.id]);
  });

  it("folds a kind past the ceiling instead of cutting it", () => {
    const many = Array.from({ length: NOTES_PER_KIND + 3 }, (_, i) =>
      note("convention", `2026-08-${String(1 + i).padStart(2, "0")}T00:00:00Z`),
    );
    const [group] = groupNotes(many);
    expect(group!.shown).toHaveLength(NOTES_PER_KIND);
    expect(group!.rest).toHaveLength(3);
    // Every note is somewhere, exactly once.
    expect(new Set([...group!.shown, ...group!.rest]).size).toBe(many.length);
  });

  it("takes a ceiling of its own when asked", () => {
    const [group] = groupNotes([note("gotcha"), note("gotcha"), note("gotcha")], 2);
    expect(group!.shown).toHaveLength(2);
    expect(group!.rest).toHaveLength(1);
  });

  it("answers nothing for no notes", () => {
    expect(groupNotes([])).toEqual([]);
  });
});
