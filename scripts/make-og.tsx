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

// The dark palette (task #811): near-black graphite, one orange, the kind
// colours as dots. Same values as the tokens in app/globals.css.
const PAPER = "#09090b";
const CARD = "#111114";
const GRID = "#1b1b20";
const INK = "#fafafa";
const MUTED = "#a3a3ad";
const FAINT = "#85858f";
const LINE = "#24242a";
const ACCENT = "#ff7a2e";
const ACCENT_INK = "#ff9a5c";
const ON_FILL = "#111111";

/**
 * satori needs a real font file; woff2 is not supported, so ask for TTF.
 * Old Android is the UA that makes Google serve a plain .ttf; modern ones get
 * woff2 and MSIE gets an extensionless webfont blob, neither of which satori
 * can parse.
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

/** The mark: the same tile, prompt and cursor as app/icon.svg. */
function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill={ACCENT} />
      <path d="M9 11l5 5-5 5" fill="none" stroke={ON_FILL} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21h6" stroke={ON_FILL} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** One of the kinds the log keeps: a dot in its colour and the word. */
function Kind({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: CARD,
        border: `1px solid ${LINE}`,
        borderRadius: 999,
        padding: "6px 18px 8px 14px",
        fontSize: 22,
        fontFamily: "DM Mono",
        color: MUTED,
      }}
    >
      <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: color }} />
      {label}
    </div>
  );
}

async function main() {
  const [bold, regular, mono] = await Promise.all([
    googleTtf("Geist:wght@600"),
    googleTtf("Geist:wght@400"),
    googleTtf("DM+Mono:wght@400"),
  ]);
  console.log(bold && regular && mono ? "using Geist + DM Mono" : "a font fetch failed, using the default for it");
  const fonts = [
    ...(bold ? [{ name: "Geist", data: bold, weight: 600 as const, style: "normal" as const }] : []),
    ...(regular ? [{ name: "Geist", data: regular, weight: 400 as const, style: "normal" as const }] : []),
    ...(mono ? [{ name: "DM Mono", data: mono, weight: 400 as const, style: "normal" as const }] : []),
  ];

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px 56px",
          background: PAPER,
          backgroundImage: `linear-gradient(to right, ${GRID} 1px, transparent 1px), linear-gradient(to bottom, ${GRID} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          fontFamily: "Geist",
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Mark size={56} />
          <div style={{ display: "flex", fontSize: 44, fontWeight: 600, letterSpacing: -1.5 }}>todox</div>
          <div style={{ display: "flex", marginLeft: 8, paddingLeft: 20, borderLeft: `1px solid ${LINE}`, fontSize: 22, fontFamily: "DM Mono", color: FAINT }}>
            MCP server · open source
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", fontSize: 96, lineHeight: 1.02, fontWeight: 600, letterSpacing: -4 }}>
          <div style={{ display: "flex" }}>working memory</div>
          <div style={{ display: "flex", color: ACCENT_INK }}>for your agents</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <Kind label="decision" color="#7db4f5" />
            <Kind label="dead_end" color="#ff8a70" />
            <Kind label="question" color="#ffc94d" />
            <Kind label="handoff" color="#c3a8ff" />
          </div>
          <div style={{ display: "flex", fontSize: 24, fontFamily: "DM Mono", color: MUTED }}>todox.dev</div>
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
