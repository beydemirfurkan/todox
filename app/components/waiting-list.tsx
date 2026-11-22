import Link from "next/link";

import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import { firstLine } from "@/lib/util/headline";
import { kindLabel, statusLabel } from "../kinds";
import type { WaitingItem, WaitingKind } from "../waiting";
import { Chip } from "./chip";

/**
 * What only a person can move, across every project: open questions, stuck
 * tasks and work left in progress with nothing written. Each card says which
 * in words, so the chip's colour never has to.
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
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const slug = slugOf.get(item.projectId);
          if (!slug) return null;
          return (
            <li key={`${item.kind}-${item.taskId}`} className="min-w-0">
              <Link
                href={`/p/${slug}/t/${item.taskId}`}
                className="sticker-flat flex h-full flex-col gap-1.5 p-3 hover:border-lineStrong"
              >
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Chip color={WAITING_COLOR[item.kind]}>{waitingLabel(item, t)}</Chip>
                  <span className="mono min-w-0 text-meta break-all text-faint">
                    {slug} · #{item.taskId}
                  </span>
                  <span className="mono ml-auto shrink-0 text-meta text-faint">
                    {ago(item.since, t)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[14.5px] leading-snug font-medium break-words">
                  {item.title}
                </span>
                {item.detail && (
                  <span className="line-clamp-2 text-small break-words text-muted">
                    {firstLine(item.detail, 160)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {omitted > 0 && <p className="mt-3 text-small text-muted">{t("waitingMore", { n: omitted })}</p>}
    </>
  );
}
