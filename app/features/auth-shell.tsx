import { Mascot, type MascotMood } from "../components";

/**
 * Auth pages are one small card centred on a wide page, with Tod above the
 * heading. A failed link, an invalid invitation or a missing page gets the
 * puzzled face, and the heading still says so in words. The coloured glow
 * that used to sit behind the card is gone; it said nothing the face and
 * the heading do not.
 */
export function AuthShell({
  title,
  intro,
  children,
  footer,
  mood = "happy",
}: {
  /** Tod's face above the heading: puzzled for a page that is not there. */
  mood?: MascotMood;
  title: string;
  intro?: string;
  /** The form. Leave it out for a message page and pass its action as `footer`. */
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-[calc(100vh-160px)] flex-col items-center justify-center py-8">
      <div className="pop w-full max-w-[26rem]">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <Mascot size={88} mood={mood} />
          <div>
            <h1 className="display text-[28px] leading-tight">{title}</h1>
            {intro && <p className="mt-1.5 text-[14px] leading-snug text-muted">{intro}</p>}
          </div>
        </div>
        {children && <div className="sticker p-6">{children}</div>}

        {footer && (
          <div
            className="pop mt-4 flex flex-col items-center gap-1.5"
            style={{ animationDelay: "120ms" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
