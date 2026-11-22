import Link from "next/link";

import { ago, type T } from "@/lib/i18n";
import type { EntryCounts } from "@/lib/repositories/entries";
import type { Task } from "@/lib/types";

import type { Status } from "@/lib/constants";
import { setStatusAction } from "../../actions";
import { Chip, Counter, StatusDot } from "../../components";
import { ClosePopoverAfterSubmit } from "../../features/close-popover-after-submit";
import { kindLabel, statusLabel } from "../../kinds";
import { BoardDnd } from "./board-dnd";

/**
 * The board: one column per open status, one card per task.
 *
 * Closed work is not a column. A fourth one spent a quarter of the board on
 * rows nobody acts on, and on the project with the most history it was sixty
 * struck-through titles beside two in progress; it is a fold under the list
 * view instead, one click away and out of the way.
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
  closedCount,
  t,
}: {
  columns: BoardColumn[];
  slug: string;
  /** Tasks already closed, for the drop zone that closes one more. */
  closedCount: number;
  t: T;
}) {
  const statusNames = Object.fromEntries(
    MENU_STATUSES.map((status) => [status, statusLabel(t, status)]),
  );
  return (
    <section aria-label={t("boardLabel")} className="min-w-0 space-y-3 lg:flex-1">
      {/* Stacked, the columns are one long page: the queue alone can be thirty
          cards, and what is in flight sits under all of them. These are the
          way past it. Gone from `md` up, where the columns are side by side. */}
      <nav aria-label={t("jumpToColumn")} className="board-jump no-scrollbar flex gap-1.5 overflow-x-auto md:hidden">
        {columns.map((column) => (
          <a key={column.status} href={`#column-${column.status}`} className="pill">
            {column.title}
            <span className="mono ml-1.5 opacity-70">{column.total}</span>
          </a>
        ))}
      </nav>
      <BoardDnd moveAction={setStatusAction} labels={{ moving: t("boardMoving"), statusNames }}>
        {/* On a phone the columns sit side by side and swipe, one per screen
            with the next one peeking in, the way a board app does it; the
            pills above jump straight to one. From `md` a three-column grid. */}
        <div className="board-swipe flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto md:grid md:grid-cols-3 md:items-start md:overflow-visible">
          {columns.map((column) => (
            <Column key={column.status} column={column} slug={slug} t={t} />
          ))}
        </div>
        <DoneZone slug={slug} closedCount={closedCount} t={t} />
      </BoardDnd>
      <p className="hidden text-meta text-faint md:block">{t("boardDragHint")}</p>
    </section>
  );
}

/**
 * Where a finished card goes. Not a fourth column -- sixty struck-through
 * titles beside two in progress was a quarter of the board spent on nothing --
 * but a strip a card can be dropped on, which also links to the closed work.
 */
function DoneZone({ slug, closedCount, t }: { slug: string; closedCount: number; t: T }) {
  return (
    <div
      data-drop-status="done"
      className="board-col mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
    >
      <StatusDot status="done" t={t} />
      <span className="text-[14px] font-semibold">{t("boardDoneZone")}</span>
      <Counter n={closedCount} label={t("tasks")} />
      <span className="hidden text-small text-muted md:inline">{t("boardDoneHint")}</span>
      <a href={`/p/${slug}#closed`} className="link-more ml-auto text-small">
        {t("tabClosed")} →
      </a>
    </div>
  );
}

