import { describe, expect, it } from "vitest";

import { bytes, foundWithin, reachableWithin, recallAt, score } from "./measure";

describe("bytes", () => {
  it("counts what goes over the wire, not what is in memory", () => {
    expect(bytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });

  it("counts a Turkish character as the bytes it actually costs", () => {
    // `"ş".length` is 1 and its UTF-8 encoding is 2, and half this log is
    // Turkish — counting characters would under-report the payload quietly.
    // Four here: two for the letter, one for each JSON quote.
    expect(bytes("ş")).toBe(4);
    expect(bytes("s")).toBe(3);
  });

  it("does not throw on a missing value", () => {
    expect(bytes(undefined)).toBe(4); // null
  });
});

describe("foundWithin", () => {
  const hit = (id: number, type = "context") => ({ type, id });

  it("finds the answer inside the window", () => {
    expect(foundWithin([hit(1), hit(2), hit(3)], hit(3), 5)).toBe(true);
  });

  it("does not count an answer past it", () => {
    // The whole point of measuring at a small k: a right answer at rank twelve
    // is a right answer nobody reads.
    expect(foundWithin([hit(1), hit(2), hit(3)], hit(3), 2)).toBe(false);
  });

  it("does not confuse a task with a note that shares an id", () => {
    // The ids are per table, so `#4` alone is ambiguous — matching on it would
    // score a wrong row as right and flatter every run.
    expect(foundWithin([hit(4, "task")], hit(4, "context"), 5)).toBe(false);
  });

  it("scores an empty result as a miss rather than throwing", () => {
    expect(foundWithin([], hit(1), 5)).toBe(false);
  });
});

describe("recallAt", () => {
  const answers = [
    { question: "found it", hits: [{ type: "context", id: 1 }], expected: { type: "context", id: 1 } },
    { question: "missed it", hits: [], expected: { type: "context", id: 2 } },
  ];

  it("counts what was found", () => {
    expect(recallAt(5, answers)).toMatchObject({ asked: 2, found: 1 });
  });

  it("names what it missed, so a run says what it failed at", () => {
    // A number alone tells you the score and not what to fix.
    expect(recallAt(5, answers).missed).toEqual(["missed it"]);
  });

  it("handles an empty run without dividing by zero", () => {
    expect(score(recallAt(5, []))).toContain("0%");
  });
});

/**
 * The looser column, and why it is worth reporting beside the strict one.
 *
 * Most of what is worth finding lives in an entry, not in the task's own title
 * or body — a dead end is an entry. So a search that "works" often returns the
 * entry and leaves the agent one `get_task` away from the thing it asked for.
 */
describe("reachableWithin", () => {
  const task = { type: "task", id: 7 };

  it("counts the answer itself", () => {
    expect(reachableWithin([task], task, 5)).toBe(true);
  });

  it("counts an entry that names the task", () => {
    expect(reachableWithin([{ type: "entry", id: 99, task_id: 7 }], task, 5)).toBe(true);
  });

  it("does not count an entry belonging to a different task", () => {
    expect(reachableWithin([{ type: "entry", id: 99, task_id: 8 }], task, 5)).toBe(false);
  });

  it("does not stretch for a context note, which nothing points at", () => {
    // A note has no parent, so there is no second call that reaches it from a
    // neighbouring row. Strict and reachable are the same number for notes.
    const note = { type: "context", id: 7 };
    expect(reachableWithin([{ type: "entry", id: 99, task_id: 7 }], note, 5)).toBe(false);
  });

  it("still respects the window", () => {
    const filler = Array.from({ length: 5 }, (_, i) => ({ type: "context", id: i }));
    expect(reachableWithin([...filler, { type: "entry", id: 99, task_id: 7 }], task, 5)).toBe(false);
  });
});
