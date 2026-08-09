import { Blob, type Mood } from "./blob";

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
        <header className="flex items-center gap-3 border-b border-dashed border-rule px-4 py-2.5">
          {title && (
            <h2 id={headingId} className="display text-[16px] font-bold">
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
