import { describe, expect, it } from "vitest";

import type { Status } from "../constants";
import type { Task, TaskEvent } from "../types";
import { doingSpans, summarise, timingFor, withinPeriodOf } from "./reports";

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
      [],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(2 * HOUR);
  });

  it("counts an open interval up to now for a task still running", () => {
    const t = timingFor(
      task({ status: "doing" }),
      [event("doing", "2026-03-01T09:00:00Z")],
      [],
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

    const soon = timingFor(closed, events, [], Date.parse("2026-03-01T13:00:00Z"));
    const muchLater = timingFor(closed, events, [], Date.parse("2026-08-10T00:00:00Z"));

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
      [],
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
      [],
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
      [],
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
      [],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.partial).toBe(false);
    expect(t.started_at).toBe("2026-03-01T09:00:00Z");
  });

  it("still flags a backfilled task", () => {
    const t = timingFor(
      task(),
      [event("doing", "2026-03-01T09:00:00Z", { actor: "backfill" })],
      [],
      Date.parse("2026-03-01T10:00:00Z"),
    );
    expect(t.partial).toBe(true);
  });
});

/**
 * Measured on one account, 1-18 September 2026: `active_ms` came to 5,430
 * hours in eighteen days, because tasks had been set 'doing' and left there
 * for three weeks and every hour of it was on the headline. The status
 * column is a claim; the log is the evidence. A span is counted whole while
 * it is shorter than a day, and past that only the stretches around signs of
 * life count -- four hours either side of each.
 */
describe("timingFor, when a span is longer than a day", () => {
  const DAY = 24 * HOUR;
  const at = (offsetMs: number) =>
    new Date(Date.parse("2026-03-01T09:00:00Z") + offsetMs).toISOString();
  const entry = (offsetMs: number) => ({ created_at: at(offsetMs) });

  it("counts an honest day whole, with nothing logged in it", () => {
    // 09:00 doing, 17:00 done, no entry between: eight hours of work, not
    // four. The closing status change is the evidence somebody was there.
    const t = timingFor(
      task({ status: "done", closed_at: at(8 * HOUR) }),
      [event("doing", at(0)), event("done", at(8 * HOUR))],
      [],
      Date.parse("2026-03-05T00:00:00Z"),
    );
    expect(t.active_ms).toBe(8 * HOUR);
    expect(t.discounted_ms).toBe(0);
  });

  it("counts a month left 'doing' as the morning it was set, not the month", () => {
    const t = timingFor(task({ status: "doing" }), [event("doing", at(0))], [], Date.parse(at(30 * DAY)));
    expect(t.active_ms).toBe(4 * HOUR);
    expect(t.discounted_ms).toBe(30 * DAY - 4 * HOUR);
  });

  it("counts the stretch around an entry, not everything up to it", () => {
    // One entry on day twenty of a thirty-day span. Start-to-last-entry would
    // count twenty days; this counts a morning and the eight hours around
    // the entry.
    const t = timingFor(
      task({ status: "doing" }),
      [event("doing", at(0))],
      [entry(20 * DAY)],
      Date.parse(at(30 * DAY)),
    );
    expect(t.active_ms).toBe(12 * HOUR);
    expect(t.discounted_ms).toBe(30 * DAY - 12 * HOUR);
  });

  it("merges overlapping stretches and clips them to the span", () => {
    // Entries at +1h and +26h, closed by an event at +30h. The start and the
    // first entry overlap into one five-hour stretch; the second entry and
    // the close overlap into one eight-hour stretch.
    const t = timingFor(
      task({ status: "done", closed_at: at(30 * HOUR) }),
      [event("doing", at(0)), event("done", at(30 * HOUR))],
      [entry(1 * HOUR), entry(26 * HOUR)],
      Date.parse("2026-04-01T00:00:00Z"),
    );
    expect(t.active_ms).toBe(13 * HOUR);
    expect(t.discounted_ms).toBe(17 * HOUR);
  });

  it("takes the closing status change as a sign of life", () => {
    const t = timingFor(
      task({ status: "todo" }),
      [event("doing", at(0)), event("todo", at(3 * DAY))],
      [],
      Date.parse(at(10 * DAY)),
    );
    expect(t.active_ms).toBe(8 * HOUR);
  });

  it("takes a repeated 'doing' as a sign of life too", () => {
    const t = timingFor(
      task({ status: "doing" }),
      [event("doing", at(0)), event("doing", at(2 * DAY))],
      [],
      Date.parse(at(5 * DAY)),
    );
    expect(t.active_ms).toBe(12 * HOUR);
  });

  it("ignores an entry written outside the span", () => {
    const t = timingFor(
      task({ status: "doing" }),
      [event("doing", at(0))],
      [entry(-1 * HOUR), entry(31 * DAY)],
      Date.parse(at(30 * DAY)),
    );
    expect(t.active_ms).toBe(4 * HOUR);
  });

  it("never turns a discount into a partial figure", () => {
    // The two caveats point in opposite directions: partial says the figure
    // is a floor, the discount says how much was cut from a ceiling.
    const t = timingFor(task({ status: "doing" }), [event("doing", at(0))], [], Date.parse(at(30 * DAY)));
    expect(t.partial).toBe(false);
  });

  it("clips both figures to the window being reported on", () => {
    // A span that began last month with nothing in it since: today's window
    // holds none of the attended morning, so today's active time is zero and
    // the whole of today is discounted.
    const spans = doingSpans(task({ status: "doing" }), [event("doing", at(0))], [], Date.parse(at(30 * DAY)));
    const today = withinPeriodOf(spans, {
      from: at(20 * DAY),
      to: at(21 * DAY),
      label: "today",
      tz: "UTC",
    });
    expect(today).toEqual({ active_ms_in_period: 0, discounted_ms_in_period: DAY });

    // And the window that holds the start gets the attended morning.
    const first = withinPeriodOf(spans, { from: at(0), to: at(DAY), label: "today", tz: "UTC" });
    expect(first).toEqual({ active_ms_in_period: 4 * HOUR, discounted_ms_in_period: 20 * HOUR });
  });
});


