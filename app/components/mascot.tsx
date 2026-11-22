/**
 * Tod, the todox mascot: the prompt tile grown a body. The `>` of the mark is
 * the winking eye and the cursor is the smile, so the favicon in a tab and
 * the creature on an empty page are visibly the same thing. The yellow
 * ribbon is a bookmark: the place the last session stopped.
 *
 * Decorative everywhere it appears; the heading beside it carries the words.
 */

export type MascotMood = "happy" | "puzzled";

export function Mascot({
  size = 96,
  mood = "happy",
  className = "",
}: {
  size?: number;
  mood?: MascotMood;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={`mascot ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="60" cy="109" rx="30" ry="4" fill="var(--ink)" opacity=".12" />
      <rect x="38" y="96" width="12" height="11" rx="5" fill="var(--mascot-feet)" />
      <rect x="70" y="96" width="12" height="11" rx="5" fill="var(--mascot-feet)" />
      <path d="M86 26V8h10v18l-5-4z" fill="#ffd84d" />
      <rect x="20" y="20" width="80" height="80" rx="24" fill="var(--accent)" />
      <rect x="12" y="60" width="14" height="10" rx="5" fill="var(--accent)" transform="rotate(-20 19 65)" />
      <g className="mascot-arm">
        <rect x="0" y="-5" width="14" height="10" rx="5" fill="var(--accent)" transform="translate(97 44) rotate(-50)" />
      </g>
      <circle cx="36" cy="72" r="5" fill="#ff4d6d" opacity=".35" />
      <circle cx="86" cy="72" r="5" fill="#ff4d6d" opacity=".35" />
      {mood === "happy" ? <HappyFace /> : <PuzzledFace />}
    </svg>
  );
}

function HappyFace() {
  return (
    <>
      <path
        d="M40 46l11 9-11 9"
        fill="none"
        stroke="#111"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="mascot-eye">
        <circle cx="79" cy="55" r="6" fill="#111" />
        <circle cx="81" cy="53" r="1.8" fill="#fff" />
      </g>
      <path d="M52 76q8 6 16 0" fill="none" stroke="#111" strokeWidth="6" strokeLinecap="round" />
    </>
  );
}

/** For a page that is not there: both eyes open, the cursor gone flat. */
function PuzzledFace() {
  return (
    <>
      <g className="mascot-eye">
        <circle cx="43" cy="55" r="6" fill="#111" />
        <circle cx="45" cy="53" r="1.8" fill="#fff" />
      </g>
      <g className="mascot-eye">
        <circle cx="79" cy="55" r="6" fill="#111" />
        <circle cx="81" cy="53" r="1.8" fill="#fff" />
      </g>
      <path d="M38 42l9-3M73 39l9 3" stroke="#111" strokeWidth="4" strokeLinecap="round" />
      <path d="M54 78h12" stroke="#111" strokeWidth="6" strokeLinecap="round" />
    </>
  );
}
