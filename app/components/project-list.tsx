import Link from "next/link";

import type { T } from "@/lib/i18n";
import { ago } from "@/lib/i18n";
import type { ProjectWithActivity } from "@/lib/services/project-activity";
import { firstLine } from "@/lib/util/headline";
import { slugify } from "@/lib/util/paths";
import { SubmitButton } from "../features/submit";
import { Chip } from "./chip";
import { Field } from "./field";

/**
 * The two shapes a project takes on the dashboard.
 *
 * A project with work in flight is a card: its name, where the last session
 * left off, and the counts. A quiet project is a row: the name and the
 * counts, one line, because there is nothing happening in it to read about
 * and a card that says so is a card's worth of page saying nothing. The
 * partition is `groupProjects`; this file only draws.
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
const slugDiffers = (project: { name: string; slug: string }) => slugify(project.name) !== project.slug;

type ProjectProps = {
  project: ProjectWithActivity;
  counts: ProjectCountRow;
  /** People on it besides the owner; 0 for a project nobody else can see. */
  teamSize: number;
  t: T;
};

/** The chip that says a project is not only yours, whichever side of it you are on. */
function ShareChip({ project, teamSize, t }: Omit<ProjectProps, "counts">) {
  if (project.access_role === "member" && project.owner_name)
    return <Chip color="var(--k-handoff)">{t("sharedBy", { name: project.owner_name })}</Chip>;
  if (teamSize > 0)
    return <Chip color="var(--k-handoff)">{t("memberCount", { n: teamSize + 1 })}</Chip>;
  return null;
}

export function ProjectCard({
  project,
  counts,
  teamSize,
  leftOff,
  t,
}: ProjectProps & {
  /** The body of the newest handoff on open work, or nothing to say. */
  leftOff: string | null;
}) {
  return (
    <Link
      href={`/p/${project.slug}`}
      className="sticker-flat block p-4 transition-colors hover:border-lineStrong"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="display text-[19px] font-bold">{project.name}</h3>
        {slugDiffers(project) && (
          <span className="mono text-meta text-faint">{project.slug}</span>
        )}
        <ShareChip project={project} teamSize={teamSize} t={t} />
      </div>
      {/* One sentence, not two. Where it left off is what a card is for --
          the line that is true today and different tomorrow -- so when
          there is a handoff the summary yields to it; the summary is a
          click away on the project page. Absent rather than empty when
          there is neither: a line that always says nothing happened is
          the always-true sentence this page removed once. */}
      {leftOff ? (
        <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-muted">
          <span className="mono text-meta text-faint">{t("lastLeftOff")} </span>
          {firstLine(leftOff, 140)}
        </p>
      ) : (
        project.summary && (
          <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-muted">
            {project.summary}
          </p>
        )
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {counts.doing > 0 && (
          <Chip color="var(--accent)" tilt={-2}>
            {counts.doing} {t("countInFlight")}
          </Chip>
        )}
        {counts.blocked > 0 && (
          <Chip color="var(--k-dead_end)" tilt={2}>
            {counts.blocked} {t("countStuck")}
          </Chip>
        )}
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
      </div>
      <p className="mono mt-3 flex flex-wrap gap-x-3 text-meta text-faint">
        <span className="shrink-0">
          {t("updated")} {ago(project.activity_at, t)}
        </span>
        {project.root_path && (
          <span className="min-w-0 truncate" title={project.root_path}>
            {project.root_path}
          </span>
        )}
      </p>
    </Link>
  );
}

export function ProjectRow({ project, counts, teamSize, t }: ProjectProps) {
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
