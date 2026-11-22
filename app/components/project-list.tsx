import Link from "next/link";

import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import type { ProjectWithActivity } from "@/lib/services/project-activity";
import { firstLine } from "@/lib/util/headline";
import { slugify } from "@/lib/util/paths";
import { kindLabel } from "../kinds";
import { SubmitButton } from "../features/submit";
import { Chip } from "./chip";
import { Field } from "./field";

/**
 * A quiet project on the dashboard, and the form that makes one.
 *
 * A project with work in flight is a lane (`./project-lanes`): its name, where
 * the last session left off, and the top of each open status. A quiet project
 * is a row: the name and the counts, one line, because there is nothing
 * happening in it to read about and a lane that says so is a lane's worth of
 * page saying nothing. The partition is `groupProjects`; this file only draws.
 *
 * Both sit inside a `Group`, which is the sticker, so neither is one: a
 * sticker inside a sticker is two outlines and an offset shadow that shows
 * against the card it sits on, and the first cut of this page had exactly
 * that -- tilted, shadowed cards nested in a shadowed group -- and read as
 * dense. Inside a group everything is a `.sticker-flat` well, the way task
 * and note rows are on the project page.
 */

export type ProjectCountRow = {
  todo: number;
  doing: number;
  blocked: number;
  done: number;
};

/** The slug is the URL and usually the name in lower case; it earns a place only when it is not. */
export const slugDiffers = (project: { name: string; slug: string }) => slugify(project.name) !== project.slug;

type ProjectProps = {
  project: ProjectWithActivity;
  counts: ProjectCountRow;
  /** People on it besides the owner; 0 for a project nobody else can see. */
  teamSize: number;
  t: T;
};

type ProjectRowProps = ProjectProps & {
  /**
   * The newest open handoff, if any. A quiet row said only a name and counts,
   * so a project paused mid-task read the same as one never started
   * (dogfood 2026-11-22, B14).
   */
  leftOff?: string | null;
};

/** The chip that says a project is not only yours, whichever side of it you are on. */
export function ShareChip({ project, teamSize, t }: Omit<ProjectProps, "counts">) {
  if (project.access_role === "member" && project.owner_name)
    return <Chip color="var(--k-handoff)">{t("sharedBy", { name: project.owner_name })}</Chip>;
  if (teamSize > 0)
    return <Chip color="var(--k-handoff)">{t("memberCount", { n: teamSize + 1 })}</Chip>;
  return null;
}

export function ProjectRow({ project, counts, teamSize, leftOff, t }: ProjectRowProps) {
  return (
    <li className="sticker-flat">
      <Link
        href={`/p/${project.slug}`}
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1 p-3 hover:text-ink"
        title={project.root_path ?? undefined}
      >
        <span className="display min-w-0 flex-1 basis-48 truncate text-[15px] font-bold">
          {project.name}
        </span>
        <ShareChip project={project} teamSize={teamSize} t={t} />
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          {counts.todo > 0 && (
            <Chip>
              {counts.todo} {t("countQueued")}
            </Chip>
          )}
          {counts.done > 0 && (
            <Chip color="var(--ok)">
              {counts.done} {t("countDone")}
            </Chip>
          )}
          <span className="mono text-meta text-faint">{ago(project.activity_at, t)}</span>
        </span>
        {leftOff && (
          <span className="w-full min-w-0 basis-full truncate text-small text-muted">
            <span className="sr-only">{kindLabel(t, "handoff")}: </span>
            {firstLine(leftOff, 160)}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * The fields that make a project, shared by the "+" on the quiet group and
 * the card a brand-new account sees -- one of them opens as a popover, the
 * other is open already, and the form is the same either way.
 */
export function ProjectFields({ t, autoFocus = false }: { t: T; autoFocus?: boolean }) {
  return (
    <>
      <Field label={t("projectNamePh")}>
        <input name="name" autoFocus={autoFocus} required />
      </Field>
      <Field label={t("projectPathLabel")}>
        <input name="root_path" placeholder={t("projectPathPh")} className="mono text-small" />
      </Field>
      <Field label={t("projectSummaryPh")}>
        <textarea name="summary" />
      </Field>
      <SubmitButton pendingLabel={t("working")}>{t("create")}</SubmitButton>
    </>
  );
}
