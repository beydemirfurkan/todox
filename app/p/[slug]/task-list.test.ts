import { describe, expect, it } from "vitest";

import type { Status } from "@/lib/constants";

import {
  CLOSED_SHOWN,
  QUEUED_SHOWN,
  compareClosed,
  compareTasks,
  groupTasks,
  isClosed,
  matchesFilter,
  paginate,
} from "./task-list";

/**
 * The answerable part of the project page. Grouping and ordering are right or
 * wrong; the six hundred lines around them are markup, and standing the page
 * up to reach these would assert the markup instead.
 */
const task = (
  status: Status,
  priority = 2,
  updated_at = "2026-08-01T00:00:00Z",
  closed_at: string | null = null,
) => ({ status, priority, updated_at, closed_at });

const STATUSES: Status[] = ["doing", "blocked", "todo", "done", "dropped"];

describe("matchesFilter", () => {
  it("open means everything that is not finished with", () => {
    const open = STATUSES.filter((s) => matchesFilter(task(s), "open"));
    expect(open).toEqual(["doing", "blocked", "todo"]);
  });

  it("done covers dropped as well, because the group says both", () => {
    const closed = STATUSES.filter((s) => matchesFilter(task(s), "done"));
    expect(closed).toEqual(["done", "dropped"]);
  });

  it("every other filter is exactly its own status", () => {
    for (const only of ["doing", "blocked", "todo"] as const) {
      const matched = STATUSES.filter((s) => matchesFilter(task(s), only));
      expect(matched, only).toEqual([only]);
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

describe("compareClosed", () => {
  it("puts the most recently closed first", () => {
    const early = task("done", 2, "2026-08-09T00:00:00Z", "2026-08-01T00:00:00Z");
    const late = task("done", 2, "2026-08-02T00:00:00Z", "2026-08-08T00:00:00Z");
    expect([early, late].sort(compareClosed)[0]).toBe(late);
  });

  it("lets updated_at stand in for a row closed before the column existed", () => {
    // A null that sorted to one end would put the oldest history at the top.
    const legacy = task("done", 2, "2026-08-05T00:00:00Z", null);
    const older = task("done", 2, "2026-08-09T00:00:00Z", "2026-08-01T00:00:00Z");
    const newer = task("done", 2, "2026-08-02T00:00:00Z", "2026-08-08T00:00:00Z");
    expect([older, legacy, newer].sort(compareClosed)).toEqual([newer, legacy, older]);
  });
});

describe("paginate", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("says how many it left out", () => {
    // The bug this replaces: the closed list was silently cut at twenty, so a
    // project with more than that quietly looked smaller than it was.
    expect(paginate(rows(75), 60)).toMatchObject({ omitted: 15 });
    expect(paginate(rows(75), 60).shown).toHaveLength(60);
  });

  it("omits nothing when everything fits", () => {
    expect(paginate(rows(3), 60)).toEqual({ shown: [0, 1, 2], omitted: 0 });
    expect(paginate(rows(60), 60).omitted).toBe(0);
  });

  it("handles an empty list without reporting a negative remainder", () => {
    expect(paginate([], 60)).toEqual({ shown: [], omitted: 0 });
  });

  it("keeps the order it was given", () => {
    expect(paginate(rows(5), 3).shown).toEqual([0, 1, 2]);
  });
});

/**
 * The groups replaced the filter pills, and the property the pills had to be
 * tested for -- no status invisible on the page while it counts in the totals
 * -- the groups get by construction. This is the assertion that keeps it.
 */
describe("groupTasks", () => {
  const rows = (status: Status, n: number, priority = 2) =>
    Array.from({ length: n }, (_, i) =>
      task(status, priority, `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`),
    );

  it("lands every status in exactly one group, and the counts add up", () => {
    const all = STATUSES.map((s) => task(s));
    const g = groupTasks(all);
    const placed = [...g.inFlight, ...g.queued.shown, ...g.closed.shown];
    expect(placed).toHaveLength(all.length);
    expect(new Set(placed).size).toBe(all.length);
    expect(g.counts).toEqual({ doing: 1, blocked: 1, todo: 1, closed: 2 });
    expect(g.counts.doing + g.counts.blocked + g.counts.todo + g.counts.closed).toBe(all.length);
  });

  it("orders work in flight doing before blocked, then urgent, then recent", () => {
    const g = groupTasks([
      task("blocked", 1),
      task("doing", 2, "2026-01-01T00:00:00Z"),
      task("doing", 2, "2026-08-01T00:00:00Z"),
      task("doing", 1),
    ]);
    expect(g.inFlight.map((t) => [t.status, t.priority, t.updated_at.slice(0, 7)])).toEqual([
      ["doing", 1, "2026-08"],
      ["doing", 2, "2026-08"],
      ["doing", 2, "2026-01"],
      ["blocked", 1, "2026-08"],
    ]);
  });

  it("never caps work in flight", () => {
    // Sixty-one tasks 'doing' is a different problem than a long page, and
    // hiding some of them would be the page lying about the first thing it
    // is for.
    const g = groupTasks(rows("doing", 61));
    expect(g.inFlight).toHaveLength(61);
  });

  it("caps the queue and says what it left out", () => {
    const g = groupTasks(rows("todo", QUEUED_SHOWN + 7));
    expect(g.queued.shown).toHaveLength(QUEUED_SHOWN);
    expect(g.queued.omitted).toBe(7);
    expect(g.queued.total).toBe(QUEUED_SHOWN + 7);
  });

  it("caps closed work, newest close first", () => {
    const closed = Array.from({ length: CLOSED_SHOWN + 3 }, (_, i) =>
      task("done", 2, "2026-01-01T00:00:00Z", `2026-08-${String(1 + i).padStart(2, "0")}T00:00:00Z`),
    );
    const g = groupTasks(closed);
    expect(g.closed.shown).toHaveLength(CLOSED_SHOWN);
    expect(g.closed.omitted).toBe(3);
    expect(g.closed.total).toBe(CLOSED_SHOWN + 3);
    expect(g.closed.shown[0]!.closed_at).toBe(`2026-08-${CLOSED_SHOWN + 3}T00:00:00Z`);
  });

  it("puts dropped work in the closed group beside done", () => {
    const g = groupTasks([task("dropped"), task("done")]);
    expect(g.closed.shown.map((t) => t.status).sort()).toEqual(["done", "dropped"]);
    expect(g.inFlight).toEqual([]);
    expect(g.queued.shown).toEqual([]);
  });

  it("answers empty groups and zero omissions for an empty project", () => {
    expect(groupTasks([])).toEqual({
      inFlight: [],
      queued: { shown: [], omitted: 0, total: 0 },
      closed: { shown: [], omitted: 0, total: 0 },
      counts: { doing: 0, blocked: 0, todo: 0, closed: 0 },
    });
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
