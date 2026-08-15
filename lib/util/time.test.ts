import { describe, expect, it } from "vitest";

import { resolvePeriod, startOfDay, startOfWeek, withinPeriod } from "./time";

const IST = "Europe/Istanbul";

/**
 * These windows used to be built with `setHours(0,0,0,0)`, which is local to
 * whichever machine runs the code. Every caller is server-side and the server
 * runs UTC, so "today" began at 03:00 in Istanbul: anything logged after midnight
 * was filed under the previous day.
 */
describe("period boundaries", () => {
  it("starts the Istanbul day at 21:00 UTC the evening before", () => {
    const midMorning = new Date("2026-08-10T09:00:00Z");
    expect(startOfDay(midMorning, IST).toISOString()).toBe("2026-08-09T21:00:00.000Z");
  });

  it("puts 01:00 Istanbul on the same day as 14:00 Istanbul", () => {
    // 01:00 on the 10th in Istanbul is still the 9th in UTC. The old code
    // called these two instants different days.
    const justAfterMidnight = new Date("2026-08-09T22:00:00Z");
    const afternoon = new Date("2026-08-10T11:00:00Z");
    expect(startOfDay(justAfterMidnight, IST).toISOString()).toBe(
      startOfDay(afternoon, IST).toISOString(),
    );
  });

  it("still measures UTC when asked to", () => {
    const d = new Date("2026-08-10T09:00:00Z");
    expect(startOfDay(d, "UTC").toISOString()).toBe("2026-08-10T00:00:00.000Z");
  });

  it("handles a zone behind Greenwich", () => {
    // 09:00 UTC on the 10th is 04:00 in New York, so the day began at 04:00 UTC.
    const d = new Date("2026-08-10T09:00:00Z");
    expect(startOfDay(d, "America/New_York").toISOString()).toBe(
      "2026-08-10T04:00:00.000Z",
    );
  });

  it("starts the week on Monday, in the reader's zone", () => {
    // 2026-08-10 is a Monday. Asking on Wednesday should return that Monday.
    const wednesday = new Date("2026-08-12T09:00:00Z");
    expect(startOfWeek(wednesday, IST).toISOString()).toBe("2026-08-09T21:00:00.000Z");
  });

  it("puts Monday 01:00 Istanbul in this week, not last", () => {
    const mondayEarly = new Date("2026-08-09T22:30:00Z"); // 01:30 Mon in Istanbul
    expect(startOfWeek(mondayEarly, IST).toISOString()).toBe("2026-08-09T21:00:00.000Z");
  });

  it("survives a DST transition", () => {
    // Central Europe springs forward on 2026-03-29; that day is 23 hours long.
    const after = new Date("2026-03-29T12:00:00Z");
    const start = startOfDay(after, "Europe/Berlin");
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("falls back rather than throwing on a bogus timezone", () => {
    expect(() => resolvePeriod("today", { tz: "Mars/Olympus" })).not.toThrow();
  });
});

describe("withinPeriod", () => {
  it("counts a boundary instant in exactly one window", () => {
    const now = new Date("2026-08-10T09:00:00Z");
    const today = resolvePeriod("today", { tz: IST });
    const yesterday = resolvePeriod("yesterday", { tz: IST });

    // Whatever midnight is, it belongs to today and not to yesterday.
    const midnight = today.from;
    expect(withinPeriod(midnight, today)).toBe(true);
    expect(withinPeriod(midnight, yesterday)).toBe(false);
    expect(yesterday.to).toBe(today.from);
    expect(now).toBeInstanceOf(Date);
  });

  it("excludes anything before the window", () => {
    const p = resolvePeriod("today", { tz: IST });
    expect(withinPeriod("2020-01-01T00:00:00Z", p)).toBe(false);
  });

  it("is false for a task that never closed", () => {
    expect(withinPeriod(null, resolvePeriod("today", { tz: IST }))).toBe(false);
  });
});
