"use client";

import "./globals.css";

/**
 * The last resort: this replaces the root layout, so it renders its own
 * document and cannot borrow anything from it — no fonts, no header, and no
 * language, since the layout is what resolves that. Hence Turkish and English
 * together rather than a wrong guess between them.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="tr">
      <body style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <main style={{ maxWidth: "28rem", padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
            todox açılamadı · todox failed to load
          </h1>
          <p style={{ marginTop: "0.75rem", opacity: 0.75 }}>
            Sunucu bu sayfayı hiç kuramadı. Verilerine bir şey olmadı.
            <br />
            The server could not build this page at all. Your data is untouched.
          </p>
          <button type="button" onClick={reset} className="btn" style={{ marginTop: "1.25rem" }}>
            Yeniden dene · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
