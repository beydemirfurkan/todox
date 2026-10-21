import { describe, expect, it } from "vitest";
import { BRIEFING_MAX_CHARS, fitToCeiling, type Fittable, type LiveTask, type TaskLine } from "./briefing-ceiling";

/**
 * The bound on the whole briefing.
 *
 * Every other bound in the briefing is per axis, and the payload outgrew the
 * client anyway: 52 of 61 `get_context` results on one machine were refused
 * as too large and never read. What these tests hold is that the payload
 * fits, that what was cut is counted, and that the order of the cuts is the
 * order of what matters least.
 */

const head = (n: number) => `${"h".repeat(200)} ${n}`;

const liveTask = (id: number, over: Partial<LiveTask> = {}): LiveTask => ({
  id,
  title: `task ${id}`,
  status: "doing",
  priority: 2,
  updated_at: "2026-10-20T00:00:00Z",
  head: head(id),
  body: null,
  last_handoff: { id: id * 100, created_at: "2026-10-20T00:00:00Z", head: head(id), body: null },
  decisions: Array.from({ length: 3 }, () => ({ id: 1, head: head(id), body: null })),
  dead_ends: Array.from({ length: 3 }, () => ({ id: 2, head: head(id), body: null })),
  open_questions: [],
  entry_count: 7,
  ...over,
});

const line = (id: number): TaskLine => ({
  id,
  title: `task ${id}`,
  status: "todo",
  priority: 3,
  updated_at: "2026-09-01T00:00:00Z",
  last_handoff: { id: id * 100, created_at: "2026-09-01T00:00:00Z", head: head(id) },
  entry_count: 1,
});

const brief = (over: Partial<Fittable> = {}): Fittable => ({
  global_context: [],
  project_context: [],
  context_omitted: 0,
  open_tasks: [],
  condensed_tasks: [],
  idle_tasks: [],
  open_tasks_omitted: 0,
  log_bodies_omitted: 0,
  task_bodies_omitted: 0,
  ...over,
});

const chars = (value: unknown) => JSON.stringify(value).length;

describe("fitToCeiling", () => {
  it("returns a briefing that already fits unchanged", () => {
    const small = brief({ open_tasks: [liveTask(1)], project_context: [{ body: "rule" }] });
    expect(fitToCeiling(small)).toEqual(small);
  });

  it("brings thirty live tasks of head-only records under the ceiling", () => {
    // The production shape: the bodies were budgeted, the records were not.
    const tasks = Array.from({ length: 30 }, (_, i) => liveTask(i + 1));
    const big = brief({ open_tasks: tasks, log_bodies_omitted: 30 * 7, task_bodies_omitted: 30 });
    expect(chars(big)).toBeGreaterThan(BRIEFING_MAX_CHARS);

    const fitted = fitToCeiling(big);
    expect(chars(fitted)).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    // Whole tasks are the front of the list, lines the rest, none lost.
    const whole = fitted.open_tasks.map((t) => t.id);
    expect(whole).toEqual(tasks.slice(0, whole.length).map((t) => t.id));
    expect(whole.length).toBeLessThan(30);
    expect(whole.length + fitted.condensed_tasks.length).toBe(30);
  });

  it("condenses the least urgent first and keeps the list order", () => {
    const tasks = Array.from({ length: 30 }, (_, i) => liveTask(i + 1));
    const fitted = fitToCeiling(brief({ open_tasks: tasks }));
    const carried = fitted.condensed_tasks.map((t) => t.id);
    expect(carried).toEqual([...carried].sort((a, b) => a - b));
    expect(carried[0]).toBe(fitted.open_tasks.length + 1);
    expect(carried.at(-1)).toBe(30);
  });

  it("carries a condensed task as a line with its last handoff's head", () => {
    const tasks = Array.from({ length: 30 }, (_, i) => liveTask(i + 1));
    const fitted = fitToCeiling(brief({ open_tasks: tasks }));
    expect(fitted.condensed_tasks.at(-1)).toEqual({
      id: 30,
      title: "task 30",
      status: "doing",
      priority: 2,
      updated_at: "2026-10-20T00:00:00Z",
      last_handoff: { id: 3000, created_at: "2026-10-20T00:00:00Z", head: head(30) },
      entry_count: 7,
    });
  });

  it("stops counting a condensed task's records as carried without a body", () => {
    // Those counters mean "here, without a body". A condensed task's records
    // are not here at all; counting them would send the agent looking for
    // records the payload does not hold.
    const tasks = Array.from({ length: 30 }, (_, i) => liveTask(i + 1));
    const fitted = fitToCeiling(brief({ open_tasks: tasks, log_bodies_omitted: 30 * 7, task_bodies_omitted: 30 }));
    expect(fitted.log_bodies_omitted).toBe(fitted.open_tasks.length * 7);
    expect(fitted.task_bodies_omitted).toBe(fitted.open_tasks.length);
  });

  it("drops idle lines before condensed ones, and counts each as omitted", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => liveTask(i + 1));
    const idle = Array.from({ length: 80 }, (_, i) => line(100 + i));
    const fitted = fitToCeiling(brief({ open_tasks: tasks, idle_tasks: idle }));

    expect(chars(fitted)).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(fitted.open_tasks).toHaveLength(1);
    expect(fitted.condensed_tasks).toHaveLength(9);
    expect(fitted.idle_tasks.length).toBeLessThan(80);
    expect(fitted.open_tasks_omitted).toBe(80 - fitted.idle_tasks.length);
    // The ones kept are the front of the list, not an arbitrary subset.
    expect(fitted.idle_tasks.map((t) => t.id)).toEqual(idle.slice(0, fitted.idle_tasks.length).map((t) => t.id));
  });

  it("takes note bodies only after every task line is gone, project notes first", () => {
    const notes = Array.from({ length: 6 }, () => ({ body: "n".repeat(5_000) }));
    const global = [{ body: "g".repeat(2_000) }];
    const fitted = fitToCeiling(
      brief({ open_tasks: [liveTask(1)], idle_tasks: [line(9)], project_context: notes, global_context: global }),
    );

    expect(chars(fitted)).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(fitted.idle_tasks).toEqual([]);
    expect(fitted.global_context[0]!.body).not.toBeNull();
    // Least relevant first: the notes kept are the front of the ranking.
    const kept = fitted.project_context.map((n) => n.body !== null);
    expect(kept).toEqual([...kept].sort().reverse());
    expect(fitted.context_omitted).toBe(kept.filter((k) => !k).length);
  });

  it("does not change the briefing it was given", () => {
    const tasks = Array.from({ length: 30 }, (_, i) => liveTask(i + 1));
    const notes = [{ body: "n".repeat(30_000) }];
    const original = brief({ open_tasks: tasks, project_context: notes });
    const before = JSON.stringify(original);
    fitToCeiling(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("returns what it could when only heads are left", () => {
    // Nothing left to cut is not an error: the caller still gets a payload,
    // just one this function could not bring further down.
    const fitted = fitToCeiling(brief({ open_tasks: [liveTask(1)] }), 10);
    expect(fitted.open_tasks).toEqual([]);
    expect(fitted.condensed_tasks.map((t) => t.id)).toEqual([1]);
  });
});
