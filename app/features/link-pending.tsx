"use client";

import { useLinkStatus } from "next/link";

/**
 * A small ring inside a link that turns while its page is on the way.
 *
 * Always rendered and only faded in, so a click never shifts the row it sits
 * in. A route with a `loading.tsx` swaps to its skeleton at once and this
 * barely shows; it is for the pages that wait on the server first, Today
 * among them.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className="link-pending" data-state={pending ? "pending" : "idle"} />;
}
