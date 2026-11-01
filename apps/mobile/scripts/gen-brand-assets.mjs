// Draws the Saha mark into the Android adaptive icon layers and the favicon.
// icon.png and splash-icon.png are the Designer's own exports (Library compound-app/design/saha-mark/,
// placeholders until the mark is final) and are not generated here. Geometry: assets/brand/saha-mark.svg
// (64-unit grid — four rounded units around a central square, gold dot). Colours: packages/ui-tokens.
// Run: node scripts/gen-brand-assets.mjs   (from apps/mobile)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const t = JSON.parse(readFileSync(new URL('../../../packages/ui-tokens/saha-ui-tokens-v0.1.1.json', import.meta.url), 'utf8'));
const hex = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const GREEN = hex(t.color.green['600']);
const WHITE = hex(t.color.neutral.white);
const GOLD = hex(t.color.accent.goldMark);

const UNITS = [[14, 14], [35, 14], [14, 35], [35, 35]].map(([x, y]) => ({ x, y, w: 15, h: 15, r: 3 }));
const DOT = { cx: 32, cy: 32, r: 4.5 };

const inRoundRect = (px, py, { x, y, w, h, r }) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const dx = Math.max(x + r - px, 0, px - (x + w - r));
  const dy = Math.max(y + r - py, 0, py - (y + h - r));
  return dx * dx + dy * dy <= r * r;
};

/**
 * @param size output px; @param field colour or null (transparent); @param fieldRadius in mark units (0 = full bleed)
 * @param scale mark size as a share of the canvas (adaptive icons keep the figure in the safe zone)
 */
function render({ size, field, fieldRadius = 0, figure, dot = GOLD, scale = 1 }) {
  const SS = 3; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  const markPx = size * scale;
  const off = (size - markPx) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS - off) / markPx) * 64;
          const v = ((y + (sy + 0.5) / SS - off) / markPx) * 64;
          let c = null;
          const inMark = u >= 0 && v >= 0 && u <= 64 && v <= 64;
          if (field && (scale < 1 ? true : inMark) && (fieldRadius === 0 || inRoundRect(u, v, { x: 0, y: 0, w: 64, h: 64, r: fieldRadius }))) c = field;
          if (inMark && UNITS.some((q) => inRoundRect(u, v, q))) c = figure;
          if (inMark && dot && (u - DOT.cx) ** 2 + (v - DOT.cy) ** 2 <= DOT.r ** 2) c = dot;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, i = (y * size + x) * 4, cov = a / 255;
      px[i] = cov ? Math.round(r / cov) : 0; px[i + 1] = cov ? Math.round(g / cov) : 0; px[i + 2] = cov ? Math.round(b / cov) : 0; px[i + 3] = Math.round(a / n);
    }
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = (name, buf) => { writeFileSync(new URL(`../assets/${name}`, import.meta.url), buf); console.log('wrote', name); };
// Adaptive icon: green background layer + figure inside the 66% safe zone.
out('android-icon-background.png', render({ size: 512, field: GREEN, figure: GREEN, dot: null, scale: 1 }));
out('android-icon-foreground.png', render({ size: 512, field: null, figure: WHITE, scale: 0.6 }));
out('android-icon-monochrome.png', render({ size: 432, field: null, figure: WHITE, dot: WHITE, scale: 0.6 }));
out('favicon.png', render({ size: 48, field: GREEN, fieldRadius: 14, figure: WHITE }));
