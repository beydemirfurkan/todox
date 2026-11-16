import { describe, expect, it } from "vitest";

import { waitingItems } from "./waiting";

const now = new Date("2026-11-16T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const question = (task_id: number, project_id = 1) => ({
  task_id,
  project_id,
  task_title: `task ${task_id}`,
  body: `question on ${task_id}`,
  created_at: daysAgo(3),
});
const stalled = (id: number, status: "doing" | "blocked", days: number, project_id = 1) => ({
  id,
  project_id,
  title: `task ${id}`,
  status,
  updated_at: daysAgo(days),
});
const page = <T,>(rows: T[], total = rows.length) => ({ rows, total });

describe("waitingItems", () => {
  it("lists questions before stalled work", () => {
    const { items } = waitingItems({
      questions: page([question(5)]),
      stalled: page([stalled(2, "blocked", 40), stalled(3, "doing", 30)]),
      limit: 6,
      now,
    });
    expect(items.map((item) => [item.kind, item.taskId])).toEqual([
      ["question", 5],
      ["blocked", 2],
      ["quiet", 3],
    ]);
  });

  it("carries the question's text and the quiet task's days, and nothing invented", () => {
    const { items } = waitingItems({
      questions: page([question(5)]),
      stalled: page([stalled(2, "blocked", 40), stalled(3, "doing", 30)]),
      limit: 6,
      now,
    });
    expect(items[0].detail).toBe("question on 5");
    expect(items[0].quietDays).toBeNull();
    expect(items[1].detail).toBeNull();
    expect(items[1].quietDays).toBeNull();
    expect(items[2].quietDays).toBe(30);
  });

  it("lists a task with two open questions once, and counts the other", () => {
    const { items, omitted } = waitingItems({
      questions: page([question(5), question(5), question(7)]),
      stalled: page([]),
      limit: 6,
      now,
    });
    expect(items.map((item) => item.taskId)).toEqual([5, 7]);
    expect(omitted).toBe(1);
  });

  it("does not list a task twice when its question is already shown", () => {
    const { items, omitted } = waitingItems({
      questions: page([question(2)]),
      stalled: page([stalled(2, "blocked", 40)]),
      limit: 6,
      now,
    });
    expect(items.map((item) => item.kind)).toEqual(["question"]);
    expect(omitted).toBe(0);
  });

  it("counts what it left out from the totals, not from the rows it was given", () => {
    const { items, omitted } = waitingItems({
      questions: page([question(1), question(2)], 10),
      stalled: page([stalled(3, "doing", 30), stalled(4, "blocked", 20)], 54),
      limit: 3,
      now,
    });
    expect(items).toHaveLength(3);
    expect(omitted).toBe(61);
  });

  it("is empty when nothing waits", () => {
    expect(waitingItems({ questions: page([]), stalled: page([]), limit: 6, now })).toEqual({
      items: [],
      omitted: 0,
    });
  });
});
