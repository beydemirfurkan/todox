import Link from "next/link";

import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import { firstLine } from "@/lib/util/headline";
import { kindLabel, statusLabel } from "../kinds";
import type { WaitingItem, WaitingKind } from "../waiting";
import { projectColor } from "./project-color";

/**
 * What only a person can move, across every project: open questions, stuck
 * tasks and work left in progress with nothing written. One calm list rather
 * than a grid of cards: the cards put the date on a line of its own and cut
 * every question to the same two lines. Each row says its kind in words, so
 * the colour never has to.
 */

const WAITING_COLOR: Record<WaitingKind, string> = {
  question: "var(--k-question)",
  blocked: "var(--k-dead_end)",
  quiet: "var(--k-note)",
};

/** The chip says the kind in words, so the colour never has to. */
function waitingLabel(item: WaitingItem, t: T): string {
  if (item.kind === "question") return kindLabel(t, "question");
  if (item.kind === "blocked") return statusLabel(t, "blocked");
  return t("quietFor", { n: item.quietDays ?? 0 });
}

export function WaitingList({
  items,
  omitted,
  slugOf,
  t,
}: {
  items: WaitingItem[];
  /** Waiting, and not in `items`. */
  omitted: number;
  /** A project's slug by id; an item whose project is unknown is not drawn. */
  slugOf: ReadonlyMap<number, string>;
  t: T;
}) {
  return (
    <>
      <ul className="waiting-list">
        {items.map((item) => {
          const slug = slugOf.get(item.projectId);
          if (!slug) return null;
          return (
            <li key={`${item.kind}-${item.taskId}`}>
              <Link href={`/p/${slug}/t/${item.taskId}`} className="waiting-row">
                <span
                  className="waiting-kind"
                  style={{ "--kind": WAITING_COLOR[item.kind] } as React.CSSProperties}
                >
                  {waitingLabel(item, t)}
                </span>
                <span className="flex min-w-[min(14rem,100%)] flex-1 flex-col gap-1">
                  <span className="line-clamp-2 text-[15px] leading-snug break-words text-ink">
                    {item.title}
                  </span>
                  {item.detail && (
                    <span className="line-clamp-1 text-small break-words text-muted">
                      {firstLine(item.detail, 160)}
                    </span>
                  )}
                </span>
                <span className="waiting-meta">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: projectColor(item.projectId) }}
                  />
                  <span className="truncate">{slug}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{ago(item.since, t)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {omitted > 0 && <p className="px-4 text-small text-muted">{t("waitingMore", { n: omitted })}</p>}
    </>
  );
}
