import type { T } from "@/lib/i18n";

import { createTaskAction } from "../actions";
import { SubmitButton } from "../features/submit";

/**
 * Where a quick-added task goes: one fixed project (its own page), or a
 * choice among several (Today), the one touched last preselected.
 */
export type QuickAddTarget =
  | { slug: string }
  | { projects: { slug: string; name: string }[] };

/**
 * A task in one line: the title, where it goes, and whether it is important.
 * The same form on Today and on a project, so adding a task looks and works
 * the same wherever you are.
 */
export function QuickAdd({ target, t }: { target: QuickAddTarget; t: T }) {
  return (
    <form action={createTaskAction} className="quick-add">
      <span aria-hidden="true" className="quick-add-plus">
        +
      </span>
      <label className="sr-only" htmlFor="quick-add-title">
        {t("todayAddLabel")}
      </label>
      <input
        id="quick-add-title"
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
          <label className="sr-only" htmlFor="quick-add-project">
            {t("todayAddProject")}
          </label>
          <select id="quick-add-project" name="slug" className="quick-add-select">
            {target.projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="quick-add-flag">
        <input type="checkbox" name="priority" value="1" />
        {t("todayImportant")}
      </label>
      <SubmitButton pendingLabel={t("working")}>{t("todayAddSubmit")}</SubmitButton>
    </form>
  );
}
