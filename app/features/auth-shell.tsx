import { LogoMark } from "../components";

/**
 * Auth pages are one small card on a very wide page, centred in the viewport
 * with a faint glow behind it so it does not float on flat dark. The mark
 * sits above the heading; `fill` tints the glow, so a failed link or an
 * invalid invitation reads differently before a word of it is read -- and
 * the heading still says it, because colour never says it alone.
 */
export function AuthShell({
  fill = "var(--accent)",
  title,
  intro,
  children,
  footer,
}: {
  fill?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {  return (
    <div className="relative flex min-h-[calc(100vh-160px)] flex-col items-center justify-center py-8">
      {/* Sized against its container, not in absolute pixels: at 520px wide it
          hung 100px off the side of a phone and made the whole page drag
          sideways. Percentages, because `vw` counts the scrollbar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[min(420px,60vh)] w-[90%] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: fill }}
      />

      <div className="pop w-full max-w-[26rem]">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <LogoMark size={40} />
          <div>
            <h1 className="display text-[28px] leading-tight">{title}</h1>
            {intro && <p className="mt-1.5 text-[14px] leading-snug text-muted">{intro}</p>}
          </div>
        </div>
        <div className="sticker p-6">{children}</div>

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
