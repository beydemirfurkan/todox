import Image from "next/image";
import Link from "next/link";

import type { T } from "@/lib/i18n";
import { LogoMark } from "../components";
import { Icon } from "../components/icons";
import { Explainer } from "./explainer";
import { MemoryDemo } from "./memory-demo";

/**
 * What somebody sees at todox.dev before they have an account.
 *
 * The pitch, a look at the product, then the details in the order a visitor
 * might ask for them.
 */
export function Landing({ t }: { t: T }) {
  return (
    <div className="space-y-20 md:space-y-24">
      <div className="space-y-10 md:space-y-12">
        <Hero t={t} />
        <Stage t={t} />
      </div>

      <Explainer t={t} />
      <Closing t={t} />
    </div>
  );
}

function Hero({ t }: { t: T }) {
  return (
    <section className="pop mx-auto flex max-w-3xl flex-col items-center gap-5 pt-12 text-center md:pt-14">
      <p className="mono flex items-center gap-2.5 rounded-full border border-line bg-card px-3 py-1.5 text-meta text-muted">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
        {t("landingScrawl")}
      </p>
      <h1 className="display max-w-[16ch] text-[clamp(40px,11.5vw,76px)] leading-[1.02] text-balance md:text-[clamp(56px,8vw,76px)]">
        <Headline t={t} />
      </h1>
      <p className="max-w-[38ch] text-body leading-relaxed text-muted md:max-w-[46ch] md:text-[17px]">{t("landingLede")}</p>
      <Link href="/login" className="btn mt-1 !min-h-12 !gap-3 !px-5">
        {t("landingCta")}
        <Icon name="arrow-right" size={18} />
      </Link>
    </section>
  );
}

/**
 * The board is legible on wide screens. The phone preview shows the log at
 * reading size instead of shrinking the whole desktop UI.
 */
function Stage({ t }: { t: T }) {
  return (
    <div className="pop" style={{ animationDelay: "120ms" }}>
      <div className="mx-auto max-w-lg md:hidden">
        <MemoryDemo
          title={t("landingDemoTitle")}
          replayLabel={t("landingDemoReplay")}
          steps={[
            { command: "log_entry", label: t("landingDemoSession", { n: "01" }), text: t("landingDemoWrite") },
            { command: "get_context", label: t("landingDemoSession", { n: "02" }), text: t("landingDemoRead") },
          ]}
        />
      </div>

      <figure className="hidden md:block">
        <Image
          src="/screenshots/board-dark.jpg"
          alt={t("landingShotAlt")}
          width={1920}
          height={780}
          sizes="(max-width: 1024px) calc(100vw - 40px), 984px"
          className="h-auto w-full rounded-[12px] border border-line"
        />
        <figcaption className="mx-auto mt-4 max-w-[68ch] text-center text-small text-muted">
          {t("landingShotCaption")}
        </figcaption>
      </figure>
    </div>
  );
}

// theSVG brand marks, served locally. Codex uses the dark-background variant.
const INTEGRATIONS = [
  { slug: "claude-code", name: "Claude Code", href: "https://code.claude.com/docs/en/mcp" },
  { slug: "codex", name: "Codex", href: "https://developers.openai.com/codex/mcp" },
  { slug: "cursor", name: "Cursor", href: "https://cursor.com/docs/mcp" },
  { slug: "visual-studio-code", name: "Visual Studio Code", href: "https://code.visualstudio.com/docs/agent-customization/mcp-servers" },
];

function Closing({ t }: { t: T }) {
  return (
    <section aria-labelledby="landing-connect" className="landing-connect sticker mx-auto max-w-lg px-5 py-8 text-center md:max-w-none md:px-8 md:py-12">
      <p className="mono text-meta text-accentInk">{t("landingConnectEyebrow")}</p>
      <h2 id="landing-connect" className="display mx-auto mt-3 max-w-[19ch] text-[clamp(30px,5vw,48px)] leading-[1.08] text-balance">
        {t("landingConnectTitle")}
      </h2>
      <p className="mx-auto mt-4 max-w-[48ch] text-small leading-relaxed text-muted md:text-body">{t("landingConnectBody")}</p>

      <div className="landing-integrations mx-auto my-8 w-full max-w-[320px]">
        <ul className="grid grid-cols-2 gap-x-12 gap-y-3" role="list">
          {INTEGRATIONS.map(({ slug, name, href }) => (
            <li key={slug} className="relative">
              <a href={href} title={name} className="grid min-h-14 place-items-center rounded-[9px] border border-line bg-paper hover:bg-raised">
                <Image src={`/integrations/${slug}.svg`} alt={name} width={26} height={26} className="size-[26px] object-contain" />
              </a>
            </li>
          ))}
        </ul>
        <span className="landing-integration-mark"><LogoMark size={36} /></span>
      </div>

      <Link href="/login" className="btn !min-h-12 !gap-3 !px-5">
        {t("landingCta")}
        <Icon name="arrow-right" size={18} />
      </Link>
      <p className="mt-2">
        <a href="https://github.com/beydemirfurkan/todox" rel="noreferrer" className="link-more inline-flex items-center gap-2">
          <Image src="/icons/github.svg" alt="" width={14} height={14} />
          {t("landingOpenSource")}
        </a>
      </p>
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
