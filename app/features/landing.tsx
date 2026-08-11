import Link from "next/link";

import type { T } from "@/lib/i18n";
import { Blob } from "../components";
import { Explainer } from "./explainer";

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
      <section className="relative flex flex-col items-center gap-4 py-6 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-[min(360px,50vh)] w-[90%] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.07] blur-3xl"
          style={{ background: "var(--accent)" }}
        />

        <Blob mood="happy" size={72} className="bob pop" />

        <h1 className="display pop max-w-[18ch] text-[32px] leading-[1.08] font-bold sm:text-[44px]">
          {t("heroTitle")}
        </h1>

        <p
          className="pop max-w-[52ch] text-[16px] leading-relaxed text-muted"
          style={{ animationDelay: "60ms" }}
        >
          {t("landingLede")}
        </p>

        <p
          className="pop max-w-[56ch] text-[15px] leading-relaxed"
          style={{ animationDelay: "100ms" }}
        >
          {t("heroBody")}
        </p>

        <div
          className="pop mt-2 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "140ms" }}
        >
          <Link href="/register" className="btn">
            {t("landingCta")}
          </Link>
          <Link href="/login" className="link-more">
            {t("landingSecondary")}
          </Link>
        </div>
      </section>

      {/* The same three steps the dashboard shows. Somebody deciding whether to
          sign up needs them more than somebody who already has. */}
      <Explainer t={t} />

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
