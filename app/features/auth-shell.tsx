import type { Mood } from "../components";
import { Blob } from "../components";

/**
 * Auth pages are one small card on a very wide page. Left in the normal flow
 * they sit against the top edge with a screen of nothing underneath, which
 * reads as unfinished rather than as focused.
 *
 * So: centre the card in the viewport, give it a mascot at a size that can
 * carry the space, and let a soft glow behind it anchor the composition
 * instead of leaving the card floating on flat dark.
 */
export function AuthShell({
  mood = "happy",
  fill = "var(--accent)",
  title,
  intro,
  children,
  footer,
}: {
  mood?: Mood;
  fill?: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-[calc(100vh-160px)] flex-col items-center justify-center py-8">
      {/* Sized against its container, not in absolute pixels: at 520px wide it
          hung 100px off the side of a phone and made the whole page drag
          sideways. Percentages, because `vw` counts the scrollbar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[min(420px,60vh)] w-[90%] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: fill }}
      />

      <div className="w-full max-w-[26rem]">
        <div className="pop mb-5 flex flex-col items-center gap-2 text-center">
          <Blob mood={mood} size={64} fill={fill} className="bob" />
          <h1 className="display text-[30px] leading-tight font-bold">{title}</h1>
          {intro && <p className="text-[14.5px] leading-snug text-muted">{intro}</p>}
        </div>

        <div className="sticker pop p-5" style={{ animationDelay: "60ms" }}>
          {children}
        </div>

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
