/**
 * Peel-and-stick decorations: flat shapes with a dark 2px outline, placed at
 * a small random-looking angle as if somebody pressed them onto the page.
 * Decorative only -- hidden from assistive tech, never a carrier of meaning,
 * and never a control. The colours are the sticker colours, which are not UI
 * tokens: nothing a person must read or click is ever drawn in them.
 */

type StickerProps = {
  size?: number;
  /** Degrees; a sticker is never square to the page. */
  tilt?: number;
  className?: string;
};

const OUTLINE = {
  stroke: "#171717",
  strokeWidth: 2,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

function Frame({
  size = 48,
  tilt = 0,
  className = "",
  children,
}: StickerProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={{ transform: `rotate(${tilt}deg)`, overflow: "visible" }}
    >
      {children}
    </svg>
  );
}

export function BoltSticker(props: StickerProps) {
  return (
    <Frame {...props}>
      <path d="M27 3 9 27h13l-4 18 20-26H25l5-16Z" fill="#3b82f6" {...OUTLINE} />
    </Frame>
  );
}

export function HeartSticker(props: StickerProps) {
  return (
    <Frame {...props}>
      <path
        d="M24 42C11 33 5 26 5 17.5 5 11 10 6.5 15.6 6.5c3.7 0 6.6 2 8.4 5 1.8-3 4.7-5 8.4-5C38 6.5 43 11 43 17.5 43 26 37 33 24 42Z"
        fill="#ff66cf"
        {...OUTLINE}
      />
      <circle cx="18" cy="19" r="2" fill="#171717" />
      <circle cx="30" cy="19" r="2" fill="#171717" />
      <path d="M19.5 26c2.6 2.4 6.4 2.4 9 0" fill="none" {...OUTLINE} />
    </Frame>
  );
}

export function SparkleSticker(props: StickerProps) {
  return (
    <Frame {...props}>
      <path
        d="M24 4c1.6 9.5 6 13.9 16 16-10 2.1-14.4 6.5-16 16-1.6-9.5-6-13.9-16-16 10-2.1 14.4-6.5 16-16Z"
        fill="#22c55e"
        {...OUTLINE}
      />
      <path d="M39 33c.6 3.4 2.1 4.9 5.5 5.5-3.4.6-4.9 2.1-5.5 5.5-.6-3.4-2.1-4.9-5.5-5.5 3.4-.6 4.9-2.1 5.5-5.5Z" fill="#fdfbf9" {...OUTLINE} />
    </Frame>
  );
}

export function PencilSticker(props: StickerProps) {
  return (
    <Frame {...props}>
      <path d="M8 34 32 10l6 6-24 24-8 2 2-8Z" fill="#ffc94d" {...OUTLINE} />
      <path d="M32 10l3-3a3 3 0 0 1 4.2 0l1.8 1.8a3 3 0 0 1 0 4.2l-3 3" fill="#ff66cf" {...OUTLINE} />
      <path d="M8 34l6 6" fill="none" {...OUTLINE} />
    </Frame>
  );
}

/**
 * A marker arrow drawn in one stroke, with a little curl before the head --
 * the line from a handwritten note to the thing it is about.
 */
export function HandArrow({ className = "", width = 120 }: { className?: string; width?: number }) {
  return (
    <svg
      viewBox="0 0 120 70"
      width={width}
      height={(width * 70) / 120}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8c34-4 66 6 84 26 6 7 10 15 12 24" />
      <path d="M90 50l12 10 6-16" />
    </svg>
  );
}
