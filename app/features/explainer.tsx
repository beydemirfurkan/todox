import { ENTRY_KINDS } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { KIND_COLOR, kindHint, kindLabel } from "../kinds";
import { Blob } from "../components";

/** The product explains itself on the way in, so nobody has to read a README
 *  to know what a "dead end" is or why the log lives outside the repo. */
export function Explainer({ t }: { t: T }) {
  const steps = [
    { n: 1, title: t("step1Title"), body: t("step1Body"), fill: "var(--k-decision)" },
    { n: 2, title: t("step2Title"), body: t("step2Body"), fill: "var(--accent)" },
    { n: 3, title: t("step3Title"), body: t("step3Body"), fill: "var(--k-handoff)" },
  ];

  return (
    <section className="space-y-4">
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.n}
            className="sticker pop p-3.5"
            style={{ animationDelay: `${80 + i * 60}ms` }}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="on-fill display flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line text-[12px] font-bold"
                style={{ background: s.fill, borderColor: "var(--edge-dark)" }}
              >
                {s.n}
              </span>
              <h3 className="display text-[16px] font-bold">{s.title}</h3>
            </div>
            <p className="mt-1.5 text-[14px] leading-snug text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <details className="sticker pop p-4" style={{ animationDelay: "260ms" }}>
        <summary className="link-more">{t("kindsSummary")}</summary>
        <ul className="mt-3 space-y-2">
          {ENTRY_KINDS.map((k) => (
            <li key={k} className="flex items-start gap-2.5">
              <span
                className="on-fill display mt-px shrink-0 rounded-full border-[1.5px] border-line px-2 pt-[1px] pb-[2px] text-[12px] leading-none font-bold"
                style={{ background: KIND_COLOR[k], borderColor: "var(--edge-dark)" }}
              >
                {kindLabel(t, k)}
              </span>
              <span className="text-[14px] leading-snug text-muted">
                {kindHint(t, k)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export function FirstRun({ t }: { t: T }) {
  return (
    <div className="sticker pop flex flex-col items-center gap-3 p-8 text-center">
      <Blob mood="happy" size={64} className="bob" />
      <h2 className="display text-[21px] font-bold">{t("firstRunTitle")}</h2>
      <p className="max-w-sm text-[14px] text-muted">{t("firstRunBody")}</p>
    </div>
  );
}