/**
 * The cut is what keeps a report a summary. It has to be honest about having
 * happened -- the page turns `truncated` into a link and the markdown into an
 * ellipsis, and neither may infer it from the length, because a body that ends
 * exactly on the limit was not cut.
 */
describe("summarise", () => {
  it("leaves a short body alone, and keeps its paragraphs", () => {
    const body = "Chose Postgres FTS.\n\nEmbeddings lost on cost.";
    expect(summarise(`  ${body}  `)).toEqual({ body, truncated: false });
  });

  it("does not call a body that ends on the limit cut", () => {
    const exact = "x".repeat(480);
    expect(summarise(exact)).toEqual({ body: exact, truncated: false });
  });

  it("cuts a long body at a word boundary", () => {
    const long = "decision ".repeat(200);
    const { body, truncated } = summarise(long);

    expect(truncated).toBe(true);
    expect(body.length).toBeLessThanOrEqual(480);
    expect(body.endsWith("decision")).toBe(true);
    expect(long.startsWith(body)).toBe(true);
  });

  it("counts a newline as a boundary, not just a space", () => {
    // The second line has no space in the first 480 characters, so a boundary
    // search that only looked for `" "` would fall through to the hard cut and
    // end the summary in the middle of a word.
    const long = `${"a".repeat(470)}\nsecondlinethatrunspastthelimit`;

    expect(summarise(long).body).toBe("a".repeat(470));
  });

  it("cuts hard when there is no boundary to back up to", () => {
    // A pasted url or a stack frame is one unbroken run, and a word boundary
    // that would leave a three-character summary is worse than a hard cut.
    const { body, truncated } = summarise(`see ${"x".repeat(900)}`);

    expect(truncated).toBe(true);
    expect(body.length).toBe(480);
  });
});
