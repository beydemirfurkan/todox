"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function SearchBox({
  placeholder,
  label,
  clearLabel,
}: {
  placeholder: string;
  label: string;
  clearLabel: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement | null)?.isContentEditable;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
      // Escape gets you out without reaching for the mouse.
      if (e.key === "Escape" && el === ref.current) ref.current?.blur();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="searchbox w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <MagnifierIcon />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        name="q"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {value ? (
        <button
          type="button"
          className="clear"
          aria-label={clearLabel}
          onClick={() => {
            setValue("");
            ref.current?.focus();
          }}
        >
          <CrossIcon />
        </button>
      ) : (
        <kbd aria-hidden="true">/</kbd>
      )}
    </form>
  );
}

/* Hand-drawn to match the rest of the furniture, not a pixel-perfect glyph. */

function MagnifierIcon() {
  return (
    <svg
      className="icon"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6.8" cy="6.8" r="4.6" />
      <path d="M10.4 10.6 14 14.2" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3 11 11M11 3 3 11" />
    </svg>
  );
}
