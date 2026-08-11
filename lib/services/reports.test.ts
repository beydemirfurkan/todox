import { describe, expect, it } from "vitest";

import type { Status } from "../constants";
import type { Task, TaskEvent } from "../types";
import { timingFor } from "./reports";

const HOUR = 3_600_000;

const task = (over: Partial<Task> = {}): Task => ({
  id: 1,
  project_id: 1,
  title: "t",
  body: null,
  status: "todo",
  priority: 2,
  created_at: "2026-03-01T09:00:00.000Z",
  updated_at: "2026-03-01T09:00:00.000Z",
  closed_at: null,
  ...over,
});

let seq = 0;
const event = (to: Status, at: string, over: Partial<TaskEvent> = {}): TaskEvent => ({
  id: ++seq,
  task_id: 1,
  from_status: null,
  to_status: to,
  at,
  actor: "agent",
  model: null,
  user_id: null,
  ...over,
});

describe("timingFor", () => {
  it("sums the doing intervals", () => {
    const t = timingFor(
      task({ status: "todo" }),
      [event("doing", "2026-03-01T09:00:00Z"), event("todo", "2026-03-01T11:00:00Z")],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(2 * HOUR);
  });

  it("counts an open interval up to now for a task still running", () => {
    const t = timingFor(
      task({ status: "doing" }),
      [event("doing", "2026-03-01T09:00:00Z")],
      Date.parse("2026-03-01T12:00:00Z"),
    );
    expect(t.active_ms).toBe(3 * HOUR);
  });

  it("stops a closed task at closed_at when its final event went missing", () => {
    // The task row and its status event are two separate un-transacted writes.
    // Lose the second and the row reads `done` with `doing` as its last event.
    // Counting that to Date.now() added a fresh 24h to every daily report from
    // then on -- permanently, and to every window at once.
    const closed = task({ status: "done", closed_at: "2026-03-01T12:00:00.000Z" });
    const events = [event("doing", "2026-03-01T09:00:00Z")];

    const soon = timingFor(closed, events, Date.parse("2026-03-01T13:00:00Z"));
    const muchLater = timingFor(closed, events, Date.parse("2026-08-10T00:00:00Z"));

    expect(soon.active_ms).toBe(3 * HOUR);
    expect(muchLater.active_ms).toBe(3 * HOUR);
  });

  it("replays a reopen", () => {
    const t = timingFor(
      task({ status: "doing" }),
      [
        event("doing", "2026-03-01T09:00:00Z"),
        event("done", "2026-03-01T10:00:00Z"),
        event("doing", "2026-03-02T09:00:00Z"),
        event("done", "2026-03-02T11:00:00Z"),
      ],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(3 * HOUR);
  });

  it("absorbs a duplicate doing event", () => {
    const t = timingFor(
      task(),
      [
        event("doing", "2026-03-01T09:00:00Z"),
        event("doing", "2026-03-01T09:30:00Z"),
        event("done", "2026-03-01T11:00:00Z"),
      ],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(2 * HOUR);
  });

  it("flags a task that closed without ever starting", () => {
    // Reporting a flat 0 for three days of work, with no caveat, is worse than
    // reporting nothing -- the markdown goes to a manager.
    const t = timingFor(
      task({ status: "done", closed_at: "2026-03-04T17:00:00.000Z" }),
      [event("todo", "2026-03-01T09:00:00Z"), event("done", "2026-03-04T17:00:00Z")],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(0);
    expect(t.partial).toBe(true);
    expect(t.lead_ms).toBe(Date.parse("2026-03-04T17:00:00Z") - Date.parse(task().created_at));
  });

  it("does not flag an ordinary finished task", () => {
    const t = timingFor(
      task({ status: "done", closed_at: "2026-03-01T11:00:00.000Z" }),
      [event("doing", "2026-03-01T09:00:00Z"), event("done", "2026-03-01T11:00:00Z")],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.partial).toBe(false);
    expect(t.started_at).toBe("2026-03-01T09:00:00Z");
  });

  it("still flags a backfilled task", () => {
    const t = timingFor(
      task(),
      [event("doing", "2026-03-01T09:00:00Z", { actor: "backfill" })],
      Date.parse("2026-03-01T10:00:00Z"),
    );
    expect(t.partial).toBe(true);
  });
});
