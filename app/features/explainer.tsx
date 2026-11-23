import type { T } from "@/lib/i18n";
import { BriefingPreview } from "./briefing-preview";

export function Explainer({ t }: { t: T }): React.JSX.Element {
  const steps = [
    { title: t("step1Title"), body: t("step1Body") },
    { title: t("step2Title"), body: t("step2Body") },
    { title: t("step3Title"), body: t("step3Body") },
  ];

  return (
    <section aria-labelledby="how-it-works" className="mx-auto w-full max-w-lg border-t border-line pt-9 md:max-w-none md:pt-12">
      <div className="max-w-lg">
        <p className="mono text-meta text-accentInk">{t("landingHowTitle")}</p>
        <h2 id="how-it-works" className="display mt-3 text-[clamp(30px,5vw,48px)] leading-[1.08] text-balance">
          {t("landingHowHeading")}
        </h2>
      </div>

      <ol className="landing-steps mt-8 grid md:grid-cols-3 md:gap-8" role="list">
        {steps.map(({ title, body }, index) => (
          <li key={title}>
            <span aria-hidden="true" className="landing-step-number mono text-meta">0{index + 1}</span>
            <div>
              <h3 className="display text-[20px] leading-tight md:mt-4">{title}</h3>
              <p className="mt-2 max-w-[38ch] text-small leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <BriefingPreview t={t} />
    </section>
  );
}
