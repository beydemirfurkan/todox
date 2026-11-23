import Link from "next/link";

import type { T } from "@/lib/i18n";

import { accountProjects } from "../account-projects";
import {
  archiveProjectAction,
  createFolderAction,
  deleteFolderAction,
  moveFolderAction,
  moveProjectInFolderAction,
  renameFolderAction,
} from "../actions";
import { Empty, Panel } from "../components";
import { SubmitButton } from "../features/submit";

/** Matches `FOLDER_NAME_MAX`, so the browser stops a name the server would refuse. */
const NAME_MAX = 60;

/**
 * The account's "projects" tab: the folders themselves, and the archive.
 *
 * Moving a project happens from its own menu, where you already are when you
 * decide it belongs somewhere. This is for what has no project to stand on:
 * naming a folder, renaming one, deleting one, and finding what you archived.
 */
export async function ProjectArrangement({ userId, t }: { userId: number; t: T }) {
  const { arranged } = await accountProjects(userId);
  const countLabel = (n: number) => (n === 1 ? t("folderProjectCountOne") : t("folderProjectCount", { n }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel delay={40} title={t("foldersTitle")}>
        <p className="mb-4 text-small text-muted">{t("foldersIntro")}</p>
        <form action={createFolderAction} className="mb-5 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5 text-small text-muted">
            {t("newFolderLabel")}
            <input name="name" required maxLength={NAME_MAX} autoComplete="off" />
          </label>
          <SubmitButton className="btn" pendingLabel={t("working")}>
            {t("createFolder")}
          </SubmitButton>
        </form>

        {arranged.folders.length === 0 ? (
          <Empty>{t("foldersEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {arranged.folders.map((folder, index) => (
              <li key={folder.id} className="sticker-flat flex flex-col gap-2 p-3">
                <form action={renameFolderAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="folder_id" value={folder.id} />
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5 text-small text-muted">
                    {t("folderNameLabel")}
                    <input name="name" required maxLength={NAME_MAX} defaultValue={folder.name} autoComplete="off" />
                  </label>
                  <SubmitButton className="btn btn-quiet" pendingLabel={t("saving")}>
                    {t("save")}
                    <span className="sr-only"> — {folder.name}</span>
                  </SubmitButton>
                </form>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="mono text-meta text-faint">{countLabel(folder.projects.length)}</span>
                  {/* The sidebar drags; this is the same move for a keyboard,
                      a phone, or a page with no script. */}
                  {index > 0 && (
                    <StepForm
                      action={moveFolderAction}
                      field="folder_id"
                      id={folder.id}
                      step="up"
                      label={t("folderMoveUp", { name: folder.name })}
                    />
                  )}
                  {index < arranged.folders.length - 1 && (
                    <StepForm
                      action={moveFolderAction}
                      field="folder_id"
                      id={folder.id}
                      step="down"
                      label={t("folderMoveDown", { name: folder.name })}
                    />
                  )}
                  <form action={deleteFolderAction} className="ml-auto">
                    <input type="hidden" name="folder_id" value={folder.id} />
                    <SubmitButton className="link-more text-small" pendingLabel={t("working")}>
                      {t("deleteFolder")}
                      <span className="sr-only"> — {folder.name}</span>
                    </SubmitButton>
                  </form>
                </div>
                {folder.projects.length > 1 && (
                  <ol className="flex flex-col gap-1 border-t border-line pt-2">
                    {folder.projects.map((project, place) => (
                      <li key={project.id} className="flex items-center gap-1">
                        <span className="min-w-0 flex-1 truncate text-small text-muted">{project.name}</span>
                        {place > 0 && (
                          <StepForm
                            action={moveProjectInFolderAction}
                            field="project_id"
                            id={project.id}
                            step="up"
                            label={t("projectMoveUp", { name: project.name })}
                          />
                        )}
                        {place < folder.projects.length - 1 && (
                          <StepForm
                            action={moveProjectInFolderAction}
                            field="project_id"
                            id={project.id}
                            step="down"
                            label={t("projectMoveDown", { name: project.name })}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
        {arranged.folders.length > 0 && <p className="mt-3 text-meta text-faint">{t("deleteFolderHint")}</p>}
      </Panel>

      <Panel delay={80} title={t("archivedTitle")}>
        {arranged.archived.length === 0 ? (
          <Empty>{t("archivedEmpty")}</Empty>
        ) : (
          <ul className="space-y-2">
            {arranged.archived.map((project) => (
              <li key={project.id} className="sticker-flat flex flex-wrap items-center gap-3 p-3">
                <Link href={`/p/${project.slug}`} className="min-w-[10rem] flex-1 truncate text-body text-ink">
                  {project.name}
                </Link>
                <form action={archiveProjectAction}>
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="archived" value="0" />
                  <SubmitButton className="btn btn-quiet" pendingLabel={t("working")}>
                    {t("unarchiveProject")}
                    <span className="sr-only"> — {project.name}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** One place up or down, as a plain form: a folder among folders, or a project inside its folder. */
function StepForm({
  action,
  field,
  id,
  step,
  label,
}: {
  action: (fd: FormData) => Promise<void>;
  field: "folder_id" | "project_id";
  id: number;
  step: "up" | "down";
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name={field} value={id} />
      <input type="hidden" name="step" value={step} />
      <button type="submit" className="icon-button" aria-label={label} title={label}>
        <span aria-hidden="true">{step === "up" ? "↑" : "↓"}</span>
      </button>
    </form>
  );
}
