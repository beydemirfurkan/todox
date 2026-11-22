"use client";

import { useState } from "react";

type CopyState = "idle" | "copied" | "failed";

/**
 * The whole point of the markdown report is getting it into a chat window.
 *
 * The text is fetched on the click rather than carried in the page. Safari
 * only lets a click write to the clipboard if the write starts inside the
 * click, so where `ClipboardItem` exists the fetch is handed to it as a
 * promise; elsewhere the text is fetched first and written after.
 */
/** Text already on the page, or a URL to fetch it from on the click. */
type CopySource = { markdown: string; href?: never } | { href: string; markdown?: never };

export function CopyMarkdown({
  label,
  copiedLabel,
  failedLabel = label,
  ...source
}: CopySource & {
  label: string;
  copiedLabel: string;
  failedLabel?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");

  const copy = async () => {
    try {
      await writeToClipboard(source);
      setState("copied");
    } catch (error) {
      console.warn("copy markdown failed", error);
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  };

  const text = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;
  return (
    <>
      <button type="button" className="btn" onClick={copy}>
        {text}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "idle" ? "" : text}
      </span>
    </>
  );
}

async function fetchMarkdown(href: string): Promise<string> {
  const response = await fetch(href, { cache: "no-store" });
  if (!response.ok) throw new Error(`markdown answered ${response.status}`);
  return response.text();
}

async function writeToClipboard(source: CopySource): Promise<void> {
  if (source.markdown !== undefined) {
    await navigator.clipboard.writeText(source.markdown);
    return;
  }
  const href = source.href;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const blob = fetchMarkdown(href).then((text) => new Blob([text], { type: "text/plain" }));
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    return;
  }
  await navigator.clipboard.writeText(await fetchMarkdown(href));
}
