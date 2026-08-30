/**
 * Renders `app/icon.svg` into `app/favicon.ico`.
 *
 * `app/icon.svg` already answers every browser that reads the document, and it
 * is the better file — one vector, sharp at any size. The gap it does not
 * close is the clients that never read the document and ask for `/favicon.ico`
 * by hard-coded path: feed readers, link unfurlers, some search crawlers, and
 * anything that saw the URL before it saw the HTML. Those got a 404.
 *
 * Written to disk rather than generated per request, for the same reason as
 * `scripts/make-og.tsx`: it changes only when the logo does.
 *
 * The container holds PNGs rather than the old BMP-with-AND-mask encoding.
 * That has been valid ICO since Vista and is what every current renderer
 * prefers; the encoding this replaces would be the compatible choice for
 * Windows XP, which is not a browser anybody is serving.
 */
import { ImageResponse } from "next/og";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * 16 for the browser tab, 32 for the bookmark bar and most retina tabs, 48 for
 * a Windows shortcut. Three is the conventional set and the whole file is
 * still small; leaving 16 out is what makes a favicon look muddy in a tab,
 * because a downscaled 32 is not the same as a drawn 16.
 */
const SIZES = [16, 32, 48] as const;

async function render(svg: string, size: number): Promise<Buffer> {
  // Satori draws the SVG through an <img>, which needs a data URI rather than
  // a path: this process has a filesystem, the renderer does not.
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const response = new ImageResponse(
    (
      <div style={{ display: "flex", width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={uri} width={size} height={size} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
  return Buffer.from(await response.arrayBuffer());
}

/**
 * ICONDIR followed by one ICONDIRENTRY per image, then the images themselves.
 *
 * A dimension of 256 is written as 0 — the field is one byte and 256 does not
 * fit. Nothing here reaches that size, but the next person to add one would
 * otherwise write a 0-pixel icon and see nothing.
 */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon, 2 would be a cursor
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ENTRY);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size; 0 for truecolour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function main() {
  const svg = readFileSync(join(ROOT, "app", "icon.svg"), "utf8");
  const images = [];
  for (const size of SIZES) {
    images.push({ size, png: await render(svg, size) });
  }
  const out = join(ROOT, "app", "favicon.ico");
  const bytes = ico(images);
  writeFileSync(out, bytes);
  console.log(`wrote ${out} — ${SIZES.join(", ")}px, ${bytes.length} bytes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
