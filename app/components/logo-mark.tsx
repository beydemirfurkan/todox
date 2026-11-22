/**
 * The todox mark: Tod's face on the orange tile. The prompt's `>` is a
 * winking eye and the cursor a smile, so it still reads as `>_` at 16px. Decorative; the wordmark beside it,
 * or the page around it, says the name.
 */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M8.6 10.6l3.9 3.4-3.9 3.4"
        fill="none"
        stroke="var(--on-fill)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21.6" cy="14" r="2.3" fill="var(--on-fill)" />
      <path
        d="M12.9 21.4q3.1 2.3 6.2 0"
        fill="none"
        stroke="var(--on-fill)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
