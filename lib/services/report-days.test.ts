import { describe, expect, it } from "vitest";

import { byDay, daysOf, MAX_REPORT_DAYS } from "./report-days";

const week = {
  from: "2026-11-16T21:00:00.000Z", // Monday 00:00 in Istanbul (UTC+3)
  to: "2026-11-23T21:00:00.000Z",
  label: "week",
  tz: "Europe/Istanbul",
};

describe("daysOf", () => {
  it("names the window's local days, not its UTC ones", () => {
    const { keys } = daysOf(week);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-11-17");
    expect(keys[6]).toBe("2026-11-23");
  });

  it("draws nothing for a window too long to draw day by day", () => {
    const long = { ...week, from: "2020-01-01T00:00:00.000Z" };
    expect(daysOf(long).keys).toEqual([]);
    expect(MAX_REPORT_DAYS).toBeGreaterThanOrEqual(31);
  });
});

describe("byDay", () => {
  const empty = { created: [], completed: [], entries: [], attended: [] as [number, number][] };

  it("puts a row on the local day it happened", () => {
    // 22:30 UTC on the 17th is 01:30 on the 18th in Istanbul.
    const days = byDay(week, { ...empty, completed: ["2026-11-17T22:30:00.000Z"] });
    expect(days.find((d) => d.day === "2026-11-18")?.completed).toBe(1);
    expect(days.find((d) => d.day === "2026-11-17")?.completed).toBe(0);
  });

  it("counts entries by kind and ignores rows outside the window", () => {
    const days = byDay(week, {
      ...empty,
      entries: [
        { kind: "decision", created_at: "2026-11-17T09:00:00.000Z" },
        { kind: "dead_end", created_at: "2026-11-17T10:00:00.000Z" },
        { kind: "decision", created_at: "2026-11-30T10:00:00.000Z" },
      ],
    });
    expect(days.reduce((n, d) => n + d.decisions, 0)).toBe(1);
    expect(days.reduce((n, d) => n + d.dead_ends, 0)).toBe(1);
  });

  it("splits attended time across midnight, and adds up to the whole", () => {
    // 20:00 to 23:00 UTC on the 17th: 23:00-02:00 in Istanbul.
    const a = Date.parse("2026-11-17T20:00:00.000Z");
    const b = Date.parse("2026-11-17T23:00:00.000Z");
    const days = byDay(week, { ...empty, attended: [[a, b]] });
    expect(days.find((d) => d.day === "2026-11-17")?.active_ms).toBe(3_600_000);
    expect(days.find((d) => d.day === "2026-11-18")?.active_ms).toBe(7_200_000);
    expect(days.reduce((n, d) => n + d.active_ms, 0)).toBe(b - a);
  });
});
