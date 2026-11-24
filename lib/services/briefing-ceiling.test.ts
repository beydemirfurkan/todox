import { describe, expect, it } from "vitest";
import { BRIEFING_MAX_CHARS, fitToCeiling, type Fittable, type LiveTask } from "./briefing-ceiling";

/**
 * The bound on the whole briefing.
 *
 * Every other bound is per axis, and the payload outgrew the client anyway: a
 * refused `get_context` is written to a file nobody opens. What these tests
 * hold is that the payload fits, that what was cut is counted, and that the
 * order of the cuts is the order of what matters least.
 */

const head = (n: number) => `${"h".repeat(200)} ${n}`;
const record = (n: number, body: string | null = null) => ({ id: n, head: head(n), body });

const liveTask = (id: number, over: Partial<LiveTask> = {}): LiveTask => ({
  id,
  title: `task ${id}`,
  status: "todo",
  priority: 2,
  updated_at: "2026-11-20T00:00:00Z",
  head: head(id),
  body: null,
  last_handoff: { ...record(id * 100), created_at: "2026-11-20T00:00:00Z" },
  decisions: [record(1), record(2), record(3)],
  dead_ends: [record(4), record(5), record(6)],
  open_questions: [],
  files: [],
  entry_count: 7,
  ...over,
});

const liveTasks = (count: number, over: (id: number) => Partial<LiveTask> = () => ({})): LiveTask[] =>
  Array.from({ length: count }, (_, i) => liveTask(i + 1, over(i + 1)));

const idleLine = (id: number) => ({ id, title: `task ${id}`, idle_days: 30, last_handoff: { head: head(id) } });

const brief = (over: Partial<Fittable> = {}): Fittable => ({
  global_context: [],
  project_context: [],
  context_omitted: 0,
  open_tasks: [],
  idle_tasks: [],
  open_tasks_omitted: 0,
  log_bodies_omitted: 0,
  task_bodies_omitted: 0,
  ...over,
});

/** As sent: the MCP layer leaves empty lists out. */
const chars = (value: unknown) => JSON.stringify(value).replaceAll(/"\w+":\[\],?/g, "").length;
const ids = (tasks: object[]) => (tasks as { id: number }[]).map((t) => t.id);

