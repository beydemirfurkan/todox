export const now = () => new Date().toISOString();

export const ms = (iso: string) => new Date(iso).getTime();

export function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monday-based week, which is what a work week means to the people reading these reports. */
export function startOfWeek(d = new Date()): Date {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
}

export function startOfMonth(d = new Date()): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export type Period = { from: string; to: string; label: string };

export type PeriodName = "today" | "yesterday" | "week" | "last_week" | "month" | "all";

export function resolvePeriod(
  name: PeriodName,
  custom?: { from?: string; to?: string },
): Period {
  const nowD = new Date();
  if (custom?.from || custom?.to) {
    const from = custom.from ? new Date(custom.from) : new Date(0);
    const to = custom.to ? new Date(custom.to) : nowD;
    return { from: from.toISOString(), to: to.toISOString(), label: "custom" };
  }
  switch (name) {
    case "today":
      return { from: startOfDay().toISOString(), to: nowD.toISOString(), label: "today" };
    case "yesterday": {
      const start = addDays(startOfDay(), -1);
      return {
        from: start.toISOString(),
        to: startOfDay().toISOString(),
        label: "yesterday",
      };
    }
    case "week":
      return {
        from: startOfWeek().toISOString(),
        to: nowD.toISOString(),
        label: "week",
      };
    case "last_week": {
      const start = addDays(startOfWeek(), -7);
      return {
        from: start.toISOString(),
        to: startOfWeek().toISOString(),
        label: "last_week",
      };
    }
    case "month":
      return {
        from: startOfMonth().toISOString(),
        to: nowD.toISOString(),
        label: "month",
      };
    case "all":
      return { from: new Date(0).toISOString(), to: nowD.toISOString(), label: "all" };
  }
}

export function withinPeriod(iso: string | null, p: Period): boolean {
  if (!iso) return false;
  const t = ms(iso);
  return t >= ms(p.from) && t <= ms(p.to);
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
