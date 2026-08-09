export const now = () => new Date().toISOString();

export const ms = (iso: string) => new Date(iso).getTime();

/**
 * Report windows are measured in a named timezone, not the server's.
 *
 * These used to use `setHours(0,0,0,0)`, which is local to whatever machine
 * runs the code. Every caller is server-side and Vercel runs UTC, so "today"
 * began at 03:00 for a user in Istanbul: work done after midnight was filed
 * under yesterday, and Monday morning landed in last week. The whole point of
 * the report is to say what happened on a given day, so the day has to be the
 * reader's.
 */
export const DEFAULT_TZ = "Europe/Istanbul";

/** Calendar parts of an instant, as seen in `tz`. */
function partsIn(d: Date, tz: string) {
  // `en-CA` formats as YYYY-MM-DD, which parses back without ambiguity.
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const got: Record<string, string> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") got[p.type] = p.value;
  return {
    date: `${got.year}-${got.month}-${got.day}`,
    // 24:00 rather than 00:00 is a real formatToParts result in some engines.
    hour: Number(got.hour) % 24,
    minute: Number(got.minute),
    second: Number(got.second),
  };
}

/**
 * The instant at which the given calendar date starts in `tz`.
 *
 * Found by correcting a UTC guess: the offset cannot be looked up directly, so
 * we measure how far the guess lands from midnight and shift by that much.
 * Two passes settle the case where the correction itself crosses a DST change.
 */
function startOfDateIn(date: string, tz: string): Date {
  let guess = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(guess, tz);
    const offMs = (p.hour * 60 + p.minute) * 60_000 + p.second * 1000;
    const drift = p.date === date ? offMs : p.date < date ? offMs - 86_400_000 : offMs;
    if (drift === 0) break;
    guess = new Date(guess.getTime() - drift);
  }
  return guess;
}

export function startOfDay(d = new Date(), tz = DEFAULT_TZ): Date {
  return startOfDateIn(partsIn(d, tz).date, tz);
}

export function addDays(d: Date, n: number, tz = DEFAULT_TZ): Date {
  // Step through noon so a 23- or 25-hour DST day cannot land on the wrong date.
  const noon = new Date(d.getTime() + 12 * 3_600_000 + n * 86_400_000);
  return startOfDay(noon, tz);
}

/** Monday-based week, which is what a work week means to the people reading these reports. */
export function startOfWeek(d = new Date(), tz = DEFAULT_TZ): Date {
  const start = startOfDay(d, tz);
  // getUTCDay on the day's starting instant would be wrong either side of
  // midnight UTC, so read the weekday in the target zone.
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(
    start,
  );
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
  return addDays(start, -(dow < 0 ? 0 : dow), tz);
}

export function startOfMonth(d = new Date(), tz = DEFAULT_TZ): Date {
  const [y, m] = partsIn(d, tz).date.split("-");
  return startOfDateIn(`${y}-${m}-01`, tz);
}

/** Falls back rather than throwing: a bad tz should not lose you the report. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type Period = { from: string; to: string; label: string; tz: string };

export type PeriodName = "today" | "yesterday" | "week" | "last_week" | "month" | "all";

export function resolvePeriod(
  name: PeriodName,
  custom?: { from?: string; to?: string; tz?: string },
): Period {
  const nowD = new Date();
  const tz = custom?.tz && isValidTimeZone(custom.tz) ? custom.tz : DEFAULT_TZ;

  if (custom?.from || custom?.to) {
    const from = custom.from ? new Date(custom.from) : new Date(0);
    const to = custom.to ? new Date(custom.to) : nowD;
    return { from: from.toISOString(), to: to.toISOString(), label: "custom", tz };
  }

  // Each window is half-open: `to` is the first instant *outside* it. The ends
  // used to be inclusive on both sides while yesterday.to equalled today.from,
  // so anything landing exactly on midnight was counted in both reports.
  const span = (from: Date, to: Date, label: string): Period => ({
    from: from.toISOString(),
    to: to.toISOString(),
    label,
    tz,
  });

  switch (name) {
    case "today":
      return span(startOfDay(nowD, tz), nowD, "today");
    case "yesterday":
      return span(addDays(startOfDay(nowD, tz), -1, tz), startOfDay(nowD, tz), "yesterday");
    case "week":
      return span(startOfWeek(nowD, tz), nowD, "week");
    case "last_week":
      return span(addDays(startOfWeek(nowD, tz), -7, tz), startOfWeek(nowD, tz), "last_week");
    case "month":
      return span(startOfMonth(nowD, tz), nowD, "month");
    case "all":
      return span(new Date(0), nowD, "all");
  }
}

/** Half-open, so a timestamp on a boundary belongs to exactly one window. */
export function withinPeriod(iso: string | null, p: Period): boolean {
  if (!iso) return false;
  const t = ms(iso);
  return t >= ms(p.from) && t < ms(p.to);
}

/** Compact, language-neutral duration. The unit suffixes get localised at the edge. */
export function splitDuration(msTotal: number) {
  const totalMinutes = Math.round(msTotal / 60000);
  return {
    days: Math.floor(totalMinutes / (60 * 24)),
    hours: Math.floor((totalMinutes % (60 * 24)) / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };
}