describe("fitToCeiling", () => {
  it("returns a briefing that already fits unchanged", () => {
    const small = brief({ open_tasks: [liveTask(1)], project_context: [{ body: "rule" }] });
    expect(fitToCeiling(small)).toEqual({ ...small, condensed_tasks: [] });
  });

  it("brings twenty-eight live tasks under the ceiling and still names every one", () => {
    // The production shape: the bodies were budgeted, the records were not.
    const big = brief({ open_tasks: liveTasks(28), project_context: [{ body: "n".repeat(15_000) }] });
    expect(chars(big)).toBeGreaterThan(BRIEFING_MAX_CHARS);

    const fitted = fitToCeiling(big);
    expect(chars(fitted)).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect([...ids(fitted.open_tasks), ...ids(fitted.condensed_tasks)]).toHaveLength(28);
    expect(fitted.open_tasks_omitted).toBe(0);
    expect(fitted.project_context[0]!.body).not.toBeNull();
  });

  it("keeps queued work, work in progress and records with a body whole before list order", () => {
    const open_tasks = liveTasks(40, (id) => {
      if (id === 39) return { status: "doing" };
      if (id === 38) return { decisions: [record(1, "why")] };
      return {};
    });
    const fitted = fitToCeiling(brief({ open_tasks, requested: [{ id: 40 }] }), 24_000);

    const whole = ids(fitted.open_tasks);
    expect(whole).toEqual(expect.arrayContaining([38, 39, 40]));
    // What stays whole keeps the list's order; what does not is in the order worth reading.
    expect(whole).toEqual([...whole].sort((a, b) => a - b));
    const lines = ids(fitted.condensed_tasks);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  it("ranks the tiers among themselves: queued, then doing, then a body", () => {
    const open_tasks = [
      liveTask(1),
      liveTask(2, { decisions: [record(1, "why")] }),
      liveTask(3, { status: "doing" }),
      liveTask(4),
    ];
    const fitted = fitToCeiling(brief({ open_tasks, requested: [{ id: 4 }] }), 3_700);
    expect(ids(fitted.open_tasks)).toEqual([4]);
    expect(ids(fitted.condensed_tasks)).toEqual([3, 2, 1]);
  });

  it("carries a condensed task as a line with its last handoff's head and its files", () => {
    const files = [{ id: 7, path: "/repo/a.ts" }];
    const fitted = fitToCeiling(brief({ open_tasks: liveTasks(30, () => ({ files })) }), 24_000);
    expect(fitted.condensed_tasks.at(-1)).toEqual({
      id: 30,
      title: "task 30",
      status: "todo",
      priority: 2,
      updated_at: "2026-11-20T00:00:00Z",
      last_handoff: { id: 3000, created_at: "2026-11-20T00:00:00Z", head: head(3000) },
      files,
      entry_count: 7,
    });
  });

  it("stops counting a condensed task's records as carried without a body", () => {
    const fitted = fitToCeiling(
      brief({ open_tasks: liveTasks(30), log_bodies_omitted: 30 * 7, task_bodies_omitted: 30 }),
      24_000,
    );
    expect(fitted.condensed_tasks.length).toBeGreaterThan(0);
    expect(fitted.log_bodies_omitted).toBe(fitted.open_tasks.length * 7);
    expect(fitted.task_bodies_omitted).toBe(fitted.open_tasks.length);
  });

  it("does not discount a task that never had a body", () => {
    const bare = liveTasks(30, () => ({ head: "", body: null }));
    expect(fitToCeiling(brief({ open_tasks: bare }), 24_000).task_bodies_omitted).toBe(0);
  });

  it("drops idle lines before condensed ones, from the end, and counts each as omitted", () => {
    const idle = Array.from({ length: 80 }, (_, i) => idleLine(100 + i));
    const fitted = fitToCeiling(brief({ open_tasks: liveTasks(10), idle_tasks: idle }), 20_000);

    expect(chars(fitted)).toBeLessThanOrEqual(20_000);
    expect(fitted.condensed_tasks).toHaveLength(9);
    expect(fitted.idle_tasks.length).toBeLessThan(80);
    expect(fitted.open_tasks_omitted).toBe(80 - fitted.idle_tasks.length);
    expect(ids(fitted.idle_tasks)).toEqual(ids(idle).slice(0, fitted.idle_tasks.length));
  });

  it("takes note bodies only after every task line is gone, project notes first", () => {
    const fitted = fitToCeiling(
      brief({
        open_tasks: [liveTask(1)],
        idle_tasks: [idleLine(9)],
        project_context: Array.from({ length: 10 }, () => ({ body: "n".repeat(5_000) })),
        global_context: [{ body: "g".repeat(2_000) }],
      }),
    );
    expect(chars(fitted)).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(fitted.idle_tasks).toEqual([]);
    expect(fitted.global_context[0]!.body).not.toBeNull();
    // Least relevant first: the ones kept are the front of the ranking.
    const kept = fitted.project_context.map((n) => n.body !== null);
    const keptCount = kept.filter(Boolean).length;
    expect(kept.slice(0, keptCount).every(Boolean)).toBe(true);
    expect(fitted.context_omitted).toBe(10 - keptCount);
  });

  it("never cuts what somebody queued", () => {
    const requested = [{ id: 1, body: "r".repeat(2_000) }];
    expect(fitToCeiling(brief({ open_tasks: liveTasks(5), requested }), 10).requested).toEqual(requested);
  });

  it("does not change the briefing it was given", () => {
    const original = brief({ open_tasks: liveTasks(40), project_context: [{ body: "n".repeat(50_000) }] });
    const before = JSON.stringify(original);
    fitToCeiling(original);
    expect(JSON.stringify(original)).toBe(before);
  });
});
