export function Chip({
  children,
  color,
  title,
  tilt = 0,
}: {
  children: React.ReactNode;
  /**
   * One of the bright marker fills, or nothing.
   *
   * Text colour is chosen from whether a fill was given, not from how light it
   * is — a `var(--…)` string cannot be measured here. So a dark value paints
   * dark on dark and the label disappears. If you want a neutral chip, pass
   * nothing: ink on the card is 13:1.
   */
  color?: string;
  title?: string;
  tilt?: number;
}) {
  return (
    <span
      title={title}
      className="display inline-flex shrink-0 items-center rounded-full border-[1.5px] px-2 pt-[1px] pb-[2px] text-[12px] leading-none font-bold"
      style={{
        background: color ?? "transparent",
        // filled chips carry the dark text colour; unfilled ones sit on a
        // dark surface and keep the light one
        color: color ? "var(--on-fill)" : "var(--ink)",
        borderColor: color ? "var(--edge-dark)" : "var(--line)",
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
      }}
    >
      {children}
    </span>
  );
}

export function Counter({ n, label }: { n: number; label?: string }) {
  return (
    <span
      className="mono flex size-6 items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-[11px]"
      aria-label={label ? `${n} ${label}` : undefined}
    >
      {n}
    </span>
  );
}
