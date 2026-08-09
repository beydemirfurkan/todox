/**
 * Every control gets a real label. Placeholders disappear the moment you type
 * and are invisible to screen readers used as the only label.
 */
export function Field({
  label,
  hidden = true,
  children,
  className = "",
}: {
  label: string;
  hidden?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span
        className={
          hidden ? "sr-only" : "display mb-1 block text-[13px] font-bold text-muted"
        }
      >
        {label}
      </span>
      {children}
    </label>
  );
}
