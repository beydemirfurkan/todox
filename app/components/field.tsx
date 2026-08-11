/**
 * Every control gets a real label. Placeholders disappear the moment you type
 * and are invisible to a screen reader when used as the only label.
 *
 * That sentence has been at the top of this file since it was written, while
 * the default was `hidden = true` and exactly one call site opted out. Worse,
 * most call sites passed the same translation key as both label and
 * placeholder — keys whose names end in `Ph`. So a sighted person filling in
 * the new-task form saw an unlabelled box, an unlabelled taller box, and a
 * dropdown reading "Normal" with nothing saying what it was for.
 *
 * Visible by default now. `hidden` stays for the two places where the control
 * is its own caption: the task title, which is a heading you can type in, and
 * the search box in the header.
 */
export function Field({
  label,
  hidden = false,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hidden?: boolean;
  /** Shown under the control, and referenced by it. */
  hint?: string;
  /** Replaces the hint when present, in the colour the log uses for a dead end. */
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span
        className={
          hidden ? "sr-only" : "display mb-1 block text-small font-bold text-muted"
        }
      >
        {label}
      </span>
      {children}
      {(error || hint) && (
        <span
          className="mt-1 block text-small"
          style={error ? { color: "var(--k-dead_end)" } : { color: "var(--faint)" }}
        >
          {error || hint}
        </span>
      )}
    </label>
  );
}
