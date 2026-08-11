"use client";

import { useRef } from "react";

export function ProjectSettingsDrawer({
  title,
  closeLabel,
  children,
  className = "",
}: {
  title: string;
  closeLabel: string;
  children: React.ReactNode;
  /** Where the trigger sits is the page's business, not this component's. */
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      {/* Not `w-full`, and not a filled button. This opens a dialog nobody
          visits this page for; at full width it outweighed every task on it. */}
      <button
        type="button"
        className={`link-more ${className}`.trim()}
        onClick={() => dialog.current?.showModal()}
      >
        {title}
      </button>
      <dialog
        ref={dialog}
        className="project-settings-drawer"
        aria-labelledby="project-settings-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="project-settings-drawer-shell">
          <header className="project-settings-drawer-head">
            <div>
              <span className="project-settings-drawer-grip" aria-hidden="true" />
              <h2 id="project-settings-title" className="display text-[18px] font-bold">
                {title}
              </h2>
            </div>
            <button
              type="button"
              className="project-settings-drawer-close"
              onClick={() => dialog.current?.close()}
              aria-label={closeLabel}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </header>
          <div className="project-settings-drawer-body">{children}</div>
        </div>
      </dialog>
    </>
  );
}
