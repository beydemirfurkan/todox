"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { LANGS, LANG_NAME, type Lang } from "@/lib/i18n";
import { setLangAction } from "../actions";
import { Flag } from "./flag";

/**
 * The language switcher, as a popup rather than a native select.
 *
 * It borrows the navbar menu wholesale — trigger, panel, item, the same
 * `aria-haspopup`, escape and click-outside — because there are now two
 * dropdowns in that row and they should not be two different things.
 *
 * A flag is a country, not a language, and English is not one country's. So
 * the flag never stands alone: the name sits beside it everywhere except the
 * trigger on a narrow screen, where the panel is one tap away and says both.
 */
export function LangMenu({
  lang,
  label,
  switchingLabel,
}: {
  lang: Lang;
  /** Names the control for anyone who cannot see it. */
  label: string;
  switchingLabel: string;
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
    <div className="user-menu lang-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sr-only">{label}</span>
        <Flag lang={lang} />
        <span className="lang-menu-name" aria-hidden="true">
          {LANG_NAME[lang]}
        </span>
        <Chevron open={open} />
      </button>

      <div
        id={menuId}
        className="user-menu-panel"
        role="menu"
        data-state={open ? "open" : "closed"}
      >
        {/* Still a plain form posting to a server action, so choosing a
            language is one request and needs nothing from this component
            beyond opening the panel. */}
        <form action={setLangAction} className="contents">
          {LANGS.map((l) => (
            <LangItem key={l} lang={l} active={l === lang} switchingLabel={switchingLabel} />
          ))}
        </form>
      </div>

      {/* Scripting off means no panel, so the plain choice is still rendered.
          It was a `<noscript>` submit before this and it stays one. */}
      <noscript>
        <form action={setLangAction} className="flex gap-1.5">
          {LANGS.map((l) => (
            <button key={l} name="lang" value={l} type="submit" className="pill seg">
              {LANG_NAME[l]}
            </button>
          ))}
        </form>
      </noscript>
    </div>
  );
}

/**
 * Its own component because `useFormStatus` only reports for the form it is
 * rendered inside, and `data` is what tells the two buttons apart — without it
 * both would go busy when either is pressed, which on a phone connection reads
 * as having tapped the wrong one.
 */
function LangItem({
  lang,
  active,
  switchingLabel,
}: {
  lang: Lang;
  active: boolean;
  switchingLabel: string;
}) {
  const { pending, data } = useFormStatus();
  const switching = pending && data?.get("lang") === lang;

  return (
    <button
      name="lang"
      value={lang}
      type="submit"
      role="menuitem"
      className="user-menu-item"
      // Never disabled, including the one already chosen: a dead control is
      // indistinguishable from a missed tap, and it leaves the tab order.
      aria-current={active ? "true" : undefined}
      aria-busy={switching}
    >
      <Flag lang={lang} />
      <span>{LANG_NAME[lang]}</span>
      {switching && <span className="sr-only"> — {switchingLabel}</span>}
    </button>
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
