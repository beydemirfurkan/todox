import { Blob, type Mood } from "./blob";

/**
 * The header row a panel and a group share, so the two read as one family.
 * Wraps, because `right` is a status select and a button on the task pages
 * and that never fitted beside a heading on a phone.
 */
export const PANEL_HEADER = "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5";

export function Panel({
  title,
  right,
  children,
  className = "",
  delay = 0,
  headingId,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
  headingId?: string;
}) {
  return (
    <section
      className={`sticker pop ${className}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-labelledby={headingId}
    >
      {/* `right` used to be gated on `title` too, so a panel with only a
          counter dropped it silently -- the search page has shown no result
          count since it was written. */}
      {(title || right) && (
        <header className={`${PANEL_HEADER} border-b border-dashed border-rule`}>
          {title && (
            <h2 id={headingId} className="display min-w-0 text-[16px] font-bold">
              {title}
            </h2>
          )}
          <div className="ml-auto">{right}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({
  children,
  mood = "sleep",
}: {
  children: React.ReactNode;
  mood?: Mood;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Blob mood={mood} size={38} fill="var(--inset)" stroke="var(--ink)" className="shrink-0" />
      <p className="text-[14px] text-muted">{children}</p>
    </div>
  );
}
