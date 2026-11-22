"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MarkdownPreview = dynamic(() =>
  import("../components/markdown-preview").then((m) => m.MarkdownPreview),
);

type Loaded = { state: "idle" | "loading" | "failed" } | { state: "ready"; markdown: string };

/**
 * The report's markdown, rendered only once somebody opens the preview. Both
 * the text and the renderer arrive on that first open, so a visit that never
 * opens it pays for neither.
 */
export function MarkdownOnDemand({
  href,
  summary,
  loadingLabel,
  failedLabel,
}: {
  href: string;
  summary: string;
  loadingLabel: string;
  failedLabel: string;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });

  const load = async () => {
    setLoaded({ state: "loading" });
    try {
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(`markdown answered ${response.status}`);
      setLoaded({ state: "ready", markdown: await response.text() });
    } catch (error) {
      console.warn("markdown preview failed", error);
      setLoaded({ state: "failed" });
    }
  };

  return (
    <details
      className="disclosure"
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        if (isOpen && (loaded.state === "idle" || loaded.state === "failed")) void load();
      }}
    >
      <summary className="text-small text-muted">{summary}</summary>
      <div className="mt-3" aria-live="polite">
        {loaded.state === "ready" ? (
          <MarkdownPreview markdown={loaded.markdown} />
        ) : loaded.state === "failed" ? (
          <p className="text-small text-muted">{failedLabel}</p>
        ) : (
          <p className="text-small text-faint">{loadingLabel}</p>
        )}
      </div>
    </details>
  );
}
