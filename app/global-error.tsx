"use client";

import "./globals.css";

/**
 * The last resort: this replaces the root layout, so it renders its own
 * document and cannot borrow anything from it — no fonts, no header, and no
 * language, since the layout is what resolves that. Hence Turkish and English
 * together rather than a wrong guess between them.
 *
 * Each half carries its own `lang`. The document declared `lang="tr"` while
 * holding both, so a screen reader read the English sentence with Turkish
 * phonemes — which on the one page that exists to explain a failure is the worst
 * place to be unintelligible. The root is the default language and every span
 * that is not in it says so.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <main style={{ maxWidth: "28rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            <span lang="tr">todox açılamadı</span> · <span>todox failed to load</span>
          </h1>
          <p style={{ marginTop: "0.75rem", opacity: 0.75 }}>
            <span lang="tr">Sunucu bu sayfayı hiç kuramadı. Verilerine bir şey olmadı.</span>
            <br />
            <span>The server could not build this page at all. Your data is untouched.</span>
          </p>
          <button type="button" onClick={reset} className="btn" style={{ marginTop: "1.25rem" }}>
            <span lang="tr">Yeniden dene</span> · <span>Try again</span>
          </button>
        </main>
      </body>
    </html>
  );
}
