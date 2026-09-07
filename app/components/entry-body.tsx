"use client";

import { useId, useState } from "react";

import { splitHeadline } from "@/lib/util/headline";
import { MarkdownPreview } from "./markdown-preview";

const PREVIEW_CHARACTERS = 480;
const PREVIEW_LINES = 6;

function cutAtWord(text: string): string {
  const limited = text.slice(0, PREVIEW_CHARACTERS);
  const boundary = limited.lastIndexOf(" ");
  return (
    boundary > PREVIEW_CHARACTERS / 2 ? limited.slice(0, boundary) : limited
  ).trimEnd();
}

export function entryExcerpt(text: string): string {
  const lines = text.split("\n");
  const isLong = text.length > PREVIEW_CHARACTERS || lines.length > PREVIEW_LINES;
  if (!isLong) return text;

  const lineLimited = lines.slice(0, PREVIEW_LINES).join("\n");
  return `${cutAtWord(lineLimited)}…`;
}

export function EntryBody({
  body,
  more,
  less,
}: {
  body: string;
  more: string;
  less: string;
}) {
  const { headline, rest } = splitHeadline(body);
  const excerpt = entryExcerpt(rest);
  const isCollapsible = excerpt !== rest;
  const [isExpanded, setIsExpanded] = useState(false);
  const contentId = useId();

  return (
    <>
      {headline && (
        <h3 className="display mt-2 text-[16px] leading-snug font-bold break-words">
          {headline}
        </h3>
      )}
      <div id={contentId} className={headline ? "mt-1" : "mt-2"}>
        <MarkdownPreview
          markdown={isCollapsible && !isExpanded ? excerpt : rest}
          variant="entry"
        />
      </div>
      {isCollapsible && (
        <button
          type="button"
          className="link-more mt-1"
          aria-controls={contentId}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? less : more}
        </button>
      )}
    </>
  );
}
