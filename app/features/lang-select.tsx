"use client";

import { useFormStatus } from "react-dom";

import { LANGS, LANG_NAME, type Lang } from "@/lib/i18n";

/**
 * The native <select> owned by the navbar's language form.
 *
 * Split out only so it can read `useFormStatus`, which only works inside a
 * form. The form itself stays a server component and a plain `<form action>`,
 * so a no-JS submit button still works — this is the layer that ignores its
 * own onChange and uses `requestSubmit` so the server side is one path
 * regardless of whether JS is on.
 *
 * Pending state mirrors the old button: the request that picks the current
 * language flips `aria-busy`, so a second selection is dropped while the
 * page is still revalidating after the first.
 */
export function LangSelect({
  id,
  name,
  current,
  switchingLabel,
}: {
  id: string;
  name: string;
  current: Lang;
  switchingLabel: string;
}) {
  const { pending, data } = useFormStatus();
  // `data` is the FormData of the in-flight submit; matching by `name` keeps
  // the other field calm while this one is the one flying.
  const switching = pending && data?.has(name);

  return (
    <div className="lang-select" aria-busy={switching || undefined}>
      <select
        id={id}
        name={name}
        value={current}
        // requestSubmit, not submit() — the former runs the form action and
        // keeps the no-JS path the same shape, so the server side is one path.
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={pending}
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAME[l]}
          </option>
        ))}
      </select>
      <span className="sr-only" aria-live="polite">
        {switching ? switchingLabel : ""}
      </span>
      <span className="chev" aria-hidden="true">
        <svg width="10" height="7" viewBox="0 0 12 8" fill="none">
          <path
            d="M1 1.5 6 6.5 11 1.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
