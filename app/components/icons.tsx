/**
 * Line icons in a small square tile: the stand-in for what used to be the
 * mascot beside an empty state, a notice or a hint (task #811). Decorative -- the text
 * next to each one says the thing -- so every one is hidden from assistive
 * tech.
 */

const STROKE = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

export type IconName = "inbox" | "alert" | "terminal" | "doc" | "user";

const PATHS: Record<IconName, React.ReactNode> = {
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4M12 17h.01" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" />
    </>
  ),
};

/** An icon on an inset tile with a hairline edge; `color` tints the stroke. */
export function IconTile({
  name,
  color = "var(--muted)",
  className = "",
}: {
  name: IconName;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-[8px] border border-line bg-inset ${className}`}
      style={{ color }}
    >
      <svg {...STROKE}>{PATHS[name]}</svg>
    </span>
  );
}
