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

export type IconName =
  | "inbox"
  | "alert"
  | "terminal"
  | "doc"
  | "user"
  | "brain"
  | "home"
  | "search"
  | "chart"
  | "sun"
  | "arrow-right"
  | "replay"
  | "plus"
  | "close";

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
  // A node with its links: the brain here is a graph of what is known.
  brain: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="5" cy="6" r="1.8" />
      <circle cx="19" cy="6" r="1.8" />
      <circle cx="5" cy="18" r="1.8" />
      <circle cx="19" cy="18" r="1.8" />
      <path d="m6.5 7.2 3.6 3.2M17.5 7.2l-3.6 3.2M6.5 16.8l3.6-3.2M17.5 16.8l-3.6-3.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4.2-6 8-6s7 2 8 6" />
    </>
  ),
  // Projects: four tiles, the dashboard's lanes.
  home: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </>
  ),
  // Today.
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  "arrow-right": <path d="M4 12h15m-6-6 6 6-6 6" />,
  replay: <path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

/** The bare line icon, for a control that already has its own frame. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg {...STROKE} width={size} height={size}>
      {PATHS[name]}
    </svg>
  );
}

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
