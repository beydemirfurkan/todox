"use client";

import { useEffect, useSyncExternalStore } from "react";

import { DEFAULT_LANG, isLang, translator } from "@/lib/i18n";
import { AuthShell } from "./features/auth-shell";

/**
 * The boundary that was missing entirely: any throw inside a server component
 * — an unknown project reference, a database blip mid-render — reached the
 * person as Next's raw "Application error" screen.
 *
 * `getT` cannot be used here. It reads the language cookie, which is
 * `httpOnly`, and this file is a client component. The dictionaries are plain
 * data though, so the strings still live in the same two files as every other
 * string; only the lookup moves. `<html lang>` is what the layout already
 * resolved, which makes it the one piece of server state readable from here.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Read on the client, with the default as the server's answer, so hydration
  // has something consistent to match rather than a value only one side has.
  const lang = useSyncExternalStore(
    () => () => {},
    () => document.documentElement.lang,
    () => DEFAULT_LANG,
  );

  useEffect(() => {
    // The digest is the only handle on the server-side log entry, and the
    // message itself is deliberately not shown: on this path it can carry
    // whatever the failure said.
    console.error("page error", error.digest ?? error.message);
  }, [error]);

  const t = translator(isLang(lang) ? lang : DEFAULT_LANG);

  return (
    <AuthShell
      mood="worried"
      fill="var(--k-dead_end)"
      title={t("errorTitle")}
      intro={t("errorBody")}
    >
      <button type="button" onClick={reset} className="btn w-full">
        {t("errorRetry")}
      </button>
    </AuthShell>
  );
}
