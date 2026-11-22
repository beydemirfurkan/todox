"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { LANGS, LANG_NAME, type Lang } from "@/lib/i18n";
import { setLangAction } from "../actions";
import { useDismiss } from "./use-dismiss";

/**
 * The language switcher: a quiet button with a globe and the language's code,
 * opening the same panel as every other menu in the app.
 *
 * It used to be a bordered pill with a flag in it. A flag is a country, not a
 * language, and English is not one country's; the pill was also the only
 * control in the header drawn that way. The code is short enough for a phone,
 * and the panel names each language in full.
 *
 * Choosing is still a plain form post, with a `<noscript>` path.
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
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setIsOpen(false), []);
  useDismiss({ isOpen, rootRef, triggerRef, close });

  return (
    <div className="user-menu lang-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lang-menu-trigger"
        aria-label={`${label}: ${LANG_NAME[lang]}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((value) => !value)}
      >
        <GlobeIcon />
        <span aria-hidden="true">{lang.toUpperCase()}</span>
      </button>

      <div id={menuId} className="user-menu-panel lang-menu-panel" role="menu" data-state={isOpen ? "open" : "closed"}>
        <form action={setLangAction} className="contents">
          {LANGS.map((l) => (
            <LangItem key={l} lang={l} isActive={l === lang} switchingLabel={switchingLabel} />
          ))}
        </form>
      </div>

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
 * Its own component because `useFormStatus` reports for the form it sits in,
 * and `data` is what tells the two items apart while one is switching.
 */
function LangItem({
  lang,
  isActive,
  switchingLabel,
}: {
  lang: Lang;
  isActive: boolean;
  switchingLabel: string;
}) {
  const { pending, data } = useFormStatus();
  const isSwitching = pending && data?.get("lang") === lang;

  return (
    <button
      name="lang"
      value={lang}
      type="submit"
      role="menuitemradio"
      aria-checked={isActive}
      lang={lang}
      className="user-menu-item lang-menu-item"
      aria-busy={isSwitching}
    >
      <span className="flex-1">{LANG_NAME[lang]}</span>
      {isActive && <CheckIcon />}
      {isSwitching && <span className="sr-only"> — {switchingLabel}</span>}
    </button>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
