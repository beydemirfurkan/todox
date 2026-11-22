/**
 * A handful of numbers as one row of badges: a coloured dot, the number in
 * mono, then what it counts. A row, not tiles, so a summary costs one line of
 * the screen rather than a band of it. The dot is a hint only; the word is
 * the meaning. A badge with an `href` is a link to what it counts.
 */
export interface Stat {
  label: string;
  value: number | string;
  mark: string;
  href?: string;
}

export function StatBadges({
  stats,
  label,
  className = "",
  style,
}: {
  stats: Stat[];
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <ul aria-label={label} className={`flex flex-wrap gap-2 ${className}`} style={style}>
      {stats.map((stat) => (
        <li key={stat.label} className="min-w-0">
          {stat.href ? (
            <a href={stat.href} className="stat-badge hover:border-[var(--faint)]">
              <StatBody stat={stat} />
            </a>
          ) : (
            <span className="stat-badge">
              <StatBody stat={stat} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function StatBody({ stat }: { stat: Stat }) {
  return (
    <>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: stat.mark }} />
      <span className="mono font-medium text-ink tabular-nums">{stat.value}</span>
      <span className="text-muted">{stat.label}</span>
    </>
  );
}
