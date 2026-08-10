"use client";

import { useFormStatus } from "react-dom";

import type { Lang } from "@/lib/i18n";

/**
 * One language pill.
 *
 * Split out of the switcher purely so it can read `useFormStatus`, which only
 * works inside the form it belongs to. The form itself stays a server
 * component and a plain `<form action>`, so this still works with JavaScript
 * off — the pending state is the only thing that needs the client.
 *
 * `data` tells us which button was pressed, so the other one does not also go
 * busy on a switch. On a phone connection the round trip is long enough that
 * without this the tap looks ignored.
 */
export function LangButton({
  lang,
  active,
  name,
  switchingLabel,
}: {
  lang: Lang;
  active: boolean;
  /** The language's own name, for anyone who cannot see which pill is filled. */
  name: string;
  switchingLabel: string;
}) {
  const { pending, data } = useFormStatus();
  const switching = pending && data?.get("lang") === lang;

  return (
    <button
      name="lang"
      value={lang}
      type="submit"
      aria-current={active ? "true" : undefined}
      aria-busy={switching}
      // Two letters are not a target. The height comes from `.pill` on mobile;
      // this is the other half of the 44px.
      className="pill min-w-11 !px-2.5 !text-[12px]"
      style={{
        opacity: switching ? 0.6 : 1,
        ...(active
          ? { background: "var(--accent)", color: "var(--on-fill)" }
          : { background: "var(--inset)", color: "var(--muted)" }),
      }}
    >
      <span className="sr-only">
        {name}
        {switching ? ` — ${switchingLabel}` : ""}
      </span>
      <span aria-hidden="true">{lang.toUpperCase()}</span>
    </button>
  );
}
