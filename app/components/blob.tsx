export type Mood = "idle" | "happy" | "sleep" | "worried" | "stuck";

/**
 * Todd. A lumpy ink blob that stands in for the log itself: he remembers
 * things so the next session does not have to. Decorative only -- always
 * hidden from assistive tech, never the sole carrier of meaning.
 */
export function Blob({
  mood = "idle",
  size = 44,
  fill = "var(--accent)",
  stroke = "var(--on-fill)",
  className = "",
}: {
  mood?: Mood;
  size?: number;
  fill?: string;
  /** Outline colour. Defaults to the dark ink used on bright fills; pass the
   *  light ink when the blob is filled with a dark surface colour. */
  stroke?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 68 66"
      width={size}
      height={(size * 66) / 68}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ overflow: "visible" }}
    >
      <g
        stroke={stroke}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path
          d="M11 33C5 18 19 5 35 7c17 2 26 14 22 29-4 14-22 24-35 18-8-4-6-9-11-21Z"
          fill={fill}
        />
        {/* one stray hair, because he is trying his best */}
        <path d="M34 7c1-4 4-5 6-3" />
        <Eyes mood={mood} ink={stroke} />
        <Mouth mood={mood} />
      </g>
    </svg>
  );
}

function Eyes({ mood, ink }: { mood: Mood; ink: string }) {
  if (mood === "sleep")
    return (
      <>
        <path d="M21 30q4-5 8 0" />
        <path d="M39 28q4-5 8 0" />
      </>
    );
  if (mood === "worried")
    return (
      <>
        <circle cx="26" cy="31" r="2.6" fill={ink} stroke="none" />
        <circle cx="43" cy="29" r="2.6" fill={ink} stroke="none" />
        <path d="M20 24q5-4 10-1" />
        <path d="M48 22q-5-4-10-1" />
      </>
    );
  return (
    <>
      <circle cx="26" cy="31" r="3" fill={ink} stroke="none" />
      <circle cx="43" cy="29" r="3" fill={ink} stroke="none" />
    </>
  );
}

function Mouth({ mood }: { mood: Mood }) {
  if (mood === "happy") return <path d="M27 40q7 9 15 0" />;
  if (mood === "sleep") return <path d="M30 41q4 3 8 0" />;
  if (mood === "worried" || mood === "stuck") return <path d="M28 43q7-6 14-1" />;
  return <path d="M29 40q6 5 12 0" />;
}
