"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";

import { logoutAction } from "../auth-actions";
import { SubmitButton } from "./submit";
import { useDismiss } from "./use-dismiss";

export interface AccountMenuLabels {
  open: string;
  account: string;
  brain: string;
  signOut: string;
  signingOut: string;
}

/**
 * The avatar at the foot of the sidebar: who is signed in, the account
 * page, and signing out. Signing out used to be a button halfway down the
 * account page, which nobody looking for it found.
 */
export function AccountMenu({
  name,
  username,
  initial,
  labels,
}: {
  name: string;
  username: string;
  initial: string;
  labels: AccountMenuLabels;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setIsOpen(false), []);
  useDismiss({ isOpen, rootRef, triggerRef, close });

  return (
    <div className="user-menu account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="sidebar-link account-menu-trigger"
        aria-label={labels.open}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <span aria-hidden="true" className="sidebar-avatar">
          {initial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">@{username}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" className="chev">
          <path d="M7 15l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id={panelId} className="user-menu-panel account-menu-panel" data-state={isOpen ? "open" : "closed"}>
        <div className="flex min-w-0 flex-col px-3 pt-1.5 pb-2">
          {name && <span className="truncate text-[14px] font-medium text-ink">{name}</span>}
          <span className="truncate text-meta text-faint">@{username}</span>
        </div>
        <div className="user-menu-sep" role="separator" aria-hidden="true" />
        <Link href="/account" className="user-menu-item" onClick={close}>
          {labels.account}
        </Link>
        <Link href="/me" className="user-menu-item" onClick={close}>
          {labels.brain}
        </Link>
        <div className="user-menu-sep" role="separator" aria-hidden="true" />
        <form action={logoutAction}>
          <SubmitButton className="user-menu-item user-menu-item-danger" pendingLabel={labels.signingOut}>
            {labels.signOut}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
