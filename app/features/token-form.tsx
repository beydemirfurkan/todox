"use client";

import { useActionState } from "react";

import { createTokenAction } from "../auth-actions";
import { Field } from "../components";
import { AgentSetup, type AgentSetupLabels } from "./agent-setup";

/**
 * The token comes back in the action's reply and lives only in this component's
 * state. Reloading the page loses it, which is the guarantee we want: it is
 * never written to the URL, to history, or to storage.
 *
 * Labels arrive pre-translated -- `t` is a server-side closure and cannot cross
 * into a client component.
 */
export function TokenForm({
  url,
  promptTemplate,
  nameLabel,
  submitLabel,
  pendingLabel,
  onceLabel,
  tooManyTemplate,
  setup,
}: {
  /** Where this instance answers; the snippets are built from it. */
  url: string;
  /** Translated on the server, with {url} and {token} still in place. */
  promptTemplate: string;
  nameLabel: string;
  submitLabel: string;
  pendingLabel: string;
  onceLabel: string;
  /** Still carrying {n}: the wait is only known once the action has answered. */
  tooManyTemplate: string;
  setup: AgentSetupLabels;
}) {
  const [state, formAction, pending] = useActionState(createTokenAction, null);

  return (
    <>
      {state && "tooManyMinutes" in state && (
        // A live region, because nothing else changes: the form stays where it
        // is and a refusal that only settled the button would look like a
        // submit that quietly did nothing.
        <p
          role="status"
          aria-live="polite"
          className="sticker-flat mt-4 p-3 text-[14px] leading-relaxed"
        >
          {tooManyTemplate.replace("{n}", String(state.tooManyMinutes))}
        </p>
      )}

      {state && "token" in state && (
        <div
          className="sticker-flat mt-4 space-y-3 p-3"
          style={{ borderColor: "var(--accent)" }}
        >
          {/* The redirect used to announce itself as a page change; without it
              a live region is the only thing a screen reader has to go on. It
              wraps the notice alone: with the picker inside, every switch
              re-announced the whole block, token and all. */}
          <p role="status" aria-live="polite" className="display text-[14px] font-bold">
            {onceLabel}
          </p>
          <AgentSetup
            url={url}
            token={state.token}
            prompt={promptTemplate
              .replaceAll("{url}", url)
              .replaceAll("{token}", state.token)}
            labels={setup}
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
