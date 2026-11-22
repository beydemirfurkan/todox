import { ENTRY_KINDS } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { KIND_COLOR, kindHint, kindLabel } from "../kinds";
import { Chip, LogoMark } from "../components";

/**
 * The product explains itself on the way in, so nobody has to read a README
 * to know what a "dead end" is or why the log lives outside the repo.
 *
 * Three pastel panels, each with a small drawing of the screen the step
 * happens on: the picture says it first and the sentence under it only
 * confirms. The drawings are markup, not images, so they follow the theme
 * and the language like everything else.
 */
export function Explainer({ t }: { t: T }) {
  const steps = [
    { tone: "tone-mint", title: t("step1Title"), body: t("step1Body"), art: <WriteArt t={t} /> },
    { tone: "tone-butter", title: t("step2Title"), body: t("step2Body"), art: <KeepArt t={t} /> },
    { tone: "tone-sky", title: t("step3Title"), body: t("step3Body"), art: <ReadArt t={t} /> },
  ];

  return (
    <section className="space-y-4">
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="pop flex flex-col gap-4" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <div className={`tone-panel ${step.tone} flex min-h-[210px] items-center justify-center`}>
              <div className="frame w-full max-w-[300px]" aria-hidden="true">
                {step.art}
              </div>
            </div>
            <div className="px-1">
              <h3 className="display flex items-baseline gap-2 text-[21px] leading-tight">
                <span className="mono text-[13px] text-faint">0{i + 1}</span>
                {step.title}
              </h3>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <details className="sticker pop p-4" style={{ animationDelay: "260ms" }}>
        <summary className="link-more">{t("kindsSummary")}</summary>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ENTRY_KINDS.map((k) => (
            <li key={k} className="flex items-start gap-2.5">
              <Chip color={KIND_COLOR[k]}>{kindLabel(t, k)}</Chip>
              <span className="text-[14px] leading-snug text-muted">{kindHint(t, k)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Step one: an agent's call, drawn as the terminal line it is. */
function WriteArt({ t }: { t: T }) {
  return (
    <div className="mono space-y-1.5 bg-[var(--band)] p-3.5 text-[12px] leading-snug text-[var(--band-muted)]">
      <p>
        <span className="text-[var(--accent)]">▸</span> log_entry
      </p>
      <p className="pl-3">
        kind: <span className="text-[var(--band-ink)]">&quot;dead_end&quot;</span>
      </p>
      <p className="truncate pl-3">
        <span className="text-[var(--band-ink)]">&quot;{t("landingSampleDeadEnd")}&quot;</span>
      </p>
      <p>
        <span className="text-[var(--ok)]">✓</span> #806
      </p>
    </div>
  );
}

/** Step two: the log itself, a few lines of it, each with its kind. */
function KeepArt({ t }: { t: T }) {
  const rows = [
    { kind: "decision" as const, text: t("landingSampleDecision") },
    { kind: "dead_end" as const, text: t("landingSampleDeadEnd") },
    { kind: "handoff" as const, text: t("landingSampleHandoff") },
  ];
  return (
    <ul className="divide-y divide-[var(--rule)]">
      {rows.map((row) => (
        <li key={row.kind} className="flex flex-col items-start gap-1 px-3.5 py-2.5">
          <Chip color={KIND_COLOR[row.kind]}>{kindLabel(t, row.kind)}</Chip>
          <span className="line-clamp-1 text-[12.5px] text-ink">{row.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Step three: a new session, and what it already knows when it opens. */
function ReadArt({ t }: { t: T }) {
  const known = [
    { kind: "decision" as const, n: 2 },
    { kind: "dead_end" as const, n: 1 },
    { kind: "handoff" as const, n: 1 },
  ];
  return (
    <div className="space-y-3 p-3.5">
      <div className="flex items-center gap-2">
        <LogoMark size={22} />
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink">{t("landingNewSession")}</p>
          <p className="text-meta text-faint">{t("landingKnowsNow")}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {known.map((row) => (
          <li key={row.kind} className="flex items-center justify-between rounded-[8px] bg-inset px-2.5 py-1.5">
            <Chip color={KIND_COLOR[row.kind]}>{kindLabel(t, row.kind)}</Chip>
            <span className="mono text-[12px] text-muted">×{row.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The three things todox does that a note in a file does not.
 *
 * They sit beside the payload, as what to look for in it: the claims are
 * worth nothing to somebody who has not seen the payload, and the payload is
 * unreadable to somebody who has not been told what to look for.
 */
export function Differences({ t }: { t: T }) {
  const claims = [
    { title: t("diff1Title"), body: t("diff1Body"), fill: "var(--k-dead_end)" },
    { title: t("diff2Title"), body: t("diff2Body"), fill: "var(--k-question)" },
    { title: t("diff3Title"), body: t("diff3Body"), fill: "var(--ok)" },
  ];

  return (
    <ul className="space-y-4">
      {claims.map((c) => (
        <li key={c.title} className="flex items-start gap-3">
          {/* A colour and a heading, never a colour alone. */}
          <span aria-hidden="true" className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: c.fill }} />
          <div>
            <h3 className="text-[15px] leading-snug font-semibold">{c.title}</h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">{c.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The objection a newcomer raises first: why not the memory the agent
 * already keeps? Each tile is one of that memory's limits crossed. A line's
 * first sentence is its headline; the rest is the explanation, quieter.
 */
export function VsNative({ t }: { t: T }) {
  const lines = [t("vsNative1"), t("vsNative2"), t("vsNative3"), t("vsNative4")];
  const icons = [<MachinesIcon key="m" />, <AgentsIcon key="a" />, <PeopleIcon key="p" />, <ShapesIcon key="s" />];
  const tones = ["tone-sky", "tone-lilac", "tone-apricot", "tone-mint"];
  return (
    <section className="space-y-6">
      <div className="mx-auto max-w-[40rem] text-center">
        <h2 className="display text-[clamp(28px,4vw,40px)] leading-[1.1]">{t("vsNativeTitle")}</h2>
        <p className="mt-3 text-[15.5px] leading-relaxed text-muted">{t("vsNativeBody")}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {lines.map((line, i) => {
          const cut = [". ", ": "].map((mark) => line.indexOf(mark)).find((at) => at !== -1) ?? -1;
          const head = cut === -1 ? line : line.slice(0, cut + 1);
          const rest = cut === -1 ? "" : line.slice(cut + 2);
          return (
            <li key={line} className="sticker pop flex items-start gap-4 p-5" style={{ animationDelay: `${i * 60}ms` }}>
              <span className={`tone-panel ${tones[i]} flex size-12 shrink-0 items-center justify-center !p-0 !rounded-[14px]`}>
                {icons[i]}
              </span>
              <div className="min-w-0">
                <h3 className="text-[16px] leading-snug font-semibold">{head}</h3>
                {rest && <p className="mt-1 text-[14px] leading-relaxed text-muted">{rest}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ICON = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MachinesIcon() {
  return (
    <svg {...ICON}>
      <rect x="2.5" y="5" width="11" height="8" rx="1.5" />
      <path d="M1.5 16h13" />
      <rect x="15" y="4" width="6.5" height="12" rx="1.5" />
      <path d="M17.5 19.5h1.5" />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg {...ICON}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8 8.5 10.5 16M16 8.5 13.5 16M8.5 7h7" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.3" />
      <path d="M16 14.2c2.3 0 4 1.5 4.5 4.3" />
    </svg>
  );
}

function ShapesIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <circle cx="17" cy="7" r="4" />
      <path d="M7 14l4 7H3z" />
      <path d="M14 14h7v7h-7z" />
    </svg>
  );
}
