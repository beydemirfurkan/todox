"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { updateProjectAction } from "../actions";
import { SubmitButton } from "./submit";

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
}

export interface ProjectMenuProject {
  id: number;
  slug: string;
  name: string;
  summary: string | null;
  repoUrl: string | null;
  rootPath: string | null;
}

/**
 * The project's "…": the details edited in place, and the rest of the
 * settings one step away. It used to be a link to the settings page, which
 * took the reader off the work to change a sentence of summary.
 */
export function ProjectMenu({
  project,
  labels,
}: {
  project: ProjectMenuProject;
  labels: ProjectMenuLabels;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss({ isOpen, rootRef, triggerRef, close: () => setIsOpen(false) });

  const settings = `/p/${project.slug}/settings`;
  const saveDetails = async (fd: FormData) => {
    await updateProjectAction(fd);
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
        <form action={saveDetails} className="flex flex-col gap-3 p-2">
          <p className="text-meta font-semibold tracking-[0.04em] text-faint uppercase">
            {labels.details}
          </p>
          <input type="hidden" name="id" value={project.id} />
          {/* The action writes every column it is sent, and an absent path
              would clear it. */}
          <input type="hidden" name="root_path" value={project.rootPath ?? ""} />
          <label className="flex flex-col gap-1.5 text-small text-muted">
            {labels.name}
            <input name="name" defaultValue={project.name} required />
          </label>
          <label className="flex flex-col gap-1.5 text-small text-muted">
            {labels.summary}
            <textarea name="summary" defaultValue={project.summary ?? ""} rows={3} />
          </label>
          <label className="flex flex-col gap-1.5 text-small text-muted">
            {labels.repo}
            <input
              name="repo_url"
              defaultValue={project.repoUrl ?? ""}
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
      </div>
    </div>
  );
}

/** Escape and a press outside both close it; Escape returns focus to the trigger. */
function useDismiss(input: {
  isOpen: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
}): void {
  const { isOpen, rootRef, triggerRef, close } = input;
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: MouseEvent) => {
      // On a phone the root's own box is the dim behind the sheet, so a press
      // on the root itself is a press outside the menu.
      const root = rootRef.current;
      if (event.target === root || !root?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen, rootRef, triggerRef, close]);
}
