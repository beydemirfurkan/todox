"use client";

import { useActionState } from "react";

import type { AuthState } from "../auth-actions";
import { Field } from "../components";

export type AuthFieldSpec = {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
};

/**
 * Errors come back from the server action keyed by field, so each input can
 * point at its own message and the form can be announced as a whole.
 *
 * Messages arrive pre-translated: `t` is a server-side closure and cannot be
 * handed to a client component.
 */
export function AuthForm({
  action,
  fields,
  submitLabel,
  messages,
  hidden,
}: {
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
  fields: AuthFieldSpec[];
  submitLabel: string;
  messages: Record<string, string>;
  /** Values the form must carry but nobody should type, e.g. a reset token. */
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state?.errors ?? [];
  const formError = errors.find((e) => e.field === "form");
  const errorFor = (name: string) => errors.find((e) => e.field === name);

  // The template is translated on the server; only the number is filled here.
  const message = (e: { code: string; retryAfterSec?: number }) =>
    (messages[e.code] ?? e.code).replace("{n}", String(e.retryAfterSec ?? ""));

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {formError && (
        <p
          role="alert"
          className="sticker-flat px-3 py-2 text-[14px]"
          style={{ borderColor: "var(--k-dead_end)" }}
        >
          {message(formError)}
        </p>
      )}

      {fields.map((f) => {
        const err = errorFor(f.name);
        const errId = `${f.name}-error`;
        return (
          <div key={f.name}>
            <Field label={f.label} hidden={false}>
              <input
                name={f.name}
                type={f.type ?? "text"}
                autoComplete={f.autoComplete}
                autoFocus={f.autoFocus}
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? errId : undefined}
                style={err ? { borderColor: "var(--k-dead_end)" } : undefined}
              />
            </Field>
            {err && (
              <p
                id={errId}
                className="mt-1 text-[13px]"
                style={{ color: "var(--k-dead_end)" }}
              >
                {message(err)}
              </p>
            )}
          </div>
        );
      })}

      <button className="btn" disabled={pending} aria-busy={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
