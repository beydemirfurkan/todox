"use client";

import { useEffect } from "react";

import { TZ_COOKIE } from "@/lib/cookies";

/**
 * Tells the server which day the reader is having.
 *
 * Pages render on Vercel, which runs UTC, so a report asking for "today" would
 * otherwise measure from midnight UTC — three hours late in Istanbul, and a
 * whole day out for anyone west of Greenwich. The browser is the only side
 * that knows, so it writes its IANA name once and the server reads the cookie.
 *
 * Deliberately not a redirect or a refresh: the first paint uses the default
 * and the next navigation is correct. Nothing here is worth a layout shift.
 */
export function TzProbe() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;

    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TZ_COOKIE}=`))
      ?.slice(TZ_COOKIE.length + 1);
    if (current === encodeURIComponent(tz)) return;

    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  return null;
}
