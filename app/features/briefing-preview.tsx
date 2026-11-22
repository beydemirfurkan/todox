import type { T } from "@/lib/i18n";
import { Differences } from "./explainer";

/**
 * What `get_context` actually answers with.
 *
 * A stranger could not see the product before signing up. The landing page
 * described it — a memory, a log, three steps — and the thing being described
 * is a payload, so the description was doing work a sample does better. This is
 * the sample: the shape of the first call every session makes, with the two
 * fields that are the whole argument (`dead_ends`, and a linked file that says
 * it may be lying) sitting in it rather than being claimed above it.
 *
 * Every record carries its id, and so does the real payload: that is what lets
 * an agent answer the open question it was just shown rather than only read it.
 * Trimming a sample for width is fair; showing a shape the API does not return
 * is the dishonesty this file's own caption warns about.
 *
 * Hand-written rather than generated from a live account: it has to be legible
 * at this width, and a real briefing is not. `briefingCaption` says so — a
 * trimmed sample presented as the whole thing would be the same dishonesty the
 * staleness flag exists to avoid.
 */
export function BriefingPreview({ t }: { t: T }) {
  return (
    <section className="grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr]">
      <div className="pop space-y-6">
        <div>
          <h2 className="display text-[clamp(28px,4vw,40px)] leading-[1.1]">{t("briefingTitle")}</h2>
          <p className="mt-3 max-w-[46ch] text-[15.5px] leading-relaxed text-muted">{t("briefingBody")}</p>
        </div>
        <h3 className="display text-[19px]">{t("diffTitle")}</h3>
        <Differences t={t} />
      </div>

      <figure className="pop min-w-0" style={{ animationDelay: "80ms" }}>
        {/* The one wide element on the page, so it scrolls inside its own box
            rather than making the page scroll sideways. Graphite, like a
            terminal, because that is where an agent reads it. */}
        <div className="overflow-hidden rounded-[var(--radius-card)] bg-[var(--band)] shadow-[var(--shadow-lg)]">
          <div className="flex items-center gap-1.5 border-b border-[var(--band-rule)] px-4 py-3" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-[var(--k-dead_end)]" />
            <span className="size-2.5 rounded-full bg-[var(--k-question)]" />
            <span className="size-2.5 rounded-full bg-[var(--ok)]" />
            <span className="mono ml-3 text-meta text-[var(--band-muted)]">get_context</span>
          </div>
          <div className="board-scroll max-h-[520px] overflow-auto">
            <pre className="mono p-4 text-[12.5px] leading-relaxed text-[var(--band-ink)]">
              <code>{SAMPLE}</code>
            </pre>
          </div>
        </div>
        <figcaption className="mt-3 text-small text-muted">{t("briefingCaption")}</figcaption>
      </figure>
    </section>
  );
}

/**
 * Kept out of the dictionaries on purpose.
 *
 * It is a JSON payload, not prose: the keys are the API's and do not translate,
 * and the handful of values are there to show the shape. Putting it through
 * `en.ts`/`tr.ts` would add a dozen keys whose "translation" is a made-up task
 * title, and the two-dictionary rule exists for strings a reader has to
 * understand, not for a code sample.
 */
const SAMPLE = `{
  "project": { "slug": "todox", "summary": "Working memory for agents." },
  "project_context": [
    { "kind": "gotcha",
      "title": "A tool that answers {} still looks connected",
      "body": "get_context returned {} on both transports: the transform
               is async and the call site did not await it." }
  ],
  "open_tasks": [
    {
      "title": "Bound the reads that had no ceiling",
      "status": "doing",
      "last_handoff": {
        "id": 903, "kind": "handoff", "created_at": "2026-09-04",
        "head": "Byte budget landed; heads are the remaining axis.",
        "body": "auth bypass closed; briefing capped per kind and now
                 per byte. Left: the heads, which are still row-capped."
      },
      "decisions": [
        { "id": 812, "kind": "decision", "created_at": "2026-08-21",
          "head": "Capped per kind, not per task.",
          "body": "A flat cut drops the two old dead ends, and a dead
                   end is the entry that stops a repeat." },
        { "id": 819, "kind": "decision", "created_at": "2026-09-04",
          "head": "Bytes, not count — a count of three says nothing.",
          "body": null }
      ],
      "dead_ends": [
        { "id": 806, "kind": "dead_end", "created_at": "2026-08-20",
          "head": "1 MB body ceiling refused legal calls.",
          "body": null }
      ],
      "files": [
        { "path": "lib/services/briefing.ts", "status": "changed" },
        { "path": "proxy.ts",                 "status": "not checked" }
      ],
      "entry_count": 14,
      "log_omitted": 3
    }
  ],
  "log_bodies_omitted": 2,
  "log_ranked_by": "focus",
  "stale_refs": ["task #113 -> lib/services/briefing.ts (changed)"]
}`;
