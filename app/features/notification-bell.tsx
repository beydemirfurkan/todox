"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { markNotificationsReadAction } from "../actions";

export type BellItem = {
  id: number;
  text: string;
  href: string | null;
  when: string;
  unread: boolean;
};

/**
 * The header bell.
 *
 * The same popup as the account and language menus — trigger, panel, item,
 * `aria-haspopup`, escape, click-outside — because there are now three
 * dropdowns in that row and they should not be three different things. What
 * it drops is the chevron and the label: at 320px the row already holds a
 * wordmark, a search box and two menus, and the fourth control has to be a
 * square.
 *
 * The count is a number, not a coloured dot: colour never carries meaning
 * alone here, and the trigger's label says how many are unread out loud.
 *
 * Opening marks everything read. That is a write on an interaction that is not
 * a submit, which is worth being deliberate about — but a badge you cannot
 * clear stops being a notification and turns into decoration, and the rows in
 * front of you keep their own unread marking so the panel still shows which
 * ones were new.
 */
export function NotificationBell({
  items,
  unread,
  labels,
}: {
  items: BellItem[];
  unread: number;
  labels: { title: string; label: string; empty: string; markAll: string };
}) {
  const [open, setOpen] = useState(false);
  // Local, because the server's number is a snapshot from render time and the
  // badge has to drop the moment the panel opens.
  const [count, setCount] = useState(unread);
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // A later render brings a fresh count; adopt it during render rather than in
  // an effect, which would paint the stale number first and then correct it.
  const [seen, setSeen] = useState(unread);
  if (seen !== unread) {
    setSeen(unread);
    setCount(unread);
  }

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

  const clear = () => {
    if (!count) return;
    setCount(0);
    startTransition(() => {
      void markNotificationsReadAction();
    });
  };

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger bell-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={labels.label}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) clear();
        }}
      >
        <Bell />
        {count > 0 && (
          <span className="bell-count" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <div
        id={menuId}
        className="user-menu-panel bell-panel"
        role="menu"
        aria-label={labels.title}
        data-state={open ? "open" : "closed"}
      >
        {items.length === 0 && (
          <p className="bell-item bell-item-flat user-menu-item">{labels.empty}</p>
        )}

        {items.map((item) =>
          item.href ? (
            <Link
              key={item.id}
              href={item.href}
              role="menuitem"
              className="user-menu-item bell-item"
              data-unread={item.unread ? "true" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.text}
              <span className="bell-when">{item.when}</span>
            </Link>
          ) : (
            // No project to open: an invitation not yet accepted has a better
            // destination, and a membership just taken away has none at all.
            <p
              key={item.id}
              className="user-menu-item bell-item bell-item-flat"
              data-unread={item.unread ? "true" : undefined}
            >
              {item.text}
              <span className="bell-when">{item.when}</span>
            </p>
          ),
        )}

        {items.length > 0 && (
          <>
            <div className="user-menu-sep" role="separator" aria-hidden="true" />
            <button
              type="button"
              role="menuitem"
              className="user-menu-item"
              onClick={() => {
                clear();
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {labels.markAll}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Bell() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 3.2.7 5 1.8 6.2.5.5.1 1.3-.6 1.3H4.8c-.7 0-1.1-.8-.6-1.3C5.3 14 6 12.2 6 9Z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}
