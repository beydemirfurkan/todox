import Image from "next/image";
import Link from "next/link";

import type { T } from "@/lib/i18n";
import { Blob, BoltSticker, HandArrow, HeartSticker, SparkleSticker } from "../components";
import { BriefingPreview } from "./briefing-preview";
import { Differences, Explainer, VsNative } from "./explainer";

/**
 * What somebody sees at todox.dev before they have an account.
 *
 * There was nothing: the root redirected to a login form, so an open-source
 * product whose whole pitch is "your agent should know what the last session
 * knew" opened with a username field and a five-word tagline. The copy here is
 * the copy the signed-in page already used — the explanation existed, it was
 * just behind the door.
 */
export function Landing({ t }: { t: T }) {
  return (
    <div className="space-y-10 pb-6">
      {/* Two columns, left-aligned like a page in a notebook: the sentence and
          the way in on the left, the thing itself on the right. The product
          is the picture -- a real task, photographed like an object on the
          desk, with its name label stuck on. */}
      <section className="pt-4 pb-2">
        <div className="pop flex flex-col items-start gap-4">
          <p className="scrawl text-[20px] sm:text-[24px]">{t("landingScrawl")}</p>
          <h1 className="display max-w-[14ch] text-[clamp(44px,8.4vw,104px)] leading-[1.04]">
            <Headline t={t} />
          </h1>
        </div>

        <div className="mt-10 grid items-start gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
          <div className="pop flex min-w-0 flex-col items-start gap-6" style={{ animationDelay: "60ms" }}>
            <p className="prose text-[17px] leading-relaxed text-muted">{t("landingLede")}</p>
            <div className="flex flex-col items-start gap-2">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link href="/register" className="btn">
                  {t("landingCta")}
                </Link>
                <Link href="/login" className="link-more">
                  {t("landingSecondary")}
                </Link>
              </div>
              <p className="text-small text-muted">{t("landingCtaNote")}</p>
            </div>
          </div>

          <figure className="pop relative mx-auto w-full max-w-[600px] pt-10" style={{ animationDelay: "120ms" }}>
            <div className="absolute top-0 right-6 hidden items-end gap-1 sm:flex">
              <p className="scrawl text-[19px]">{t("landingArrowNote")}</p>
              <HandArrow className="mb-[-34px] text-ink" width={58} />
            </div>

            <BoltSticker size={52} tilt={-14} className="absolute top-4 -left-3 z-10 sm:-left-7" />
            <HeartSticker size={50} tilt={11} className="absolute top-14 -right-3 z-10 sm:-right-6" />
            <SparkleSticker size={44} tilt={8} className="absolute -right-2 bottom-20 z-10 sm:-right-5" />

            <div className="sticker rotate-[2deg] overflow-hidden p-1.5">
              <Image
                src="/screenshots/task-log.jpg"
                alt={t("landingShotAlt")}
                width={1054}
                height={910}
                sizes="(max-width: 1024px) 100vw, 600px"
                priority
                className="h-auto w-full rounded-[8px]"
              />
            </div>

            <NameLabel t={t} />

            <figcaption className="mt-5 text-small text-muted sm:pl-[44%]">
              {t("landingShotCaption")}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* The same three steps the dashboard shows. Somebody deciding whether to
          sign up needs them more than somebody who already has. */}
      <Explainer t={t} />

      {/* Then the arguable part, and then the evidence for it. In that order:
          the claims are worth nothing to somebody who has not seen the payload,
          and the payload is unreadable to somebody who has not been told what
          to look for in it. */}
      <Differences t={t} />
      {/* The objection before the evidence: somebody who has just read three
          claims about a log is about to ask why the notes their agent already
          keeps are not that log. */}
      <VsNative t={t} />
      <BriefingPreview t={t} />

      <section className="sticker pop p-5" style={{ animationDelay: "300ms" }}>
        <div className="flex items-start gap-4">
          <Blob mood="idle" size={52} fill="var(--k-handoff)" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="display text-[18px] font-bold">{t("landingConnectTitle")}</h2>
            <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
              {t("landingConnectBody")}
            </p>
          </div>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center text-[13.5px] text-faint">
        <a
          href="https://github.com/beydemirfurkan/todox"
          className="link-more text-small"
          rel="noreferrer"
        >
          {t("landingOpenSource")}
        </a>
        <span>{t("landingHonest")}</span>
      </footer>
    </div>
  );
}

/** The headline, with its one marked phrase pulled out of the sentence so each
 *  language can put it wherever its word order wants it. */
function Headline({ t }: { t: T }) {
  const CUT = "\u2063";
  const [before, after = ""] = t("landingHeadline", { mark: CUT }).split(CUT);
  return (
    <>
      {before}
      <span className="marker">{t("landingHeadlineMark")}</span>
      {after}
    </>
  );
}

/** The label on the notebook's cover: which project, which task, how far. */
function NameLabel({ t }: { t: T }) {
  const rows: [string, string][] = [
    [t("landingLabelProject"), "todox"],
    [t("landingLabelTask"), "#169"],
    [t("landingLabelState"), t("st_doing")],
  ];
  return (
    <div
      aria-hidden="true"
      className="name-label relative z-10 -mt-6 ml-4 w-[190px] -rotate-[4deg] sm:absolute sm:bottom-6 sm:-left-6 sm:mt-0 sm:ml-0"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2 border-b border-dashed border-line py-1 last:border-0">
          <span className="mono w-[62px] shrink-0 text-meta text-faint">{label}</span>
          <span className="scrawl-ink truncate text-[17px]">{value}</span>
        </div>
      ))}
      <Blob mood="happy" size={30} className="absolute -top-4 -right-3" />
    </div>
  );
}
