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
              <h2 className="display text-[16px] font-bold">{s.title}</h2>
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

/**
 * The three things todox does that a note in a file does not.
 *
 * The landing page said what the product *is* — a memory, a log — which is what
 * every other tool in this category says too. It never said the parts that are
 * actually arguable: that a failed approach is worth its own kind of entry,
 * that a note is checked rather than trusted, and that the report is read from
 * the log rather than reconstructed. Those are the claims; they belong where
 * somebody deciding can read them.
 */
export function Differences({ t }: { t: T }) {
  const claims = [
    { title: t("diff1Title"), body: t("diff1Body"), fill: "var(--k-dead_end)" },
    { title: t("diff2Title"), body: t("diff2Body"), fill: "var(--k-question)" },
    { title: t("diff3Title"), body: t("diff3Body"), fill: "var(--ok)" },
  ];

  return (
    <section className="space-y-3">
      <h2 className="display text-[19px] font-bold">{t("diffTitle")}</h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {claims.map((c, i) => (
          <li key={c.title} className="sticker pop p-3.5" style={{ animationDelay: `${140 + i * 60}ms` }}>
            {/* A colour and a heading, never a colour alone. */}
            <span
              aria-hidden="true"
              className="block h-1.5 w-9 rounded-full border-[1.5px] border-line"
              style={{ background: c.fill, borderColor: "var(--edge-dark)" }}
            />
            <h3 className="display mt-2 text-[15.5px] leading-snug font-bold">{c.title}</h3>
            <p className="mt-1.5 text-[14px] leading-snug text-muted">{c.body}</p>
          </li>
        ))}
      </ul>
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
