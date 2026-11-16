import { describe, expect, it } from "vitest";

import {
  QUIET_AFTER_DAYS,
  boardHref,
  newest,
  panelView,
  quietDays,
  selectTaskId,
} from "./board";

/**
 * The board's address is caller-supplied text, so the part worth asserting is
 * what happens when it is wrong: an unknown view, an id from another project,
 * a value sent twice.
 */
describe("panelView", () => {
  it("reads a known view", () => {
    expect(panelView("notes")).toBe("notes");
    expect(panelView("closed")).toBe("closed");
  });

  it("falls back to the task view for anything else", () => {
    expect(panelView(undefined)).toBe("task");
    expect(panelView("everything")).toBe("task");
    expect(panelView("")).toBe("task");
  });

  it("takes the first of a repeated parameter", () => {
    expect(panelView(["closed", "notes"])).toBe("closed");
  });
});

describe("selectTaskId", () => {
  const known = new Set([4, 7, 9]);

  it("takes the asked id when it is one of this project's tasks", () => {
    expect(selectTaskId("7", known, [4])).toBe(7);
  });

  it("ignores an id the project does not hold, without saying so", () => {
    expect(selectTaskId("123", known, [9, 4])).toBe(9);
  });

  it("ignores text that is not an id", () => {
    expect(selectTaskId("7; DROP", known, [4])).toBe(4);
    expect(selectTaskId("", known, [4])).toBe(4);
    expect(selectTaskId(undefined, known, [4])).toBe(4);
  });

  it("skips fallbacks that are missing or unknown", () => {
    expect(selectTaskId(undefined, known, [undefined, 55, 9])).toBe(9);
  });

  it("is null when there is nothing to show", () => {
    expect(selectTaskId("7", new Set(), [7])).toBeNull();
    expect(selectTaskId(undefined, known, [])).toBeNull();
  });
});

describe("boardHref", () => {
  it("leaves the defaults out", () => {
    expect(boardHref("todox", { task: null, view: "task" })).toBe("/p/todox");
  });

  it("carries the task and a non-default view", () => {
    expect(boardHref("todox", { task: 7, view: "task" })).toBe("/p/todox?task=7");
    expect(boardHref("todox", { task: 7, view: "notes" })).toBe("/p/todox?task=7&view=notes");
    expect(boardHref("todox", { task: null, view: "closed" })).toBe("/p/todox?view=closed");
  });

  it("round-trips through the readers", () => {
    const query = new URL(boardHref("todox", { task: 9, view: "closed" }), "http://x").searchParams;
    expect(panelView(query.get("view") ?? undefined)).toBe("closed");
    expect(selectTaskId(query.get("task") ?? undefined, new Set([9]), [])).toBe(9);
  });
});

describe("quietDays", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("counts whole days for a task left in doing", () => {
    expect(quietDays({ status: "doing", updated_at: daysAgo(31) }, now)).toBe(31);
  });

  it("says nothing before the threshold", () => {
    expect(quietDays({ status: "doing", updated_at: daysAgo(QUIET_AFTER_DAYS - 1) }, now)).toBeNull();
    expect(quietDays({ status: "doing", updated_at: daysAgo(QUIET_AFTER_DAYS) }, now)).toBe(
      QUIET_AFTER_DAYS,
    );
  });

  it("never calls queued, blocked or closed work quiet", () => {
    for (const status of ["todo", "blocked", "done", "dropped"] as const) {
      expect(quietDays({ status, updated_at: daysAgo(90) }, now)).toBeNull();
    }
  });
});

describe("newest", () => {
  it("picks the highest id", () => {
    expect(newest([{ id: 3 }, { id: 11 }, { id: 5 }])).toEqual({ id: 11 });
  });

  it("is undefined for nothing", () => {
    expect(newest([])).toBeUndefined();
  });
});
