import Image from "next/image";
import Link from "next/link";

import type { T } from "@/lib/i18n";
import { Blob, Chip, SparkleSticker } from "../components";
import { KIND_COLOR, kindLabel } from "../kinds";
import { BriefingPreview } from "./briefing-preview";
import { Explainer, VsNative } from "./explainer";

/**
 * What somebody sees at todox.dev before they have an account.
 *
 * Read top to bottom it is a sentence, a picture, and then the same idea
 * three more ways, each shorter on words than the last one was: the steps as
 * drawings, the objection as four tiles, the payload as itself. The product
 * is the picture -- a real screen laid on a desk with notes pinned round it
 * -- and the page leaves white space around everything else.
 */
export function Landing({ t }: { t: T }) {
  return (
    <div className="space-y-24 pb-6 sm:space-y-32">
      <Hero t={t} />
      <Stage t={t} />

      <section className="space-y-8">
        <h2 className="display text-center text-[clamp(28px,4vw,40px)] leading-[1.1]">{t("landingHowTitle")}</h2>
        <Explainer t={t} />
      </section>

      <VsNative t={t} />
      <BriefingPreview t={t} />
      <Closing t={t} />
    </div>
  );
}

function Hero({ t }: { t: T }) {
  return (
    <section className="pop flex flex-col items-center gap-6 pt-8 text-center sm:pt-14">
      <p className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-small text-muted shadow-[var(--shadow-sm)]">
        <span aria-hidden="true" className="size-2 rounded-full bg-[var(--accent)]" />
        {t("landingScrawl")}
      </p>
      <h1 className="display max-w-[15ch] text-[clamp(42px,7.4vw,92px)] leading-[1.02]">
        <Headline t={t} />
      </h1>
      <p className="max-w-[52ch] text-[17px] leading-relaxed text-muted">{t("landingLede")}</p>
      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="btn !px-6 !py-2.5 text-[15px]">
            {t("landingCta")}
          </Link>
          <Link href="/login" className="btn btn-quiet !px-6 !py-2.5 text-[15px]">
            {t("landingSecondary")}
          </Link>
        </div>
        <p className="text-small text-faint">{t("landingCtaNote")}</p>
      </div>
    </section>
  );
}

/**
 * The product on the desk: a framed screenshot on a pastel sheet of graph
 * paper, torn scraps behind it, and three notes pinned round it in the
 * kinds the log keeps. The notes are drawn from the dictionary, so they are
 * in the reader's language; on a phone they step out of the way.
 */
function Stage({ t }: { t: T }) {
  return (
    <figure className="pop relative" style={{ animationDelay: "120ms" }}>
      <div className="tone-panel tone-sand dot-grid relative overflow-hidden !px-4 !pt-10 !pb-0 sm:!px-16 sm:!pt-16">
        <div aria-hidden="true" className="scrap tone-panel tone-mint absolute -top-6 -left-10 h-48 w-72 -rotate-6" />
        <div aria-hidden="true" className="scrap tone-panel tone-butter absolute -right-12 bottom-24 h-56 w-64 rotate-[8deg]" />
        <div aria-hidden="true" className="scrap tone-panel tone-lilac absolute top-10 right-24 hidden h-24 w-40 rotate-[-4deg] md:block" />

        <div className="frame relative mx-auto max-w-[860px] !rounded-b-none">
          <Image
            src="/screenshots/board.jpg"
            alt={t("landingShotAlt")}
            width={1920}
            height={885}
            sizes="(max-width: 1024px) 100vw, 860px"
            priority
            className="h-auto w-full"
          />
        </div>
      </div>

      <PinnedNote kind="dead_end" text={t("landingSampleDeadEnd")} t={t} className="top-[18%] -left-4 -rotate-3 lg:-left-10" />
      <PinnedNote kind="handoff" text={t("landingSampleHandoff")} t={t} className="top-[46%] -right-4 rotate-2 lg:-right-10" />
      <PinnedNote kind="question" text={t("landingSampleQuestion")} t={t} className="bottom-[14%] left-[6%] rotate-1" />
      <SparkleSticker size={44} tilt={8} className="absolute top-4 right-8 hidden sm:block" />

      <figcaption className="mt-4 text-center text-small text-muted">{t("landingShotCaption")}</figcaption>
    </figure>
  );
}

function PinnedNote({
  kind,
  text,
  t,
  className,
}: {
  kind: "dead_end" | "handoff" | "question";
  text: string;
  t: T;
  className: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`absolute z-10 hidden w-[240px] flex-col items-start gap-2 rounded-[14px] border border-line bg-card p-3.5 shadow-[var(--shadow-pop)] md:flex ${className}`}
    >
      <Chip color={KIND_COLOR[kind]}>{kindLabel(t, kind)}</Chip>
      <p className="text-[13.5px] leading-snug text-ink">{text}</p>
    </div>
  );
}

/** One more invitation, said once, with the agent mascot beside it. */
function Closing({ t }: { t: T }) {
  return (
    <section className="tone-panel tone-apricot pop flex flex-col items-center gap-5 !px-6 !py-14 text-center">
      <Blob mood="happy" size={64} className="bob" />
      <h2 className="display max-w-[20ch] text-[clamp(28px,4vw,40px)] leading-[1.1]">{t("landingConnectTitle")}</h2>
      <p className="max-w-[52ch] text-[15.5px] leading-relaxed text-muted">{t("landingConnectBody")}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/register" className="btn !px-6 !py-2.5 text-[15px]">
          {t("landingCta")}
        </Link>
        <a href="https://github.com/beydemirfurkan/todox" rel="noreferrer" className="btn btn-quiet !px-6 !py-2.5 text-[15px]">
          {t("landingOpenSource")}
        </a>
      </div>
      <p className="text-small text-muted">{t("landingHonest")}</p>
    </section>
  );
}

/** The headline, with its one marked phrase pulled out of the sentence so each
 *  language can put it wherever its word order wants it. */
function Headline({ t }: { t: T }) {
  const CUT = "⁣";
  const [before, after = ""] = t("landingHeadline", { mark: CUT }).split(CUT);
  return (
    <>
      {before}
      <span className="marker">{t("landingHeadlineMark")}</span>
      {after}
    </>
  );
}
