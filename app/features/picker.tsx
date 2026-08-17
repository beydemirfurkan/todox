"use client";

import { useEffect, useId, useRef, useState } from "react";

export type PickerOption = {
  value: string;
  label: string;
  /** A dot in the app's own colour, for statuses and kinds. */
  colour?: string;
};

/**
 * A dropdown that belongs to the application.
 *
 * `appearance: none` styles the closed box and nothing else: the list a native
 * `<select>` opens is drawn by the operating system, in its font, with its
 * corners and its highlight. So every picker in the app — status, priority,
 * note kind — opened into Windows while the two menus in the navbar opened
 * into todox. This is the same trigger, panel and item as those, so there is
 * one dropdown in the product rather than two.
 *
 * It is still a form control. The value rides on a hidden input, so the server
 * action reads exactly what it read before, and choosing submits the form the
 * way the native control did with an onChange — which also retires the
 * separate "apply" button that had to exist beside it.
 *
 * With scripting off none of this renders and a real `<select>` takes over,
 * including its submit button. That path is the reason the markup looks like
 * this rather than simpler.
 */
export function Picker({
  name,
  value,
  options,
  label,
  submitOnPick = false,
  className = "",
  applyLabel,
}: {
  name: string;
  value: string;
  options: PickerOption[];
  /** Names the control for anyone who cannot see it. */
  label: string;
  /** Statuses apply immediately; a field inside a longer form does not. */
  submitOnPick?: boolean;
  className?: string;
  /** Only rendered in the no-script fallback, beside the real select. */
  applyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(value);
  const [active, setActive] = useState(() =>
    Math.max(0, options.findIndex((o) => o.value === value)),
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  /**
   * Focus never leaves the trigger, so the browser cannot announce the option
   * the arrow keys are on -- it was tracked by `data-active` alone, which is a
   * paint. `aria-activedescendant` is the half of the pattern that tells a
   * screen reader where it is, and without it arrowing through this control was
   * silent until something was picked.
   */
  const optionId = (i: number) => `${listId}-o${i}`;

  // The server re-renders this row with a new value after a submit, and the
  // local copy has to follow. Adjusted during render rather than in an effect:
  // an effect would paint the stale value first and then correct it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setChosen(value);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === chosen) ?? options[0];

  const pick = (next: string) => {
    setChosen(next);
    setOpen(false);
    triggerRef.current?.focus();
    if (submitOnPick)
      // After the state has landed on the hidden input, not before it.
      queueMicrotask(() => triggerRef.current?.form?.requestSubmit());
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        return (i + step + options.length) % options.length;
      });
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(options[active].value);
    }
  };

  return (
    <>
      <div className={`user-menu picker ${className}`.trim()} ref={rootRef} onKeyDown={onKey}>
        <input type="hidden" name={name} value={chosen} />
        <button
          ref={triggerRef}
          type="button"
          className="user-menu-trigger picker-trigger"
          // `combobox`, not the implicit `button`. It carries `aria-expanded`,
          // `aria-controls` and now `aria-activedescendant`, and a plain button
          // supports none of the three -- eslint's `role-supports-aria-props`
          // says so, and it is right: the attributes were describing a listbox
          // relationship that the element's own role did not claim to have. The
          // accessible name comes from the `sr-only` label inside.
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          // Only while open: pointing at an option in a closed list describes a
          // position the reader cannot be in.
          aria-activedescendant={open ? optionId(active) : undefined}
          onClick={() => {
            setActive(Math.max(0, options.findIndex((o) => o.value === chosen)));
            setOpen((v) => !v);
          }}
        >
          <span className="sr-only">{label}</span>
          {current.colour && <Dot colour={current.colour} />}
          <span className="truncate">{current.label}</span>
          <Chevron open={open} />
        </button>

        <div
          id={listId}
          className="user-menu-panel picker-panel"
          role="listbox"
          aria-label={label}
          data-state={open ? "open" : "closed"}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              id={optionId(i)}
              type="button"
              role="option"
              aria-selected={o.value === chosen}
              data-active={i === active ? "true" : undefined}
              className="user-menu-item picker-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.colour && <Dot colour={o.colour} />}
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <noscript>
        <select name={name} defaultValue={value} className="control-sm" aria-label={label}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {applyLabel && (
          <button type="submit" className="btn btn-quiet control-sm">
            {applyLabel}
          </button>
        )}
      </noscript>
    </>
  );
}

function Dot({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="picker-dot"
      style={{ background: colour, borderColor: "var(--edge-dark)" }}
    />
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
