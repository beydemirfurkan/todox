import type { Lang } from "@/lib/i18n";

/**
 * Flags as drawings, not emoji.
 *
 * Windows ships no glyphs for the regional-indicator pairs, so 🇹🇷 renders as
 * the letters "TR" in every browser on it — which is most of the people this
 * app is written for. These are a few paths each, they inherit the row's
 * sizing, and they look the same everywhere.
 *
 * A flag is a country and a language is not, which is why one never appears
 * without its name beside it. These are recognition, not identification.
 */
export function Flag({ lang, size = 18 }: { lang: Lang; size?: number }) {
  const h = Math.round((size * 2) / 3);
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 24 16"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      style={{ borderRadius: 3, border: "1px solid var(--edge-dark)" }}
    >
      {lang === "tr" ? <Turkiye /> : <UnitedKingdom />}
    </svg>
  );
}

function Turkiye() {
  return (
    <>
      <rect width="24" height="16" fill="#e30a17" />
      {/* Crescent: a white disc with a red one biting into it. */}
      <circle cx="9" cy="8" r="4" fill="#fff" />
      <circle cx="10.4" cy="8" r="3.2" fill="#e30a17" />
      <path
        d="m15.1 5.6.9 2.1 2.2.2-1.7 1.5.5 2.2-1.9-1.2-1.9 1.2.5-2.2-1.7-1.5 2.2-.2z"
        fill="#fff"
      />
    </>
  );
}

function UnitedKingdom() {
  return (
    <>
      <rect width="24" height="16" fill="#012169" />
      {/* White saltire, then the red one laid thinner on top. */}
      <path d="M0 0l24 16M24 0L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" strokeWidth="1.6" />
      {/* The upright cross last, so it reads over both. */}
      <path d="M12 0v16M0 8h24" stroke="#fff" strokeWidth="5.4" />
      <path d="M12 0v16M0 8h24" stroke="#c8102e" strokeWidth="3.2" />
    </>
  );
}
