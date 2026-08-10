"use client";

import { useActionState } from "react";

import { createTokenAction } from "../auth-actions";
import { Field } from "../components";
import { CopyMarkdown } from "./copy-markdown";

/**
 * The token comes back in the action's reply and lives only in this component's
 * state. Reloading the page loses it, which is the guarantee we want: it is
 * never written to the URL, to history, or to storage.
 *
 * Labels arrive pre-translated -- `t` is a server-side closure and cannot cross
 * into a client component.
 */
export function TokenForm({
  nameLabel,
  submitLabel,
  pendingLabel,
  onceLabel,
  copyLabel,
  copiedLabel,
}: {
  nameLabel: string;
  submitLabel: string;
  pendingLabel: string;
  onceLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [state, formAction, pending] = useActionState(createTokenAction, null);

  return (
    <>
      {state && (
        // The redirect used to announce itself as a page change; without it a
        // live region is the only thing a screen reader has to go on.
        <div
          role="status"
          aria-live="polite"
          className="sticker-flat mt-4 space-y-2 p-3"
          style={{ borderColor: "var(--accent)" }}
        >
          <p className="display text-[14px] font-bold">{onceLabel}</p>
          <pre className="mono overflow-x-auto rounded-[8px] border-[1.5px] border-line bg-paper p-2.5 text-[12px] break-all whitespace-pre-wrap">
            {state.command}
          </pre>
          <CopyMarkdown
            markdown={state.command}
            label={copyLabel}
            copiedLabel={copiedLabel}
          />
        </div>
      )}

      <form action={formAction} className="mt-4 flex flex-wrap items-end gap-2">
        <Field label={nameLabel} className="min-w-48 flex-1">
          <input name="name" placeholder={nameLabel} />
        </Field>
        <button className="btn" disabled={pending} aria-busy={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
    </>
  );
}
