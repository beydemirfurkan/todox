"use client";

import { useEffect, useRef } from "react";

/**
 * Scrolls a sideways row so its current item is in view.
 *
 * A row of chips or tabs that scrolls on a phone opens at its start, so the
 * one that is selected -- the period you picked, the tab you are on -- could
 * sit past the right edge, and the row looked like nothing was chosen. Put
 * this inside the row; it finds `[aria-current]` among its siblings once, on
 * mount. Renders an empty span.
 */
export function RevealCurrent() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = marker.current?.parentElement;
    const current = row?.querySelector<HTMLElement>("[aria-current]");
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
  }, []);
  return <span ref={marker} hidden />;
}
