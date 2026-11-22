"use client";

import { useActionState, useEffect } from "react";

import { startProviderLinkAction, type LinkState } from "../auth-actions";

export interface ConnectProviderLabels {
  connect: string;
  password: string;
  continueTo: string;
  working: string;
}

/**
 * "connect", then the password, then off to the provider. The password field
 * is left out for an account that has none; the server then asks for a recent
 * sign-in instead and says so if there was not one.
 */
export function ConnectProvider({
  provider,
  providerName,
  hasPassword,
  labels,
  messages,
}: {
  provider: string;
  providerName: string;
  hasPassword: boolean;
  labels: ConnectProviderLabels;
  messages: Record<string, string>;
}) {
  const [state, formAction, isPending] = useActionState<LinkState, FormData>(
    startProviderLinkAction,
    null,
  );

  useEffect(() => {
    if (state?.url) window.location.assign(state.url);
  }, [state]);

  const error = state?.errors[0];
  const message = error
    ? (messages[error.code] ?? messages.oauthFailed).replace("{n}", String(error.retryAfterSec ?? ""))
    : "";
  const isLeaving = isPending || Boolean(state?.url);

  return (
    <details className="connect-provider">
      <summary className="btn">
        {labels.connect}
        <span className="sr-only"> — {providerName}</span>
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="provider" value={provider} />
        {hasPassword && (
          <label className="flex flex-col gap-1.5 text-small text-muted">
            {labels.password}
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
        )}
        <button type="submit" className="btn self-start" disabled={isLeaving}>
          {isLeaving ? labels.working : labels.continueTo}
        </button>
        <p role="status" aria-live="polite" className="text-small text-[var(--k-dead_end)]">
          {message}
        </p>
      </form>
    </details>
  );
}
