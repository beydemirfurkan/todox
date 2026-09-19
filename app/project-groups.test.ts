import { describe, expect, it } from "vitest";

import { groupProjects, isLive } from "./project-groups";

/**
 * The dashboard's partition. A project with a task in `doing` or `blocked`
 * is live and gets a card; one with only queued or finished work is quiet
 * and gets a row; one the page already lists as empty appears in neither,
 * because it has its own fold.
 */
const project = (id: number) => ({ id, name: `p${id}` });
const counts = (doing: number, blocked: number) => ({ doing, blocked });

describe("isLive", () => {
  it("is true for work in flight, blocked included", () => {
    expect(isLive(counts(1, 0))).toBe(true);
    expect(isLive(counts(0, 1))).toBe(true);
  });

  it("is false for a project with nothing moving, or no tasks at all", () => {
    expect(isLive(counts(0, 0))).toBe(false);
    expect(isLive(undefined)).toBe(false);
  });
});

describe("groupProjects", () => {
  it("puts work in flight first and everything else in quiet", () => {
    const list = [project(1), project(2), project(3)];
    const byId = new Map([
      [1, counts(0, 0)],
      [2, counts(2, 0)],
      [3, counts(0, 1)],
    ]);
    const groups = groupProjects(list, byId, new Set());
    expect(groups.live.map((p) => p.id)).toEqual([2, 3]);
    expect(groups.quiet.map((p) => p.id)).toEqual([1]);
  });

  it("keeps the order it was given inside each group", () => {
    const list = [project(5), project(4), project(3), project(2)];
    const byId = new Map([
      [5, counts(1, 0)],
      [3, counts(1, 0)],
    ]);
    const groups = groupProjects(list, byId, new Set());
    expect(groups.live.map((p) => p.id)).toEqual([5, 3]);
    expect(groups.quiet.map((p) => p.id)).toEqual([4, 2]);
  });

  it("leaves an empty project out of both, because it has its own fold", () => {
    const list = [project(1), project(2)];
    const groups = groupProjects(list, new Map(), new Set([2]));
    expect(groups.live).toEqual([]);
    expect(groups.quiet.map((p) => p.id)).toEqual([1]);
  });

  it("treats a project with no counts row as quiet, not live", () => {
    // `countsByProject` only returns rows for projects that have tasks; a
    // project holding notes and no tasks has no row and must not be dropped.
    const groups = groupProjects([project(1)], new Map(), new Set());
    expect(groups.quiet.map((p) => p.id)).toEqual([1]);
  });
});
