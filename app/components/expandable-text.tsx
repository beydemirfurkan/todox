"use client";

import { useId, useState } from "react";

/** A paragraph clamped to four lines, with the full text always reachable. */
export function ExpandableText({
  text,
  more,
  less,
  className = "",
}: {
  text: string;
  more: string;
  less: string;
  className?: string;
}) {
  const body = `break-words whitespace-pre-wrap ${className}`;
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();

  if (!isLongerThanTheClamp(text)) return <p className={body}>{text}</p>;

  return (
    <div>
      <p id={contentId} className={`${isExpanded ? "" : "line-clamp-4"} ${body}`}>
        {text}
      </p>
      <button
        type="button"
        className="link-more mt-1.5"
        aria-controls={contentId}
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((current) => !current)}
      >
        {isExpanded ? less : more}
      </button>
    </div>
  );
}

const CLAMPED_LINES = 4;

/**
 * Whether the clamp will actually bite, guessed from the text alone.
 *
 * It has to be a guess: the real answer depends on the rendered width, and the
 * server has none. Sixty characters is roughly a line in these rails. The two
 * ways to be wrong are not equal — a control on a note that already fits is a
 * word the reader ignores, while a missing one is text they cannot reach — so
 * the estimate is deliberately generous about offering it.
 */
function isLongerThanTheClamp(text: string): boolean {
  return text.length > CLAMPED_LINES * 60 || text.split("\n").length > CLAMPED_LINES;
}
