export function Chip({
  children,
  color,
  title,
  tilt = 0,
}: {
  children: React.ReactNode;
  /**
   * One of the marker or kind colours, or nothing.
   *
   * The colour is a dot and a pale wash behind the label, never the label's
   * own colour: the text stays --ink, so it reads the same on every tint and
   * in both themes, and the words carry the meaning the colour only repeats.
   */
  color?: string;
  title?: string;
  tilt?: number;
}) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-[3px] text-meta leading-none font-medium text-ink"
      style={{
        background: color ? `color-mix(in srgb, ${color} 30%, var(--card))` : "var(--card)",
        borderColor: color ? `color-mix(in srgb, ${color} 55%, var(--card))` : "var(--line)",
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
      }}
    >
      {color && (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
      )}
      {children}
    </span>
  );
}

export function Counter({ n, label }: { n: number; label?: string }) {
  return (
    <span
      className="mono flex h-6 min-w-6 items-center justify-center rounded-full bg-inset px-1.5 text-meta text-muted"
      aria-label={label ? `${n} ${label}` : undefined}
    >
      {n}
    </span>
  );
}
