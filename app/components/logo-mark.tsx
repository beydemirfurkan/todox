/**
 * The todox mark: an orange tile with a prompt and a cursor in it, the
 * shape every developer tool is met in. Decorative; the wordmark beside it,
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
        d="M9 11l5 5-5 5"
        fill="none"
        stroke="var(--on-fill)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17 21h6" stroke="var(--on-fill)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
