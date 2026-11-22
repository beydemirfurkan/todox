import Link from "next/link";

import type { Status } from "@/lib/constants";
import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import type { LaneTask } from "@/lib/repositories/tasks";
import type { ProjectWithActivity } from "@/lib/services/project-activity";
import { firstLine } from "@/lib/util/headline";
import { kindLabel, statusLabel } from "../kinds";
import { boardHref } from "../p/[slug]/board";
import type { WaitingItem, WaitingKind } from "../waiting";
import { Chip } from "./chip";
import { ShareChip, slugDiffers, type ProjectCountRow } from "./project-list";
import { StatusDot } from "./status";

/**
 * The dashboard's projects with work in flight, one card each.
 *
 * A card answers the two questions a person opens the dashboard with, in
 * the order they ask them: how far along is this (a bar, with its numbers
 * written out beside it, because colour never says it alone), and what is
 * happening in it right now (where the last session left off, and the
 * tasks at the front of each open status). Finished work is part of the
 * bar and a number, never a list -- it is the one status nobody acts on
 * from here.
 */

/** Where a task opens: the project's board with that task in its panel. */
const taskHref = (slug: string, taskId: number) =>
  `${boardHref(slug, { task: taskId, view: "task" })}#panel`;

const LANE_STATUSES = ["todo", "doing", "blocked"] as const satisfies readonly Status[];
type LaneStatus = (typeof LANE_STATUSES)[number];

/** Tasks a card lists; the bar and the numbers cover the rest. */
const CARD_TASKS = 4;
/** In-flight work first: that is what the card is for. */
const ORDER: Record<LaneStatus, number> = { doing: 0, blocked: 1, todo: 2 };

export interface ProjectLane {
  project: ProjectWithActivity;
  counts: ProjectCountRow;
  /** People on it besides the owner. */
  teamSize: number;
  /** The top of each open status, already cut; `counts` holds the totals. */
  tasks: LaneTask[];
  /** The body of the newest handoff on open work, or nothing to say. */
  leftOff: string | null;
}

export function ProjectLanes({
  lanes,
  titles,
  t,
}: {
  lanes: ProjectLane[];
  /** Status names, keyed by status. */
  titles: Record<LaneStatus, string>;
  t: T;
}) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {lanes.map((lane, i) => (
        <ProjectCard key={lane.project.id} lane={lane} titles={titles} delay={i * 50} t={t} />
      ))}
    </ul>
  );
}

function ProjectCard({
  lane,
  titles,
  delay,
  t,
}: {
  lane: ProjectLane;
  titles: Record<LaneStatus, string>;
  delay: number;
  t: T;
}) {
  const { project, counts, teamSize, tasks, leftOff } = lane;
  const shown = [...tasks]
    .sort((a, b) => ORDER[a.status as LaneStatus] - ORDER[b.status as LaneStatus])
    .slice(0, CARD_TASKS);
  const open = counts.todo + counts.doing + counts.blocked;
  return (
    <li className="sticker pop flex min-w-0 flex-col gap-4 p-5" style={{ animationDelay: `${delay}ms` }}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="display text-[22px] leading-tight break-words">
            <Link href={`/p/${project.slug}`} className="hover:text-accentInk max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center">
              {project.name}
            </Link>
          </h3>
          {slugDiffers(project) && <p className="mono text-meta break-all text-faint">{project.slug}</p>}
        </div>
        <ShareChip project={project} teamSize={teamSize} t={t} />
        <span className="mono w-full text-meta text-faint">
          {t("updated")} {ago(project.activity_at, t)}
        </span>
      </header>

      <Progress counts={counts} titles={titles} t={t} />

      {leftOff && (
        <p className="line-clamp-2 rounded-[10px] border-l-[3px] bg-inset px-3 py-2 text-small break-words text-muted" style={{ borderColor: "var(--k-handoff)" }}>
          <span className="sr-only">{kindLabel(t, "handoff")}: </span>
          {firstLine(leftOff, 160)}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="-mx-2 space-y-0.5">
          {shown.map((task) => (
            <li key={task.id}>
              <Link
                href={taskHref(project.slug, task.id)}
                className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[14px] hover:bg-[var(--wash)] max-sm:min-h-[44px]"
              >
                <StatusDot status={task.status} t={t} />
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {task.priority === 1 && <span className="mono shrink-0 text-meta font-medium text-accentInk">p1</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href={`/p/${project.slug}`} className="link-more mt-auto self-start text-small">
        {open > shown.length ? t("laneMore", { n: open - shown.length }) : t("openBoard")} →
      </Link>
    </li>
  );
}

/** The project's progress: one bar, and the same numbers in words under it. */
function Progress({
  counts,
  titles,
  t,
}: {
  counts: ProjectCountRow;
  titles: Record<LaneStatus, string>;
  t: T;
}) {
  const parts = [
    { status: "done" as const, n: counts.done, label: t("colDone"), fill: "var(--ok)" },
    { status: "doing" as const, n: counts.doing, label: titles.doing, fill: "var(--accent)" },
    { status: "blocked" as const, n: counts.blocked, label: titles.blocked, fill: "var(--k-dead_end)" },
    { status: "todo" as const, n: counts.todo, label: titles.todo, fill: "var(--line)" },
  ];
  const total = parts.reduce((sum, part) => sum + part.n, 0) || 1;
  return (
    <div className="space-y-2.5">
      <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-inset">
        {parts
          .filter((part) => part.n > 0)
          .map((part) => (
            <span key={part.status} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(part.n / total) * 100}%`, background: part.fill }} />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted">
        {parts.map((part) => (
          <li key={part.status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: part.fill }} />
            <span className="font-medium text-ink">{part.n}</span> {part.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

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
                href={taskHref(slug, item.taskId)}
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
