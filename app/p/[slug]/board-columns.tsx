import { ago, type T } from "@/lib/i18n";
import type { EntryCounts } from "@/lib/repositories/entries";
import type { Task } from "@/lib/types";

import { Chip, Counter, StatusDot } from "../../components";
import { PanelLink } from "../../features/panel-link";
import { kindLabel } from "../../kinds";
import { boardHref } from "./board";

/**
 * The board: one column per open status, one card per task.
 *
 * Closed work is not a column. A fourth one spent a quarter of the board on
 * rows nobody acts on, and on the project with the most history it was sixty
 * struck-through titles beside two in progress; it is a tab of the panel
 * instead, one click away and out of the way.
 *
 * A card says what the old row said -- urgency, the dead ends not to repeat,
 * the decisions behind the work -- and the one thing the row could not: where
 * the task left off. That line used to exist once per project, at the top of
 * the page, for whichever task was touched last.
 */

export type OpenStatus = "todo" | "doing" | "blocked";

/**
 * Cards a stacked column opens with. Below `md` the three columns are one
 * page, so a queue of thirty put the work in flight thirty cards down; the
 * rest are one tap away. From `md` up a column scrolls and shows them all.
 * The selector in `Column` is written out, because Tailwind reads class names
 * as text and cannot see a number interpolated into one.
 */
const STACKED_CARDS = 5;

export interface BoardCard {
  task: Task;
  counts: EntryCounts | undefined;
  /** First line of the task's newest handoff. */
  handoffHead: string | null;
  quietDays: number | null;
}

export interface BoardColumn {
  status: OpenStatus;
  title: string;
  cards: BoardCard[];
  /** Tasks in this status the column is not showing. */
  omitted: number;
  total: number;
  emptyText: string;
  /** A `Composer`, placed over the header's right edge. */
  action?: React.ReactNode;
}

export function Board({
  columns,
  slug,
  selectedId,
  t,
}: {
  columns: BoardColumn[];
  slug: string;
  /** The task the panel is showing, when it is showing one. */
  selectedId: number | null;
  t: T;
}) {
  return (
    <section aria-label={t("boardLabel")} className="min-w-0 space-y-3 lg:flex-1">
      {/* Stacked, the columns are one long page: the queue alone can be thirty
          cards, and what is in flight sits under all of them. These are the
          way past it. Gone from `md` up, where the columns are side by side. */}
      <nav aria-label={t("jumpToColumn")} className="flex flex-wrap gap-1.5 md:hidden">
        {columns.map((column) => (
          <a key={column.status} href={`#column-${column.status}`} className="pill">
            {column.title}
            <span className="mono ml-1.5 opacity-70">{column.total}</span>
          </a>
        ))}
        <a href="#panel" className="pill">
          {t("panelLabel")}
        </a>
      </nav>
      <div className="grid min-w-0 gap-3 md:grid-cols-3 md:items-start">
        {columns.map((column) => (
          <Column key={column.status} column={column} slug={slug} selectedId={selectedId} t={t} />
        ))}
      </div>
    </section>
  );
}

function Column({
  column,
  slug,
  selectedId,
  t,
}: {
  column: BoardColumn;
  slug: string;
  selectedId: number | null;
  t: T;
}) {
  const headingId = `column-${column.status}`;
  const showAllId = `show-all-${column.status}`;
  const isCutWhenStacked = column.cards.length > STACKED_CARDS;
  return (
    <section
      aria-labelledby={headingId}
      // From `md` a column is as tall as the screen and scrolls inside
      // itself, like the panel beside it: a queue of thirty used to make the
      // page thirty cards long, with two empty columns running down beside it.
      className="relative flex min-w-0 scroll-mt-4 flex-col rounded-[12px] border-[1.5px] border-rule bg-inset p-2.5 md:sticky md:top-4 md:max-h-[calc(100vh-2rem)]"
    >
      {/* Tall enough for the "+", which is absolutely placed over its right
          edge and would otherwise hang into the first card. */}
      <header
        className={`flex min-h-[42px] flex-wrap items-center gap-2 px-1 pb-2.5 ${column.action ? "pr-11" : ""}`}
      >
        <StatusDot status={column.status} t={t} />
        <h2 id={headingId} className="display min-w-0 text-[16px] font-bold">
          {column.title}
        </h2>
        <Counter n={column.total} label={t("tasks")} />
      </header>
      {column.action}

      {column.cards.length === 0 ? (
        <p className="rounded-[10px] border-[1.5px] border-dashed border-rule px-3 py-2.5 text-small text-muted">
          {column.emptyText}
        </p>
      ) : (
        <>
        {/* A checkbox and its label, so "show all" works without a script. */}
        {isCutWhenStacked && <input type="checkbox" id={showAllId} className="peer sr-only md:hidden" />}
        {/* `relative`, so the visually hidden labels inside the cards are placed
            against this list and scroll with it. Against the column they sat at
            their unscrolled offsets and made the page as long as the queue. */}
        <ul className="board-scroll relative space-y-2 max-md:[&>li:nth-child(n+6)]:hidden max-md:peer-checked:[&>li:nth-child(n+6)]:block md:-mr-1.5 md:min-h-0 md:overflow-y-auto md:pr-1.5">
          {column.cards.map((card) => (
            <Card
              key={card.task.id}
              card={card}
              slug={slug}
              isSelected={card.task.id === selectedId}
              t={t}
            />
          ))}
        </ul>
        {isCutWhenStacked && (
          // Hidden on the wrapper: `.link-more` sets its own `display` outside
          // Tailwind's layers, so `hidden` on the label itself loses to it.
          <p className="mt-2.5 px-1 peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-accent md:hidden">
            <label htmlFor={showAllId} className="link-more text-small">
              {t("showAllCards", { n: column.cards.length })}
            </label>
          </p>
        )}
        </>
      )}
      {column.omitted > 0 && (
        <p className="mt-2.5 px-1 text-small text-muted">{t("andMore", { n: column.omitted })}</p>
      )}
    </section>
  );
}

