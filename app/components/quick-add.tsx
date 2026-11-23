import type { T } from "@/lib/i18n";

import { createTaskAction } from "../actions";
import { ClosePopoverAfterSubmit } from "../features/close-popover-after-submit";
import { SubmitButton } from "../features/submit";

/**
 * Where a quick-added task goes: one fixed project (its own page), or a
 * choice among several (Today), the one touched last preselected.
 */
export type QuickAddTarget =
  | { slug: string }
  | { projects: QuickAddProject[] };

/** `folder` groups the picker the way the person grouped their list. */
export interface QuickAddProject {
  slug: string;
  name: string;
  folder?: string | null;
}

/**
 * A task in one line: the title, where it goes, and whether it is important.
 * The same form on Today and on a project, so adding a task looks and works
 * the same wherever you are.
 */
export function QuickAdd({ target, t, popoverId }: { target: QuickAddTarget; t: T; popoverId?: string }) {
  const fieldPrefix = popoverId ?? "quick-add";
  return (
    <form action={createTaskAction} className="quick-add">
      {!popoverId && <span aria-hidden="true" className="quick-add-plus">+</span>}
      <label className="sr-only" htmlFor={`${fieldPrefix}-title`}>
        {t("todayAddLabel")}
      </label>
      <input
        id={`${fieldPrefix}-title`}
        name="title"
        required
        autoComplete="off"
        placeholder={t("todayAddPlaceholder")}
        className="min-w-[12rem] flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint"
      />
      {"slug" in target ? (
        <input type="hidden" name="slug" value={target.slug} />
      ) : (
        <>
          <label className="sr-only" htmlFor={`${fieldPrefix}-project`}>
            {t("todayAddProject")}
          </label>
          {/* Grouped by folder, but the default stays the project touched
              last -- the first one given -- wherever its folder puts it. */}
          <select
            id={`${fieldPrefix}-project`}
            name="slug"
            className="quick-add-select"
            defaultValue={target.projects[0]?.slug}
          >
            <ProjectOptions projects={target.projects} />
          </select>
        </>
      )}
      <label className="quick-add-flag">
        <input type="checkbox" name="priority" value="1" />
        {t("todayImportant")}
      </label>
      {/* Straight to the front of the agent's queue: written with the task,
          so there is never a moment it exists and is not yet asked for. */}
      <label className="quick-add-flag" title={t("queueForAgentHint")}>
        <input type="checkbox" name="for_agent" value="1" />
        {t("quickAddForAgent")}
      </label>
      <SubmitButton pendingLabel={t("working")}>{t("todayAddSubmit")}</SubmitButton>
      {popoverId && <ClosePopoverAfterSubmit />}
    </form>
  );
}

/** Projects in no folder first, then one `<optgroup>` per folder, each in the order given. */
function ProjectOptions({ projects }: { projects: QuickAddProject[] }) {
  const option = (project: QuickAddProject) => (
    <option key={project.slug} value={project.slug}>
      {project.name}
    </option>
  );
  const folders = [...new Set(projects.flatMap((project) => (project.folder ? [project.folder] : [])))];
  return (
    <>
      {projects.filter((project) => !project.folder).map(option)}
      {folders.map((folder) => (
        <optgroup key={folder} label={folder}>
          {projects.filter((project) => project.folder === folder).map(option)}
        </optgroup>
      ))}
    </>
  );
}
