/**
 * Renders the social preview card to a PNG.
 *
 * Written to disk rather than generated per request: it never changes between
 * deploys, and a static file is one less thing to be slow or fail. Next picks
 * `app/opengraph-image.png` up automatically; the copy in docs/ is what you
 * upload to GitHub's social preview setting.
 */
import { ImageResponse } from "next/og";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const W = 1200;
const H = 630;

// The notebook palette (task #809): cream paper, charcoal ink, one marker.
const PAPER = "#fdfbf9";
const DOT = "#ebe1d7";
const INK = "#171717";
const HEAD = "#2b1a07";
const ACCENT = "#ff6f1e";
const ACCENT_INK = "#b84508";
const LINE = "#c9bcae";

/**
 * satori needs a real font file; woff2 is not supported, so ask for TTF.
 * Old Android is the UA that makes Google serve a plain .ttf; modern ones get
 * woff2 and MSIE gets an extensionless webfont blob, neither of which satori
 * can parse. Static instances only, so Fraunces comes without its SOFT axis
 * here -- close enough at card size.
 */
async function googleTtf(family: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}`, {
      headers: { "user-agent": "Mozilla/5.0 (Linux; U; Android 2.2)" },
    }).then((r) => r.text());
    const url = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]).find((u) => u.endsWith(".ttf"));
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch (e) {
    console.warn(`font ${family} not fetched: ${(e as Error).message}`);
    return null; // fall back to the bundled font rather than fail the build
  }
}

function Blob({ size }: { size: number }) {
  return (
    <svg width={size} height={(size * 74) / 76} viewBox="0 0 76 74">
      <g stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M15 37C9 22 23 9 39 11c17 2 26 14 22 29-4 14-22 24-35 18-8-4-6-9-11-21Z" fill={ACCENT} />
        <path d="M38 11c1-4 4-5 6-3" />
        <circle cx="30" cy="35" r="3.4" fill={INK} stroke="none" />
        <circle cx="47" cy="33" r="3.4" fill={INK} stroke="none" />
        <path d="M31 44q7 9 15 0" />
      </g>
    </svg>
  );
}

function Chip({ label, fill }: { label: string; fill: string }) {
  return (
    <div
      style={{
        display: "flex",
        background: fill,
        color: INK,
        border: `1.5px solid ${INK}`,
        borderRadius: 20,
        padding: "4px 16px 6px",
        fontSize: 24,
        fontFamily: "Geist",
      }}
    >
      {label}
    </div>
  );
}

async function main() {
  const [display, italic, sans] = await Promise.all([
    googleTtf("Fraunces:wght@600"),
    googleTtf("Fraunces:ital,wght@1,500"),
    googleTtf("Geist:wght@400"),
  ]);
  console.log(display && italic && sans ? "using Fraunces + Geist" : "a font fetch failed, using the default for it");
  const fonts = [
    ...(display ? [{ name: "Fraunces", data: display, weight: 600 as const, style: "normal" as const }] : []),
    ...(italic ? [{ name: "Fraunces", data: italic, weight: 500 as const, style: "italic" as const }] : []),
    ...(sans ? [{ name: "Geist", data: sans, weight: 400 as const, style: "normal" as const }] : []),
  ];

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          backgroundImage: `radial-gradient(${DOT} 1.5px, transparent 1.5px)`,
          backgroundSize: "26px 26px",
          fontFamily: "Fraunces",
          color: INK,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", padding: "56px 72px 0", flexGrow: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Blob size={60} />
            <div style={{ display: "flex", fontSize: 46, fontWeight: 600, color: HEAD }}>todox</div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 34,
              fontSize: 30,
              fontStyle: "italic",
              fontWeight: 500,
              color: ACCENT_INK,
              transform: "rotate(-1.5deg)",
            }}
          >
            for developers, and the agents they work with —
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 10, fontSize: 84, lineHeight: 1.04, fontWeight: 600, color: HEAD }}>
            <div style={{ display: "flex", whiteSpace: "nowrap" }}>the notebook your agent</div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", color: ACCENT_INK }}>
                actually keeps
                <div style={{ display: "flex", height: 7, marginTop: -8, borderRadius: 7, background: ACCENT, transform: "rotate(-0.6deg)" }} />
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: ACCENT,
            borderRadius: "48px 48px 0 0",
            padding: "26px 72px 30px",
            borderTop: `1.5px solid ${LINE}`,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <Chip label="decision" fill="#7db4f5" />
            <Chip label="dead end" fill="#ff8a70" />
            <Chip label="question" fill="#ffc94d" />
            <Chip label="handoff" fill="#c3a8ff" />
          </div>
          <div style={{ display: "flex", fontSize: 24, fontFamily: "Geist", color: INK }}>todox.dev</div>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: fonts.length ? fonts : undefined },
  );

  const png = Buffer.from(await image.arrayBuffer());
  mkdirSync(join(ROOT, "docs"), { recursive: true });
  writeFileSync(join(ROOT, "app", "opengraph-image.png"), png);
  writeFileSync(join(ROOT, "docs", "social-preview.png"), png);
  console.log(`wrote ${(png.length / 1024).toFixed(0)} KB to app/ and docs/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
