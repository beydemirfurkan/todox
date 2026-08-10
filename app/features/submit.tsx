"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that says something is happening.
 *
 * Server actions are a round trip, and on anything slower than a desk the gap
 * between the click and the new page is long enough to look ignored — so people
 * click again. The browser's own loading bar is at the top of the window, which
 * is nowhere near the button they just pressed.
 *
 * `useFormStatus` only reports the form this button is inside, so several forms
 * on one page each answer for themselves. The form stays a plain
 * `<form action>`, which is what keeps all of this working with no JavaScript:
 * the feedback is the only part that needs the client.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn",
  title,
  disabled,
}: {
  children: React.ReactNode;
  /** Shown instead of the label while the action runs. Falls back to the label. */
  pendingLabel?: string;
  className?: string;
  title?: string;
  /** For a control that is genuinely unavailable, not merely busy. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      title={title}
      disabled={disabled}
      // Not `disabled`: a disabled button loses focus, which drops a keyboard
      // user out of the form mid-submit. aria-busy says the same thing without
      // moving anything, and the CSS below stops a second click.
      aria-busy={pending}
      aria-disabled={pending}
      onClick={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
