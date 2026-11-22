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
 * The dashboard as a board: a lane per project that has work in flight, a cell
 * per open status, a few titles in each.
 *
 * These projects used to be cards that said "2 in flight, 1 stuck, 5 queued".
 * A count answers "how much"; it does not answer "what", and finding out meant
 * opening each project in turn. A lane prints the top of every status, so the
 * question a person opens the dashboard with -- what is going on, everywhere --
 * is answered by the page they are already on.
 *
 * Finished work is a number, not a cell of cards: it is the one status nobody
 * acts on from here, and sixty struck-through titles per lane is the wall this
 * page was folded to remove.
 */

/** Where a task opens: the project's board with that task in its panel. */
const taskHref = (slug: string, taskId: number) =>
  `${boardHref(slug, { task: taskId, view: "task" })}#panel`;

/**
 * Three shapes. Stacked on a phone. From `md` the three statuses sit side by
 * side under the project's own line, because at tablet width a fourth and
 * fifth column left each status a hundred and twenty pixels and every title
 * became three words a line. From `xl` everything is one row, under headings
 * drawn once.
 */
const LANE_ROW = "xl:grid-cols-[11rem_repeat(3,minmax(0,1fr))_4.5rem] xl:gap-x-3";
const LANE_GRID = `md:grid md:grid-cols-3 md:gap-x-3 md:gap-y-3 ${LANE_ROW}`;
/** The project's line and the done count: full width until the single row. */
const LANE_WIDE_CELL = "md:col-span-3 xl:col-span-1";

const LANE_STATUSES = ["todo", "doing", "blocked"] as const satisfies readonly Status[];
type LaneStatus = (typeof LANE_STATUSES)[number];

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
  /** Column headings, keyed by status. */
  titles: Record<LaneStatus, string>;
  t: T;
}) {
  return (
    <div className="space-y-2">
      {/* Headings for the columns, drawn once. Hidden from assistive tech and
          below `xl`: every cell names its own status, which is what is read
          out and what a narrower screen shows above each cell. */}
      <div aria-hidden="true" className={`hidden px-3 xl:grid ${LANE_ROW}`}>
        <span className="text-meta font-semibold tracking-wide text-muted uppercase">
          {t("colProject")}
        </span>
        {LANE_STATUSES.map((status) => (
          <span key={status} className="display flex items-center gap-2 text-[15px] font-bold">
            <StatusDot status={status} t={t} />
            {titles[status]}
          </span>
        ))}
        <span className="display flex items-center gap-2 text-[15px] font-bold">
          <StatusDot status="done" t={t} />
          {t("colDone")}
        </span>
      </div>

      <ul className="space-y-2">
        {lanes.map((lane) => (
          <Lane key={lane.project.id} lane={lane} titles={titles} t={t} />
        ))}
      </ul>
    </div>
  );
}

function Lane({
  lane,
  titles,
  t,
}: {
  lane: ProjectLane;
  titles: Record<LaneStatus, string>;
  t: T;
}) {
  const { project, counts, teamSize, tasks, leftOff } = lane;
  const projectHref = `/p/${project.slug}`;
  return (
    <li className={`sticker-flat space-y-3 p-3 md:space-y-0 ${LANE_GRID}`}>
      <div className={`min-w-0 space-y-1.5 ${LANE_WIDE_CELL}`}>
        <h3 className="display text-[18px] leading-tight font-bold break-words">
          <Link href={projectHref} className="inline-flex items-center hover:text-accentInk max-sm:min-h-[44px]">
            {project.name}
          </Link>
        </h3>
        {slugDiffers(project) && (
          <p className="mono text-meta break-all text-faint">{project.slug}</p>
        )}
        <ShareChip project={project} teamSize={teamSize} t={t} />
        {leftOff && (
          <p
            className="line-clamp-2 border-l-2 pl-2 text-small break-words text-muted"
            style={{ borderColor: "var(--k-handoff)" }}
          >
            <span className="sr-only">{kindLabel(t, "handoff")}: </span>
            {firstLine(leftOff, 140)}
          </p>
        )}
        <p className="mono text-meta text-faint">
          {t("updated")} {ago(project.activity_at, t)}
        </p>
      </div>

      {LANE_STATUSES.map((status) => (
        <LaneCell
          key={status}
          title={titles[status]}
          total={counts[status]}
          tasks={tasks.filter((task) => task.status === status)}
          slug={project.slug}
          t={t}
        />
      ))}

      <p className={`min-w-0 xl:pt-0.5 ${LANE_WIDE_CELL}`}>
        <Link
          href={boardHref(project.slug, { task: null, view: "closed" })}
          className="inline-flex items-baseline gap-1 hover:text-accentInk max-sm:min-h-[44px] max-sm:items-center"
        >
          <span className="mono text-[17px]">{counts.done}</span>{" "}
          <span className="text-meta text-muted">{t("countDone")}</span>
        </Link>
      </p>
    </li>
  );
}

function LaneCell({
  title,
  total,
  tasks,
  slug,
  t,
}: {
  title: string;
  /** Every task of this status in the project, shown or not. */
  total: number;
  tasks: LaneTask[];
  slug: string;
  t: T;
}) {
  const omitted = total - tasks.length;
  return (
    // An empty cell holds its place in the grid, and is nothing at all where
    // the lane is stacked: "Blocked · 0" and a dash, per project, was a third
    // of a phone's screen spent saying nothing is wrong.
    <div className={`min-w-0 space-y-1.5 ${total === 0 ? "max-md:hidden" : ""}`}>
      {/* The cell's own name: visible where lanes stack, read out everywhere. */}
      <p className="text-meta font-semibold text-muted xl:sr-only">
        {title} · {total}
      </p>
      {tasks.length === 0 ? (
        <p className="text-meta text-faint">
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t("columnEmpty")}</span>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={taskHref(slug, task.id)}
                className="flex items-baseline gap-2 rounded-[9px] border-[1.5px] border-line bg-card px-2.5 py-2 text-small hover:border-lineStrong max-sm:min-h-[44px] max-sm:items-center"
              >
                <span className="mono shrink-0 text-meta text-faint">#{task.id}</span>
                <span className="line-clamp-2 min-w-0 flex-1 break-words">{task.title}</span>
                {/* Text, not a filled chip: most open work is p1, and a
                    yellow block on every row of every lane marked nothing. */}
                {task.priority === 1 && (
                  <span className="mono shrink-0 text-meta font-medium text-accentInk">p1</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {omitted > 0 && (
        <Link href={`/p/${slug}`} className="link-more text-meta">
          {t("laneMore", { n: omitted })}
        </Link>
      )}
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
