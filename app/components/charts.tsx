/**
 * Charts, drawn on the server as plain SVG and HTML.
 *
 * No chart library: a bar is a rectangle, and a dependency for rectangles is
 * the kind of weight this project keeps out on purpose. Every drawing follows
 * the rule `Progress` set: the picture is `aria-hidden`, and the same numbers
 * are said in words beside it or in a table a screen reader reaches. Colour
 * tells series apart, and the legend names each colour, so colour never
 * carries a meaning alone.
 */

export interface DaySeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const BAR_W = 100;
const CHART_H = 120;

/**
 * Bars per day, stacked when there is more than one series.
 *
 * Drawn in a viewBox whose width is the number of days, so the bars fill the
 * box at any width; text sits outside the SVG in HTML, where it keeps its
 * size instead of scaling with the drawing.
 */
export function DayBars({
  days,
  series,
  format = (n) => String(n),
  caption,
}: {
  /** `YYYY-MM-DD`, one per bar. */
  days: string[];
  series: DaySeries[];
  format?: (n: number) => string;
  /** What the chart is of, for the table a screen reader reads. */
  caption: string;
}) {
  const totals = days.map((_, i) => series.reduce((n, s) => n + (s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 0);
  const width = days.length * BAR_W;
  const gap = days.length > 20 ? 14 : 24;
  const every = days.length <= 10 ? 1 : days.length <= 31 ? 5 : 10;

  return (
    <figure className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted" aria-hidden="true">
        {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
      </div>

      <div className="relative">
      <span className="mono absolute top-0 right-0 rounded-[4px] bg-card px-1 text-meta text-faint" aria-hidden="true">
        {format(max)}
      </span>
      <svg
        viewBox={`0 0 ${width} ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-28 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <line x1={0} y1={CHART_H - 0.5} x2={width} y2={CHART_H - 0.5} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {days.map((day, i) => {
          let y = CHART_H;
          return (
            <g key={day}>
              {/* A faint track under every day, so an empty day reads as a
                  day with nothing in it rather than as a gap in the chart. */}
              <rect x={i * BAR_W + gap / 2} y={0} width={BAR_W - gap} height={CHART_H} fill="var(--inset)" />
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                if (!v || !max) return null;
                const h = Math.max(2, (v / max) * (CHART_H - 24));
                y -= h;
                return (
                  <rect key={s.key} x={i * BAR_W + gap / 2} y={y} width={BAR_W - gap} height={h} fill={s.color}>
                    <title>{`${day} · ${s.label}: ${format(v)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      </div>

      <div className="relative h-4" aria-hidden="true">
        {days.map((day, i) =>
          i % every === 0 || i === days.length - 1 ? (
            <span
              key={day}
              className="mono absolute top-0 -translate-x-1/2 text-meta text-faint"
              style={{ left: `${((i + 0.5) / days.length) * 100}%` }}
            >
              {Number(day.slice(8))}
            </span>
          ) : null,
        )}
      </div>

      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">day</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day, i) => (
            <tr key={day}>
              <th scope="row">{day}</th>
              {series.map((s) => (
                <td key={s.key}>{format(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface Share {
  key: string;
  label: React.ReactNode;
  value: number;
  /** The value in words, as the row prints it. */
  text: string;
}

/**
 * Who got how much: one row each, a bar scaled to the largest, and the
 * figure in words at the end of the row. The bar is the glance; the row
 * already says everything without it.
 */
export function ShareBars({ rows, color }: { rows: Share[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <span className="max-w-full min-w-[8rem] flex-1 truncate text-[14px] text-ink">{r.label}</span>
            <span className="mono text-meta text-muted">{r.text}</span>
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-inset" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%`, background: color }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
