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
    <section aria-label={t("boardLabel")} className="grid min-w-0 gap-3 md:grid-cols-3 lg:flex-1">
      {columns.map((column) => (
        <Column key={column.status} column={column} slug={slug} selectedId={selectedId} t={t} />
      ))}
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
  return (
    <section
      aria-labelledby={headingId}
      className="relative min-w-0 rounded-[12px] border-[1.5px] border-rule bg-inset p-2.5"
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
        <ul className="space-y-2">
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
        className="flex flex-col gap-1.5 rounded-[10px] border-[1.5px] border-line bg-card p-3 hover:border-lineStrong aria-[current]:border-accent"
      >
        <span className="mono flex items-baseline gap-2 text-meta text-faint">
          <span>#{task.id}</span>
          <span className="ml-auto">{ago(task.updated_at, t)}</span>
        </span>
        <span className="line-clamp-3 text-[14.5px] leading-snug font-medium break-words">
          {task.title}
        </span>
        {handoffHead && (
          // The rule down the side is the handoff colour; the label is for
          // anyone who cannot see it, because colour never says it alone.
          <span
            className="line-clamp-2 border-l-2 pl-2 text-small break-words text-muted"
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
  if (counts && counts.dead_ends > 0) {
    chips.push(
      <Chip key="dead-ends" color="var(--k-dead_end)">
        {counts.dead_ends} {counts.dead_ends > 1 ? t("deadEndCountPlural") : t("deadEndCount")}
      </Chip>,
    );
  }
  if (counts && counts.decisions > 0) {
    chips.push(
      <Chip key="decisions" color="var(--k-decision)">
        {counts.decisions} {counts.decisions > 1 ? t("decisionCountPlural") : t("decisionCount")}
      </Chip>,
    );
  }
  if (chips.length === 0) return null;
  return <span className="flex flex-wrap items-center gap-1.5">{chips}</span>;
}
