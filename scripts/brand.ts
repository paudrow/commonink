// Generates every logo file from the shapes below: `npm run brand`.
// Sources and exports land in brand/; the site's icons land in web/public/ (served at the site root).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const BRAND = path.join(ROOT, "brand");
const PUBLIC = path.join(ROOT, "web/public");

const INDIGO = "#5b5bd6";
const PAPER = "#fbfaf8";

// On a 100×100 canvas, nudged up so the drop sits optically centred.
const DROP = "M50 14.5C50 14.5 25 43.5 25 60.5a25 25 0 0 0 50 0C75 43.5 50 14.5 50 14.5Z";
const SHINE = "M37 60.5a13 13 0 0 0 9 12";

const drop = (fill: string, shine: string) =>
  `<path d="${DROP}" fill="${fill}"/><path d="${SHINE}" stroke="${shine}" stroke-width="5" stroke-linecap="round" fill="none"/>`;

/** White drop on an indigo tile. `rx` 0 = full-bleed square (platforms that round corners themselves). */
function tile(size: number, { rx = 24, scale = 1 } = {}) {
  const body = scale === 1 ? drop("#fff", INDIGO) : `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${drop("#fff", INDIGO)}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="${rx}" fill="${INDIGO}"/>${body}</svg>`;
}

/** The drop alone, for light backgrounds. */
const mark = (size: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="21 11 58 80" width="${Math.round((size * 58) / 80)}" height="${size}">${drop(INDIGO, "#fff")}</svg>`;

/** Link preview card (Slack, iMessage, X…). */
const social = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${PAPER}"/>
  <g transform="translate(120 215) scale(2)"><rect width="100" height="100" rx="24" fill="${INDIGO}"/>${drop("#fff", INDIGO)}</g>
  <text x="386" y="305" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="92" font-weight="700" letter-spacing="-2.5" fill="#16150f">Common Ink</text>
  <text x="390" y="368" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" fill="#57534b">Notes and files for you, your team, and your agents.</text>
</svg>`;

const png = (svg: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** An .ico holding PNG images (supported by every browser in use today). */
function ico(images: Array<{ size: number; data: Buffer }>) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

const out = (dir: string, name: string, data: string | Buffer) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), data);
  console.log(path.relative(ROOT, path.join(dir, name)));
};

out(BRAND, "logo.svg", tile(512).replace(/ width="512" height="512"/, ""));
out(BRAND, "mark.svg", mark(512).replace(/ width="\d+" height="512"/, ""));
for (const size of [16, 32, 48, 64, 120, 128, 180, 192, 256, 512, 1024]) out(path.join(BRAND, "png"), `logo-${size}.png`, await png(tile(size)));
out(path.join(BRAND, "png"), "logo-square-1024.png", await png(tile(1024, { rx: 0 })));
for (const size of [256, 1024]) out(path.join(BRAND, "png"), `mark-${size}.png`, await png(mark(size)));
out(BRAND, "social.png", await png(social));

out(PUBLIC, "favicon.svg", tile(32).replace(/ width="32" height="32"/, ""));
out(PUBLIC, "favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(tile(size)) })))));
out(PUBLIC, "apple-touch-icon.png", await png(tile(180, { rx: 0 })));
out(PUBLIC, "icon-192.png", await png(tile(192)));
out(PUBLIC, "icon-512.png", await png(tile(512)));
out(PUBLIC, "icon-maskable-512.png", await png(tile(512, { rx: 0, scale: 0.8 })));
out(PUBLIC, "social.png", await png(social));
