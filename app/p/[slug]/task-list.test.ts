import { describe, expect, it } from "vitest";

import type { Status } from "@/lib/constants";

import {
  compareTasks,
  isClosed,
  matchesFilter,
  paginate,
  resolveFilter,
  PAGE,
  type FilterId,
} from "./task-list";

/**
 * The answerable part of the project page. Filtering and ordering are right or
 * wrong; the six hundred lines around them are markup, and standing the page
 * up to reach these would assert the markup instead.
 */
const task = (status: Status, priority = 2, updated_at = "2026-08-01T00:00:00Z") => ({
  status,
  priority,
  updated_at,
});

/** The pills the page actually offers. */
const AVAILABLE: FilterId[] = ["open", "doing", "blocked", "todo", "done"];

describe("resolveFilter", () => {
  it("takes a filter the page offers", () => {
    for (const id of AVAILABLE) expect(resolveFilter(id, AVAILABLE)).toBe(id);
  });

  it("falls back to the default view for anything else", () => {
    // `?s=` is caller-controlled. Anything unrecognised has to land on a view
    // with content, not on an empty one.
    for (const asked of ["", "nonsense", "all", "DONE", "../etc", undefined]) {
      expect(resolveFilter(asked, AVAILABLE), String(asked)).toBe("open");
    }
  });

  it("reads the first value when the parameter is repeated", () => {
    expect(resolveFilter(["doing", "todo"], AVAILABLE)).toBe("doing");
  });

  it("refuses a filter that exists in the type but not on the page", () => {
    // The guard is what makes the pill list authoritative: adding a filter
    // means adding it there, not just to a union somewhere.
    expect(resolveFilter("todo", ["open", "doing"])).toBe("open");
  });
});

describe("matchesFilter", () => {
  const STATUSES: Status[] = ["doing", "blocked", "todo", "done", "dropped"];

  it("open means everything that is not finished with", () => {
    const open = STATUSES.filter((s) => matchesFilter(task(s), "open"));
    expect(open).toEqual(["doing", "blocked", "todo"]);
  });

  it("done covers dropped as well, because the pill says both", () => {
    const closed = STATUSES.filter((s) => matchesFilter(task(s), "done"));
    expect(closed).toEqual(["done", "dropped"]);
  });

  it("every other filter is exactly its own status", () => {
    for (const only of ["doing", "blocked", "todo"] as const) {
      const matched = STATUSES.filter((s) => matchesFilter(task(s), only));
      expect(matched, only).toEqual([only]);
    }
  });

  it("never leaves a status out of every filter", () => {
    // A status that matches no pill is invisible on the page while still
    // counting in the totals beside it.
    for (const status of STATUSES) {
      const shown = AVAILABLE.some((f) => matchesFilter(task(status), f));
      expect(shown, status).toBe(true);
    }
  });
});

describe("compareTasks", () => {
  const order = (rows: ReturnType<typeof task>[]) =>
    [...rows].sort(compareTasks).map((r) => r.status);

  it("puts work in flight first and finished work last", () => {
    expect(
      order([task("dropped"), task("todo"), task("done"), task("doing"), task("blocked")]),
    ).toEqual(["doing", "blocked", "todo", "done", "dropped"]);
  });

  it("breaks a tie on priority, urgent first", () => {
    const rows = [task("todo", 3), task("todo", 1), task("todo", 2)];
    expect([...rows].sort(compareTasks).map((r) => r.priority)).toEqual([1, 2, 3]);
  });

  it("breaks the remaining tie on most recently touched", () => {
    const older = task("todo", 2, "2026-01-01T00:00:00Z");
    const newer = task("todo", 2, "2026-08-01T00:00:00Z");
    expect([...[older, newer]].sort(compareTasks)[0]).toBe(newer);
    expect([...[newer, older]].sort(compareTasks)[0]).toBe(newer);
  });

  it("ranks status above priority, so an urgent finished task stays down", () => {
    const urgentDone = task("done", 1);
    const idleDoing = task("doing", 3);
    expect([urgentDone, idleDoing].sort(compareTasks)[0]).toBe(idleDoing);
  });
});

describe("paginate", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("says how many it left out", () => {
    // The bug this replaces: the closed list was silently cut at twenty, so a
    // project with more than that quietly looked smaller than it was.
    expect(paginate(rows(75))).toMatchObject({ omitted: 75 - PAGE });
    expect(paginate(rows(75)).shown).toHaveLength(PAGE);
  });

  it("omits nothing when everything fits", () => {
    expect(paginate(rows(3))).toEqual({ shown: [0, 1, 2], omitted: 0 });
    expect(paginate(rows(PAGE)).omitted).toBe(0);
  });

  it("handles an empty list without reporting a negative remainder", () => {
    expect(paginate([])).toEqual({ shown: [], omitted: 0 });
  });

  it("keeps the order it was given", () => {
    expect(paginate(rows(5), 3).shown).toEqual([0, 1, 2]);
  });
});

describe("isClosed", () => {
  it("is the one place done and dropped are treated as a pair", () => {
    expect(isClosed("done")).toBe(true);
    expect(isClosed("dropped")).toBe(true);
    for (const open of ["doing", "blocked", "todo"] as const) {
      expect(isClosed(open), open).toBe(false);
    }
  });
});
