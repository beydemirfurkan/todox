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
  /**
   * Hint for the on-screen keyboard's Enter key. The last field in a form is
   * usually `done`/`go`; the field before a password is `next` so the user can
   * jump straight to the password.
   */
  enterKeyHint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send";
  /** Prefill, for forms that edit something that already has a value. */
  defaultValue?: string;
  /** For fields that must be typed verbatim — a phone helpfully capitalises. */
  exact?: boolean;
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
  pendingLabel,
  submitClassName = "btn",
  messages,
  hidden,
  successLabel,
}: {
  action: (prev: AuthState, fd: FormData) => Promise<AuthState>;
  fields: AuthFieldSpec[];
  submitLabel: string;
  /** What the button says while the action runs. Sign-in is a round trip. */
  pendingLabel: string;
  /** For the one form whose button should not look like "save". */
  submitClassName?: string;
  messages: Record<string, string>;
  /** Values the form must carry but nobody should type, e.g. a reset token. */
  hidden?: Record<string, string>;
  /** Shown when the action returns without errors. Omit for forms that redirect. */
  successLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const errors = state?.errors ?? [];
  const formError = errors.find((e) => e.field === "form");
  const errorFor = (name: string) => errors.find((e) => e.field === name);
  // null means "not submitted yet"; an empty list means it worked. Forms that
  // redirect never reach either.
  const succeeded = Boolean(successLabel) && state !== null && errors.length === 0;

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

      {succeeded && (
        <p
          role="status"
          className="sticker-flat px-3 py-2 text-[14px]"
          style={{ borderColor: "var(--ok)" }}
        >
          {successLabel}
        </p>
      )}

      {fields.map((f) => {
        const err = errorFor(f.name);
        const errId = `${f.name}-error`;
        return (
          <div key={f.name}>
            <Field label={f.label}>
              <input
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={f.defaultValue}
                autoComplete={f.autoComplete}
                autoFocus={f.autoFocus}
                enterKeyHint={f.enterKeyHint}
                autoCapitalize={f.exact ? "none" : undefined}
                autoCorrect={f.exact ? "off" : undefined}
                spellCheck={f.exact ? false : undefined}
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

      {/* aria-busy rather than disabled: a disabled button loses focus, and a
          keyboard user submitting with Enter would land nowhere. */}
      <button
        className={submitClassName}
        aria-busy={pending}
        aria-disabled={pending}
        onClick={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
