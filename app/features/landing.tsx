import Image from "next/image";
import Link from "next/link";

import type { T } from "@/lib/i18n";
import { Blob } from "../components";
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
      <p className="mono inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-meta text-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-[var(--accent)]" />
        {t("landingScrawl")}
      </p>
      <h1 className="display max-w-[16ch] text-[clamp(40px,7vw,84px)] leading-[1.02]">
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
      {/* A window, the way a developer meets every tool: a title bar with
          the address in it, and the product inside. */}
      <div className="overflow-hidden rounded-[12px] border border-line bg-card">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-3" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[var(--line)]" />
          <span className="size-2.5 rounded-full bg-[var(--line)]" />
          <span className="size-2.5 rounded-full bg-[var(--line)]" />
          <span className="mono mx-auto rounded-[6px] bg-inset px-3 py-1 text-meta text-faint">todox.dev/p/todox</span>
        </div>
        <Image
          src="/screenshots/board.jpg"
          alt={t("landingShotAlt")}
          width={1920}
          height={780}
          sizes="(max-width: 1100px) 100vw, 1100px"
          priority
          className="h-auto w-full"
        />
      </div>

      <div className="pointer-events-none absolute right-4 bottom-16 hidden w-[300px] flex-col gap-2 md:flex lg:-right-6" aria-hidden="true">
        <Toast kind="dead_end" text={t("landingSampleDeadEnd")} t={t} />
        <Toast kind="handoff" text={t("landingSampleHandoff")} t={t} />
      </div>

      <figcaption className="mt-5 text-center text-small text-muted">{t("landingShotCaption")}</figcaption>
    </figure>
  );
}

/** What an agent just wrote, the way the app would announce it. */
function Toast({ kind, text, t }: { kind: "dead_end" | "handoff"; text: string; t: T }) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-line bg-card p-3">
      <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[kind] }} />
      <div className="min-w-0">
        <p className="mono text-meta text-faint">log_entry · {kindLabel(t, kind)}</p>
        <p className="mt-0.5 text-[13.5px] leading-snug text-ink">{text}</p>
      </div>
    </div>
  );
}

/** One more invitation, said once, with the agent mascot beside it. */
function Closing({ t }: { t: T }) {
  return (
    <section className="sticker pop flex flex-col items-center gap-5 px-6 py-14 text-center">
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
