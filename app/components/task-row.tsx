import Link from "next/link";

import type { T } from "@/lib/i18n";
import type { Status } from "@/lib/constants";

import { statusLabel } from "../kinds";
import { projectColor } from "./project-color";

/**
 * The round mark a task row starts with. Its look follows the status, and
 * the status is always also said in words (hidden visually, read aloud), so
 * the ring is never the only thing carrying it.
 */
export function StatusRing({ status, t }: { status: Status; t: T }) {
  return (
    <span className="status-ring" data-status={status}>
      <span className="sr-only">{statusLabel(t, status)}</span>
    </span>
  );
}

export interface TaskRowProject {
  id: number;
  slug: string;
  name: string;
}

/**
 * One task as a calm list row: the ring, the title, an optional second line
 * (the agent's last word on it), and the project it belongs to when the list
 * spans projects.
 */
export function TaskRow({
  task,
  project,
  note,
  isImportant = false,
  showProject = true,
  t,
}: {
  task: { id: number; title: string; status: Status };
  project: TaskRowProject;
  note?: string | null;
  isImportant?: boolean;
  showProject?: boolean;
  t: T;
}) {
  return (
    <li>
      <Link href={`/p/${project.slug}/t/${task.id}`} className="task-row">
        <StatusRing status={task.status} t={t} />
        <span className="flex min-w-[min(15rem,100%)] flex-1 flex-col gap-1">
          <span className="text-[16px] leading-snug text-ink">{task.title}</span>
          {note && <span className="text-small leading-snug text-muted">{note}</span>}
        </span>
        <span className="flex w-full flex-wrap items-center gap-2 pl-[34px] sm:w-auto sm:shrink-0 sm:justify-end sm:pt-0.5 sm:pl-0">
          {isImportant && <span className="important-badge">{t("todayImportant")}</span>}
          {showProject && (
            <span className="flex items-center gap-1.5 text-meta text-muted">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ background: projectColor(project.id) }}
              />
              {project.name}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
