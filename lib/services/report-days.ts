import type { Period } from "../util/time";

/** One local day of a report window. */
export interface ReportDay {
  /** `YYYY-MM-DD` in the report's timezone. */
  day: string;
  created: number;
  completed: number;
  /** Attended time in `doing` that fell inside this day. */
  active_ms: number;
  decisions: number;
  dead_ends: number;
  questions: number;
  handoffs: number;
  notes: number;
}

/**
 * Past this a day-by-day series stops being a picture and starts being a
 * payload: a quarter is ninety bars, `all` would be decades of them.
 */
export const MAX_REPORT_DAYS = 92;

/** How finely day boundaries are searched for. Fifteen minutes catches every
 *  real UTC offset, the half- and quarter-hour ones included. */
const STEP_MS = 15 * 60_000;

const dayKey = (tz: string) => {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (at: number) => format.format(at);
};

/**
 * The window's local days and where each one starts, in milliseconds.
 *
 * Walked rather than computed, because "midnight in Europe/Istanbul" has no
 * arithmetic that survives every timezone and every DST change; the formatter
 * already knows, and asking it every fifteen minutes over a month is a few
 * thousand calls.
 */
export function daysOf(period: Period): { keys: string[]; starts: number[] } {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  if (!(to > from) || to - from > MAX_REPORT_DAYS * 86_400_000) return { keys: [], starts: [] };
  const key = dayKey(period.tz);
  const keys: string[] = [];
  const starts: number[] = [];
  for (let at = from; at < to; at += STEP_MS) {
    const k = key(at);
    if (keys[keys.length - 1] !== k) {
      keys.push(k);
      starts.push(at);
    }
  }
  return { keys, starts };
}

export interface DayInputs {
  created: string[];
  completed: string[];
  entries: { kind: string; created_at: string }[];
  /** Attended intervals, in milliseconds, from every task's `doing` spans. */
  attended: [number, number][];
}

/**
 * The report as a series of days, bucketed from what the report has already
 * loaded -- no query of its own, so the chart and the totals cannot disagree.
 * An empty list for a window too long to draw day by day.
 */
export function byDay(period: Period, inputs: DayInputs): ReportDay[] {
  const { keys, starts } = daysOf(period);
  if (!keys.length) return [];
  const end = Date.parse(period.to);
  const days: ReportDay[] = keys.map((day) => ({
    day,
    created: 0,
    completed: 0,
    active_ms: 0,
    decisions: 0,
    dead_ends: 0,
    questions: 0,
    handoffs: 0,
    notes: 0,
  }));

  const indexOf = (at: number): number => {
    if (at < starts[0] || at >= end) return -1;
    let i = starts.length - 1;
    while (i > 0 && starts[i] > at) i -= 1;
    return i;
  };

  for (const at of inputs.created) {
    const i = indexOf(Date.parse(at));
    if (i >= 0) days[i].created += 1;
  }
  for (const at of inputs.completed) {
    const i = indexOf(Date.parse(at));
    if (i >= 0) days[i].completed += 1;
  }
  const field: Record<string, keyof ReportDay> = {
    decision: "decisions",
    dead_end: "dead_ends",
    question: "questions",
    handoff: "handoffs",
    note: "notes",
  };
  for (const e of inputs.entries) {
    const i = indexOf(Date.parse(e.created_at));
    const f = field[e.kind];
    if (i >= 0 && f) (days[i][f] as number) += 1;
  }
  for (const [a, b] of inputs.attended) {
    for (let i = 0; i < days.length; i++) {
      const dayStart = starts[i];
      const dayEnd = i + 1 < starts.length ? starts[i + 1] : end;
      const overlap = Math.min(b, dayEnd) - Math.max(a, dayStart);
      if (overlap > 0) days[i].active_ms += overlap;
    }
  }
  return days;
}
