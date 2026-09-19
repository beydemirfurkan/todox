"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * Closes the popover a form sits in once its action has run.
 *
 * A popover's open state is DOM state, not an attribute, so a server action
 * that re-renders the page leaves it exactly as it was: open, over the row
 * it just added, with an emptied form in it. Without JavaScript the submit
 * is a navigation and the popover is gone with the page; this is the same
 * outcome for the case where the action ran in place.
 *
 * `useFormStatus` reports the form this sits inside, so each composer closes
 * only itself. Renders nothing.
 */
export function ClosePopoverAfterSubmit() {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (wasPending.current && !pending) {
      const popover = marker.current?.closest("[popover]");
      if (popover instanceof HTMLElement && popover.matches(":popover-open")) {
        popover.hidePopover();
      }
    }
    wasPending.current = pending;
  }, [pending]);

  return <span ref={marker} hidden />;
}
