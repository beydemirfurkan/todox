"use client";

import { useState } from "react";

/** The whole point of the markdown report is getting it into a chat window. */
export function CopyMarkdown({
  markdown,
  label,
  copiedLabel,
}: {
  markdown: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(markdown);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            /* clipboard blocked -- the markdown is on screen and selectable */
          }
        }}
      >
        {copied ? copiedLabel : label}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </>
  );
}
