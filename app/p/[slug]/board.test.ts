import { describe, expect, it } from "vitest";

import {
  QUIET_AFTER_DAYS,
  newest,
  projectHref,
  projectTab,
  quietDays,
  taskView,
} from "./board";

/**
 * The project's address is caller-supplied text, so the part worth asserting
 * is what happens when it is wrong: an unknown value, a value sent twice.
 */
describe("projectTab", () => {
  it("reads a known section", () => {
    expect(projectTab("notes")).toBe("notes");
    expect(projectTab("tasks")).toBe("tasks");
  });

  it("falls back to the tasks for anything else", () => {
    expect(projectTab(undefined)).toBe("tasks");
    expect(projectTab("everything")).toBe("tasks");
    expect(projectTab("")).toBe("tasks");
  });

  it("takes the first of a repeated parameter", () => {
    expect(projectTab(["notes", "tasks"])).toBe("notes");
  });
});

describe("taskView", () => {
  it("reads the board, and falls back to the list", () => {
    expect(taskView("board")).toBe("board");
    expect(taskView("list")).toBe("list");
    expect(taskView(undefined)).toBe("list");
    expect(taskView("closed")).toBe("list");
  });
});

describe("projectHref", () => {
  it("leaves the defaults out", () => {
    expect(projectHref("todox", { tab: "tasks", view: "list" })).toBe("/p/todox");
  });

  it("carries a non-default section and layout", () => {
    expect(projectHref("todox", { tab: "tasks", view: "board" })).toBe("/p/todox?view=board");
    expect(projectHref("todox", { tab: "notes", view: "list" })).toBe("/p/todox?tab=notes");
  });

  it("round-trips through the readers", () => {
    const query = new URL(projectHref("todox", { tab: "notes", view: "board" }), "http://x")
      .searchParams;
    expect(projectTab(query.get("tab") ?? undefined)).toBe("notes");
    expect(taskView(query.get("view") ?? undefined)).toBe("board");
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
