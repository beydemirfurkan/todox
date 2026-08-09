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

const PAPER = "#191b22";
const CARD = "#22252e";
const INK = "#f1eee5";
const MUTED = "#a9a394";
const LINE = "#3e4451";
const ACCENT = "#ffd84d";
const ON_FILL = "#17181d";

/** satori needs a real font file; woff2 is not supported, so ask for TTF. */
async function shantell(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Shantell+Sans:wght@700",
      // Old Android is the UA that makes Google serve a plain .ttf;
      // modern ones get woff2 and MSIE gets an extensionless webfont blob,
      // neither of which satori can parse.
      { headers: { "user-agent": "Mozilla/5.0 (Linux; U; Android 2.2)" } },
    ).then((r) => r.text());

    // Take a TTF specifically. Google will happily hand back woff2 or eot,
    // and satori rejects both with a confusing "unsupported signature".
    const url = [...css.matchAll(/url\((https:[^)]+)\)/g)]
      .map((m) => m[1])
      .find((u) => u.endsWith(".ttf"));
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null; // fall back to the bundled font rather than fail the build
  }
}

function Blob({ size }: { size: number }) {
  return (
    <svg width={size} height={(size * 74) / 76} viewBox="0 0 76 74">
      <g
        stroke={ON_FILL}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path
          d="M15 37C9 22 23 9 39 11c17 2 26 14 22 29-4 14-22 24-35 18-8-4-6-9-11-21Z"
          fill={ACCENT}
        />
        <path d="M38 11c1-4 4-5 6-3" />
        <circle cx="30" cy="35" r="3.4" fill={ON_FILL} stroke="none" />
        <circle cx="47" cy="33" r="3.4" fill={ON_FILL} stroke="none" />
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
        color: ON_FILL,
        border: `2px solid rgba(0,0,0,0.42)`,
        borderRadius: 999,
        padding: "6px 18px",
        fontSize: 26,
        fontWeight: 700,
      }}
    >
      {label}
    </div>
  );
}

async function main() {
  const font = await shantell();
  console.log(font ? "using Shantell Sans" : "font fetch failed, using the default");

  const image = new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: PAPER,
          // the same pencil dot grid the app uses
          backgroundImage: `radial-gradient(#333844 1.5px, transparent 1.5px)`,
          backgroundSize: "28px 28px",
          padding: 72,
          fontFamily: font ? "Shantell" : "sans-serif",
          color: INK,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: CARD,
            border: `2px solid ${LINE}`,
            borderRadius: 28,
            boxShadow: "10px 10px 0 #0e1016",
            padding: "48px 56px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <Blob size={86} />
            <div style={{ display: "flex", fontSize: 88, fontWeight: 700 }}>todox</div>
          </div>

          <div style={{ display: "flex", marginTop: 28, fontSize: 40, lineHeight: 1.25 }}>
            Working memory for developers and their agents
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 14,
              fontSize: 28,
              color: MUTED,
              fontFamily: "sans-serif",
            }}
          >
            Not a checklist — a log your next session can resume from
          </div>

          <div style={{ display: "flex", gap: 14, marginTop: 34 }}>
            <Chip label="decision" fill="#6cb7f5" />
            <Chip label="dead end" fill="#ff6f5e" />
            <Chip label="question" fill="#ffd84d" />
            <Chip label="handoff" fill="#bda2ff" />
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: font
        ? [{ name: "Shantell", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    },
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
