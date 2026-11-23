import type { T } from "@/lib/i18n";
import { Icon } from "../components/icons";

export function BriefingPreview({ t }: { t: T }): React.JSX.Element {
  return (
    <details className="sticker group mt-7 md:mt-9">
      <summary className="flex min-h-16 list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 shrink-0 place-items-center rounded-[9px] border border-line bg-inset text-accentInk">
          <Icon name="terminal" size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-small font-medium text-ink">{t("briefingTitle")}</span>
          <code className="mono block text-meta text-faint">get_context</code>
        </span>
        <span aria-hidden="true" className="mr-1 size-2 shrink-0 rotate-45 border-r border-b border-faint group-open:-rotate-[135deg]" />
      </summary>
      <div className="border-t border-line px-4 pt-4 pb-3">
        <pre className="mono rounded-[10px] bg-inset p-3 text-meta leading-relaxed whitespace-pre-wrap wrap-anywhere text-ink"><code>{SAMPLE}</code></pre>
        <p className="mt-3 text-meta text-muted">{t("briefingCaption")}</p>
      </div>
    </details>
  );
}

const SAMPLE = `{
  "project": { "slug": "checkout" },
  "open_tasks": [{
    "id": 42,
    "title": "Test payment retries",
    "status": "doing",
    "decisions": [{
      "id": 93,
      "head": "Retry only on a network error."
    }],
    "last_handoff": {
      "id": 94,
      "head": "Next: add the network error test."
    }
  }]
}`;
