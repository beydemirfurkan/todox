"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";

import { archiveProjectAction, moveProjectAction, pinProjectAction, updateProjectAction } from "../actions";
import { SubmitButton } from "./submit";
import { useDismiss } from "./use-dismiss";

export interface ProjectMenuLabels {
  open: string;
  details: string;
  name: string;
  summary: string;
  repo: string;
  repoPlaceholder: string;
  save: string;
  saving: string;
  team: string;
  sharing: string;
  allSettings: string;
  delete: string;
  arrange: string;
  folder: string;
  noFolder: string;
  newFolderPlaceholder: string;
  newFolderAria: string;
  move: string;
  pin: string;
  unpin: string;
  archive: string;
  unarchive: string;
  archiveHint: string;
}

export interface ProjectMenuProject {
  id: number;
  slug: string;
  name: string;
}

/** What only the owner may change. Absent for a member. */
export interface ProjectMenuDetails {
  summary: string | null;
  repoUrl: string | null;
  rootPath: string | null;
}

/** Where this person keeps the project. Everybody who can see it has one. */
export interface ProjectMenuPlacement {
  folderId: number | null;
  pinnedAt: string | null;
  archivedAt: string | null;
  folders: { id: number; name: string }[];
}

type FormAction = (fd: FormData) => Promise<void>;

/**
 * The project's "…": where it sits in your list, then -- for the owner --
 * the details edited in place and the rest of the settings one step away.
 * It used to be a link to the settings page, which took the reader off the
 * work to change a sentence of summary.
 *
 * The placement half is everybody's, because folders, pins and the archive
 * are per person: a member arranges their own list just as the owner does.
 */
export function ProjectMenu({
  project,
  details,
  placement,
  labels,
}: {
  project: ProjectMenuProject;
  details: ProjectMenuDetails | null;
  placement: ProjectMenuPlacement;
  labels: ProjectMenuLabels;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setIsOpen(false), []);
  useDismiss({ isOpen, rootRef, triggerRef, close });

  const settings = `/p/${project.slug}/settings`;
  const thenClose =
    (action: FormAction): FormAction =>
    async (fd) => {
      await action(fd);
      setIsOpen(false);
    };

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label={labels.open}
        title={labels.open}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      <div
        id={panelId}
        className="user-menu-panel project-menu-panel"
        data-state={isOpen ? "open" : "closed"}
      >
        <ArrangeSection project={project} placement={placement} labels={labels} thenClose={thenClose} />

        {details && (
          <>
            <div className="user-menu-sep" role="separator" aria-hidden="true" />
            <form action={thenClose(updateProjectAction)} className="flex flex-col gap-3 p-2">
              <p className="text-small font-medium text-faint">{labels.details}</p>
              <input type="hidden" name="id" value={project.id} />
              {/* The action writes every column it is sent, and an absent path
                  would clear it. */}
              <input type="hidden" name="root_path" value={details.rootPath ?? ""} />
              <label className="flex flex-col gap-1.5 text-small text-muted">
                {labels.name}
                <input name="name" defaultValue={project.name} required />
              </label>
              <label className="flex flex-col gap-1.5 text-small text-muted">
                {labels.summary}
                <textarea name="summary" defaultValue={details.summary ?? ""} rows={3} />
              </label>
              <label className="flex flex-col gap-1.5 text-small text-muted">
                {labels.repo}
                <input
                  name="repo_url"
                  defaultValue={details.repoUrl ?? ""}
                  placeholder={labels.repoPlaceholder}
                  className="mono text-small"
                />
              </label>
              <SubmitButton className="btn self-start" pendingLabel={labels.saving}>
                {labels.save}
              </SubmitButton>
            </form>

            <div className="user-menu-sep" role="separator" aria-hidden="true" />
            <Link href={`${settings}?tab=team`} className="user-menu-item">
              {labels.team}
            </Link>
            <Link href={`${settings}?tab=sharing`} className="user-menu-item">
              {labels.sharing}
            </Link>
            <Link href={settings} className="user-menu-item">
              {labels.allSettings}
            </Link>
            <div className="user-menu-sep" role="separator" aria-hidden="true" />
            <Link href={`${settings}?tab=danger`} className="user-menu-item user-menu-item-danger">
              {labels.delete}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Folder, pin, archive. Three small forms rather than one, so each button is
 * the whole of what it does.
 */
function ArrangeSection({
  project,
  placement,
  labels,
  thenClose,
}: {
  project: ProjectMenuProject;
  placement: ProjectMenuPlacement;
  labels: ProjectMenuLabels;
  thenClose: (action: FormAction) => FormAction;
}) {
  const folderField = useId();
  return (
    <div className="flex flex-col gap-2 p-2">
      <p className="text-small font-medium text-faint">{labels.arrange}</p>
      <form action={thenClose(moveProjectAction)} className="flex flex-col gap-2">
        <input type="hidden" name="project_id" value={project.id} />
        <label htmlFor={folderField} className="text-small text-muted">
          {labels.folder}
        </label>
        <select id={folderField} name="folder_id" defaultValue={placement.folderId ?? ""}>
          <option value="">{labels.noFolder}</option>
          {placement.folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <input
          name="new_folder"
          maxLength={60}
          autoComplete="off"
          aria-label={labels.newFolderAria}
          placeholder={labels.newFolderPlaceholder}
        />
        <SubmitButton className="btn btn-quiet self-start" pendingLabel={labels.saving}>
          {labels.move}
        </SubmitButton>
      </form>
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
        <form action={thenClose(pinProjectAction)}>
          <input type="hidden" name="project_id" value={project.id} />
          <input type="hidden" name="pinned" value={placement.pinnedAt ? "0" : "1"} />
          <SubmitButton className="link-more text-small" pendingLabel={labels.saving}>
            {placement.pinnedAt ? labels.unpin : labels.pin}
          </SubmitButton>
        </form>
        <form action={thenClose(archiveProjectAction)}>
          <input type="hidden" name="project_id" value={project.id} />
          <input type="hidden" name="archived" value={placement.archivedAt ? "0" : "1"} />
          <SubmitButton className="link-more text-small" pendingLabel={labels.saving}>
            {placement.archivedAt ? labels.unarchive : labels.archive}
          </SubmitButton>
        </form>
      </div>
      {!placement.archivedAt && <p className="text-meta text-faint">{labels.archiveHint}</p>}
    </div>
  );
}
