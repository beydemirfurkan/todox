"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { logoutAction } from "../auth-actions";
import { SubmitButton } from "./submit";

/**
 * The signed-in pill in the navbar. The username, the report link, and the
 * sign-out form all live behind one trigger so the row stays three controls
 * wide on a phone — the four-up version pushed the page sideways on a 320px
 * screen.
 *
 * A native <select> would have been the shortcut, but the request asked for an
 * opening animation and a glassy panel; the OS picker gives neither. This is
 * a popup so the rules are the popup rules: aria-haspopup on the trigger,
 * escape and click-outside to close, focus returns to the trigger.
 *
 * Strings are passed in already resolved: this is a Client component, and the
 * translator is a Server function. Passing `t` across the boundary is the
 * "Functions cannot be passed directly to Client Components" error.
 */
export function UserMenu({
  user,
  labels,
  className = "",
}: {
  user: { username: string; name: string };
  labels: {
    navAccount: string;
    navReport: string;
    signOut: string;
    working: string;
  };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`user-menu ${className}`.trim()} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={user.name}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">@{user.username}</span>
        <Chevron open={open} />
      </button>

      <div
        id={menuId}
        className="user-menu-panel"
        role="menu"
        data-state={open ? "open" : "closed"}
      >
        <Link
          href="/account"
          role="menuitem"
          className="user-menu-item"
          onClick={() => setOpen(false)}
        >
          {labels.navAccount}
        </Link>
        <Link
          href="/report"
          role="menuitem"
          className="user-menu-item"
          onClick={() => setOpen(false)}
        >
          {labels.navReport}
        </Link>
        <div className="user-menu-sep" role="separator" aria-hidden="true" />
        <form action={logoutAction} className="contents">
          <SubmitButton
            className="user-menu-item user-menu-item-danger user-menu-item-3"
            pendingLabel={labels.working}
          >
            {labels.signOut}
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className="chev"
      width="10"
      height="7"
      viewBox="0 0 12 8"
      fill="none"
      aria-hidden="true"
      focusable="false"
      data-open={open ? "true" : "false"}
    >
      <path
        d="M1 1.5 6 6.5 11 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
