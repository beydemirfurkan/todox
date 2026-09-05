import type { T } from "@/lib/i18n";

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
    <section className="sticker pop p-4 sm:p-5" style={{ animationDelay: "220ms" }}>
      <h2 className="display text-[18px] font-bold">{t("briefingTitle")}</h2>
      <p className="mt-1 max-w-[62ch] text-[14.5px] leading-relaxed text-muted">
        {t("briefingBody")}
      </p>

      {/* The one wide element on the page, so it scrolls inside its own box
          rather than making the page scroll sideways. */}
      <div className="mt-3 overflow-x-auto">
        <pre className="mono sticker-flat min-w-0 p-3 text-[12.5px] leading-relaxed">
          <code>{SAMPLE}</code>
        </pre>
      </div>

      <p className="mt-2 text-[13px] text-faint">{t("briefingCaption")}</p>
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
