import type { Mood } from "../components";
import { AuthMascot } from "./auth-mascot";

/**
 * Auth pages are one small card on a very wide page. Left in the normal flow
 * they sit against the top edge with a screen of nothing underneath, which
 * reads as unfinished rather than as focused.
 *
 * So: centre the card in the viewport, let a soft glow behind it anchor the
 * composition instead of leaving it floating on flat dark, and give it Todd.
 *
 * He used to be a small decoration above the heading. Standing behind the card
 * with his hands on it he does the same job better, and the heading moves
 * inside the card because it is his hands that hold the top edge now.
 */
export function AuthShell({
  mood = "happy",
  fill = "var(--accent)",
  title,
  intro,
  shyLabel,
  children,
  footer,
}: {
  mood?: Mood;
  fill?: string;
  title: string;
  intro?: string;
  /** What Todd says while a password field has focus; only the pages that
   *  have one pass it. */
  shyLabel?: string;
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

      <div className="pop w-full max-w-[26rem]">
        <AuthMascot mood={mood} fill={fill} shyLabel={shyLabel}>
          <div className="mb-4 text-center">
            <h1 className="display text-[26px] leading-tight font-bold">{title}</h1>
            {intro && (
              <p className="mt-1.5 text-[14px] leading-snug text-muted">{intro}</p>
            )}
          </div>
          {children}
        </AuthMascot>

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