function Card({
  card,
  slug,
  isSelected,
  t,
}: {
  card: BoardCard;
  slug: string;
  isSelected: boolean;
  t: T;
}) {
  const { task, counts, handoffHead, quietDays } = card;
  return (
    <li>
      <PanelLink
        href={`/p/${slug}/t/${task.id}`}
        panelHref={boardHref(slug, { task: task.id, view: "task" })}
        isCurrent={isSelected}
        className="flex flex-col gap-1.5 rounded-[10px] border-[1.5px] border-line bg-card px-3 py-2.5 hover:border-lineStrong aria-[current]:border-accent"
      >
        <span className="mono flex items-baseline gap-2 text-meta text-faint">
          <span>#{task.id}</span>
          <span className="ml-auto">{ago(task.updated_at, t)}</span>
        </span>
        <span className="line-clamp-2 text-[14.5px] leading-snug font-medium break-words">
          {task.title}
        </span>
        {handoffHead && (
          // The rule down the side is the handoff colour; the label is for
          // anyone who cannot see it, because colour never says it alone.
          <span
            className="line-clamp-1 border-l-2 pl-2 text-small break-all text-muted"
            style={{ borderColor: "var(--k-handoff)" }}
          >
            <span className="sr-only">{kindLabel(t, "handoff")}: </span>
            {handoffHead}
          </span>
        )}
        <CardChips task={task} counts={counts} quietDays={quietDays} t={t} />
      </PanelLink>
    </li>
  );
}

function CardChips({
  task,
  counts,
  quietDays,
  t,
}: {
  task: Task;
  counts: EntryCounts | undefined;
  quietDays: number | null;
  t: T;
}) {
  const chips: React.ReactNode[] = [];
  if (task.priority === 1) {
    chips.push(
      <Chip key="p1" color="var(--accent)">
        p1
      </Chip>,
    );
  }
  if (quietDays !== null) {
    chips.push(
      <Chip key="quiet" color="var(--k-note)">
        {t("quietFor", { n: quietDays })}
      </Chip>,
    );
  }
  if (counts && counts.questions > 0) {
    chips.push(
      <Chip key="questions" color="var(--k-question)">
        {counts.questions}{" "}
        {counts.questions > 1 ? t("openQuestionCountPlural") : t("openQuestionCount")}
      </Chip>,
    );
  }
  // What needs somebody is a chip; what is only history is a line of text.
  // Five colours on every card was a board where nothing stood out, and the
  // counts of decisions and dead ends are a reason to open a task, not a
  // reason to look at it first.
  const history: string[] = [];
  if (counts && counts.dead_ends > 0) {
    history.push(
      `${counts.dead_ends} ${counts.dead_ends > 1 ? t("deadEndCountPlural") : t("deadEndCount")}`,
    );
  }
  if (counts && counts.decisions > 0) {
    history.push(
      `${counts.decisions} ${counts.decisions > 1 ? t("decisionCountPlural") : t("decisionCount")}`,
    );
  }
  if (chips.length === 0 && history.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {chips}
      {history.length > 0 && (
        <span className="mono text-meta text-faint">{history.join(" · ")}</span>
      )}
    </span>
  );
}