function Column({ column, slug, t }: { column: BoardColumn; slug: string; t: T }) {
  const headingId = `column-${column.status}`;
  const showAllId = `show-all-${column.status}`;
  const isCutWhenStacked = column.cards.length > STACKED_CARDS;
  return (
    <section
      aria-labelledby={headingId}
      // From `md` a column is as tall as the screen and scrolls inside
      // itself, like the panel beside it: a queue of thirty used to make the
      // page thirty cards long, with two empty columns running down beside it.
      data-drop-status={column.status}
      className="board-col relative flex w-[86%] min-w-0 shrink-0 snap-start scroll-mt-20 flex-col self-start p-2 md:sticky md:top-4 md:w-auto md:max-h-[calc(100vh-2rem)]"
    >
      {/* Tall enough for the "+", which is absolutely placed over its right
          edge and would otherwise hang into the first card. */}
      <header
        className={`flex min-h-[36px] flex-wrap items-center gap-2 px-1 pb-2 ${column.action ? "pr-11" : ""}`}
      >
        <StatusDot status={column.status} t={t} />
        <h2 id={headingId} className="min-w-0 text-[14px] font-semibold">
          {column.title}
        </h2>
        <Counter n={column.total} label={t("tasks")} />
      </header>
      {column.action}

      {column.cards.length === 0 ? (
        <p className="rounded-[14px] border border-dashed border-line px-3 py-6 text-center text-small text-muted">
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
            <Card key={card.task.id} card={card} slug={slug} t={t} />
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

function Card({ card, slug, t }: { card: BoardCard; slug: string; t: T }) {
  const { task, counts, handoffHead, quietDays } = card;
  return (
    <li className="relative" draggable data-drag-id={task.id}>
      <Link
        href={`/p/${slug}/t/${task.id}`}
        className="board-card paper flex flex-col gap-1.5 p-3.5"
      >
        <span className="mono pr-8 text-meta text-faint">#{task.id}</span>
        <span className="line-clamp-2 text-[14px] leading-snug font-medium break-words">
          {task.title}
        </span>
        {handoffHead && (
          // The rule down the side is the handoff colour; the label is for
          // anyone who cannot see it, because colour never says it alone.
          <span
            className="line-clamp-2 rounded-[8px] border-l-[3px] bg-inset py-1 pr-2 pl-2 text-small break-words text-muted"
            style={{ borderColor: "var(--k-handoff)" }}
          >
            <span className="sr-only">{kindLabel(t, "handoff")}: </span>
            {handoffHead}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <CardChips task={task} counts={counts} quietDays={quietDays} t={t} />
          <span className="mono ml-auto text-meta text-faint">{ago(task.updated_at, t)}</span>
        </span>
      </Link>
      <StatusMenu taskId={task.id} current={task.status} t={t} />
    </li>
  );
}

const MENU_STATUSES: Status[] = ["todo", "doing", "blocked", "done", "dropped"];

/**
 * Every card's way to another column without a mouse: a native popover of
 * plain forms, so it works on a phone, from the keyboard and before any
 * script has loaded. Outside the card's link, because a form cannot sit
 * inside an anchor.
 *
 * A popover and not a `<details>`: it opens in the top layer, so on a phone it
 * can be a sheet over the whole screen -- inside a details element Chrome
 * gave the panel its own containing block and it opened as a strip the width
 * of the card, under the tab bar. Esc and a tap outside close it for free.
 */
function StatusMenu({ taskId, current, t }: { taskId: number; current: Status; t: T }) {
  const id = `status-menu-${taskId}`;
  return (
    <div className="absolute top-2 right-2">
      <button
        type="button"
        popoverTarget={id}
        aria-label={t("boardMoveMenu", { id: taskId })}
        title={t("boardMoveMenu", { id: taskId })}
        className="status-menu-trigger flex size-8 items-center justify-center rounded-full text-muted hover:bg-[var(--wash-strong)] hover:text-ink"
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      <div id={id} popover="auto" className="status-menu-panel" aria-label={t("boardMoveTo")}>
        <p className="px-2.5 pt-1 pb-1.5 text-meta text-faint">{t("boardMoveTo")}</p>
        {MENU_STATUSES.filter((status) => status !== current).map((status) => (
          <form key={status} action={setStatusAction}>
            <input type="hidden" name="task_id" value={taskId} />
            <button
              name="status"
              value={status}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[14px] hover:bg-[var(--wash-strong)]"
            >
              <StatusDot status={status} t={t} />
              <span aria-hidden="true">{statusLabel(t, status)}</span>
            </button>
            <ClosePopoverAfterSubmit />
          </form>
        ))}
      </div>
    </div>
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
    // The same word the lists use; "p1" was the one place it was a code.
    chips.push(
      <span key="p1" className="important-badge">
        {t("todayImportant")}
      </span>,
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
    <>
      {chips}
      {history.length > 0 && <span className="text-meta text-faint">{history.join(" · ")}</span>}
    </>
  );
}
