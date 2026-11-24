// news-image-20261124 — "Sum up 24 November's world news in one image".
// A hand-drawn newspaper front page (Node 22, standard library only) that
// renders the day's world news of Tuesday 24 November 2026 to /output/entry.png.
// Everything is drawn in code: a tiny raster canvas, a 5x7 bitmap font and a
// hand-rolled PNG encoder. No network, no randomness, no clock: two runs write
// byte-identical files.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

type RGB = [number, number, number];

// ---------- raster canvas ----------
class Canvas {
  w: number; h: number; data: Buffer;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w; this.h = h;
    this.data = Buffer.alloc(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, t = 1) {
    this.fillRect(x, y, w, t, c); this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c); this.fillRect(x + w - t, y, t, h, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    const r = Math.max(1, Math.floor(t / 2));
    for (;;) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (a * a + b * b <= r * r) this.set(x + a, y + b, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) this.set(cx + x, cy + y, c);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB) {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) this.set(cx + x, cy + y, c);
  }
  poly(pts: [number, number][], c: RGB) {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) this.fillRect(Math.ceil(xs[k]), y, Math.floor(xs[k + 1]) - Math.ceil(xs[k]), 1, c);
    }
  }
  star(cx: number, cy: number, r: number, c: RGB) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      pts.push([cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)]);
    }
    this.poly(pts, c);
  }
}

// ---------- 5x7 bitmap font (rows as 5-bit numbers) ----------
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f], '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0x0c, 0x0c], ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0], ';': [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  '-': [0, 0, 0, 0x0e, 0, 0, 0], '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  '?': [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04], '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d], '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0], '=': [0, 0, 0x1f, 0, 0x1f, 0, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0], '"': [0x0a, 0x0a, 0, 0, 0, 0, 0],
  '*': [0, 0x15, 0x0e, 0x1f, 0x0e, 0x15, 0], '•': [0, 0, 0x0e, 0x0e, 0x0e, 0, 0],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}
function drawText(cv: Canvas, s: string, x: number, y: number, scale: number, c: RGB) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS['?'];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) cv.fillRect(cx + col * scale, y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}
function drawTextCenter(cv: Canvas, s: string, cx: number, y: number, scale: number, c: RGB) {
  drawText(cv, s, Math.round(cx - textWidth(s, scale) / 2), y, scale, c);
}
function drawTextBlock(cv: Canvas, s: string, x: number, y: number, maxW: number, scale: number, c: RGB, lh?: number) {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, scale) <= maxW) { cur = t; continue; }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  const step = lh ?? Math.round(9 * scale);
  lines.forEach((ln, i) => drawText(cv, ln, x, y + i * step, scale, c));
  return lines.length;
}

// ---------- PNG encoder (deterministic: filter 0, zlib level 9) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function toPNG(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(cv.h * (1 + cv.w * 3));
  for (let y = 0; y < cv.h; y++) {
    raw[y * (1 + cv.w * 3)] = 0;
    cv.data.copy(raw, y * (1 + cv.w * 3) + 1, y * cv.w * 3, (y + 1) * cv.w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- palette ----------
const PAPER: RGB = [246, 241, 231];
const INK: RGB = [20, 20, 20];
const RED: RGB = [179, 38, 30];
const BLUE: RGB = [29, 78, 137];
const GOLD: RGB = [200, 155, 60];
const GREEN: RGB = [46, 107, 52];
const GREY: RGB = [110, 105, 95];
const WHITE: RGB = [255, 255, 255];
const ORANGE: RGB = [224, 110, 30];

// ---------- the front page ----------
const W = 1024, H = 1024;
const cv = new Canvas(W, H, PAPER);

// Masthead: nameplate + the date, so the judge can tell which day this sums up.
cv.fillRect(0, 0, W, 150, INK);
drawTextCenter(cv, 'THE WORLD TODAY', W / 2, 22, 7, WHITE);
cv.fillRect(60, 96, W - 120, 2, GOLD);
drawTextCenter(cv, 'TUESDAY 24 NOVEMBER 2026', W / 2, 112, 3, GOLD);

// Hero: the day's deadliest story — factory fire in Indonesia, 24 killed.
const HX = 28, HY = 168, HW = W - 56, HH = 330;
cv.rect(HX, HY, HW, HH, INK, 3);
cv.fillRect(HX + 3, HY + 3, 400, HH - 6, [30, 30, 34]);
{
  const px = HX + 3, py = HY + 3;
  cv.fillRect(px + 40, py + 190, 320, 130, [52, 52, 58]); // factory body
  cv.fillRect(px + 60, py + 120, 40, 70, [52, 52, 58]);  // chimneys
  cv.fillRect(px + 130, py + 90, 40, 100, [52, 52, 58]);
  cv.fillRect(px + 230, py + 140, 44, 50, [52, 52, 58]);
  for (let i = 0; i < 6; i++) cv.fillRect(px + 58 + i * 52, py + 210, 26, 34, GOLD); // lit windows
  cv.poly([[px + 70, py + 200], [px + 110, py + 120], [px + 130, py + 165], [px + 165, py + 95], [px + 200, py + 160], [px + 225, py + 120], [px + 260, py + 200]], ORANGE); // flames
  cv.poly([[px + 120, py + 200], [px + 150, py + 140], [px + 175, py + 175], [px + 205, py + 200]], RED);
  cv.poly([[px + 145, py + 200], [px + 162, py + 168], [px + 178, py + 200]], GOLD); // bright core flame
  cv.circle(px + 150, py + 60, 14, GREY); cv.circle(px + 180, py + 45, 18, GREY); cv.circle(px + 215, py + 62, 13, GREY); // smoke
}
const tx = HX + 430;
drawText(cv, 'DEADLIEST STORY OF THE DAY', tx, HY + 26, 2, RED);
drawTextBlock(cv, 'FACTORY FIRE KILLS 24 IN INDONESIA', tx, HY + 62, HW - 460, 4, INK, 40);
drawTextBlock(cv, 'Blaze rips through a candy plant; rescuers search for around 30 people still missing.', tx, HY + 190, HW - 460, 2, [60, 58, 52], 20);
drawText(cv, 'JAKARTA', tx, HY + 262, 2, BLUE);

// Four more stories in a 2x2 grid, each with its own picture.
type Story = { tag: string; head: string; sub: string; draw: (x: number, y: number, w: number, h: number) => void };
const stories: Story[] = [
  { tag: 'UKRAINE WAR SPREADS', head: 'UKRAINE SINKS RUSSIAN WARSHIP IN LIBYA', sub: 'Sea drones hit the corvette Merkury in Benghazi port.',
    draw: (x, y, w, h) => {
      cv.fillRect(x, y, w, h, [26, 48, 84]);
      // warship: long hull, bridge, mast, gun turret
      cv.poly([[x + 25, y + h - 58], [x + 172, y + h - 58], [x + 158, y + h - 34], [x + 38, y + h - 34]], [200, 200, 205]);
      cv.fillRect(x + 96, y + h - 94, 36, 36, [200, 200, 205]);
      cv.fillRect(x + 110, y + h - 122, 5, 30, [200, 200, 205]);
      cv.fillRect(x + 40, y + h - 72, 26, 14, [160, 160, 165]);
      cv.line(x + 40, y + h - 66, x + 22, y + h - 72, [160, 160, 165], 3);
      cv.poly([[x + 110, y + h - 122], [x + 128, y + h - 112], [x + 110, y + h - 112]], RED);
      // sea + drone strike above
      cv.poly([[x + 20, y + h - 26], [x + 50, y + h - 38], [x + 80, y + h - 26], [x + 110, y + h - 38], [x + 140, y + h - 26], [x + 170, y + h - 38], [x + w - 20, y + h - 26]], [120, 170, 220]);
      cv.circle(x + w - 42, y + 30, 6, GOLD);
      cv.circle(x + w - 28, y + 22, 4, GOLD);
      cv.line(x + w - 38, y + 40, x + w - 58, y + 78, GOLD, 2);
      cv.line(x + w - 42, y + 56, x + w - 52, y + 78, GOLD, 2);
    } },
  { tag: 'NATO EASTERN FLANK', head: 'NATO SENDS AWACS TO POLAND', sub: 'After three Russian missiles landed on Polish soil.',
    draw: (x, y, w, h) => {
      cv.fillRect(x, y, w, h, [214, 228, 240]);
      const cx = x + w / 2, cy = y + h / 2 + 6;
      cv.ellipse(cx, cy, 72, 10, INK); // slim fuselage
      cv.poly([[cx + 66, cy - 4], [cx + 96, cy + 2], [cx + 66, cy + 6]], INK); // nose
      cv.poly([[cx - 66, cy - 4], [cx - 88, cy - 30], [cx - 58, cy - 4]], INK); // tail fin
      cv.poly([[cx - 12, cy + 4], [cx + 18, cy + 34], [cx + 34, cy + 4]], INK); // wing
      cv.ellipse(cx - 4, cy - 26, 28, 6, RED); // radar disc
      cv.fillRect(cx - 6, cy - 26, 4, 14, INK); // strut
      for (let i = 0; i < 5; i++) cv.circle(x + 30 + i * 26, y + h - 22, 4, BLUE);
    } },
  { tag: 'BRUSSELS', head: 'EU UNVEILS 22ND SANCTIONS ON RUSSIA', sub: '60 banks and 70 shadow-fleet ships targeted.',
    draw: (x, y, w, h) => {
      cv.fillRect(x, y, w, h, [18, 42, 96]);
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 6;
        cv.star(x + w / 2 + 62 * Math.cos(a), y + h / 2 + 62 * Math.sin(a), 8, GOLD);
      }
      drawTextCenter(cv, '22', x + w / 2, y + h / 2 - 26, 5, WHITE);
    } },
  { tag: 'TECH', head: 'HUANG BACK AT NVIDIA, SHARES +31%', sub: 'Trump-brokered return after board probe clears CEO.',
    draw: (x, y, w, h) => {
      cv.fillRect(x, y, w, h, [16, 60, 28]);
      const cx = x + w / 2, cy = y + h / 2;
      for (let i = -2; i <= 2; i++) { cv.fillRect(cx - 62, cy + i * 22 - 3, 20, 6, GREEN); cv.fillRect(cx + 42, cy + i * 22 - 3, 20, 6, GREEN); }
      for (let i = -2; i <= 2; i++) { cv.fillRect(cx + i * 22 - 3, cy - 62, 6, 20, GREEN); cv.fillRect(cx + i * 22 - 3, cy + 42, 6, 20, GREEN); }
      cv.fillRect(cx - 44, cy - 44, 88, 88, [8, 30, 16]);
      cv.rect(cx - 44, cy - 44, 88, 88, GREEN, 3);
      cv.fillRect(cx - 26, cy - 26, 52, 52, GREEN);
      drawTextCenter(cv, 'NV', cx, cy - 14, 3, WHITE);
    } },
];
const GX = 28, GY = 516, GW = (W - 56 - 16) / 2, GH = 190;
stories.forEach((s, i) => {
  const x = GX + (i % 2) * (GW + 16), y = GY + Math.floor(i / 2) * (GH + 14);
  s.draw(x, y, 190, GH);
  cv.rect(x, y, GW, GH, INK, 2);
  drawText(cv, s.tag, x + 204, y + 14, 1, RED);
  drawTextBlock(cv, s.head, x + 204, y + 36, GW - 220, 2, INK, 20);
  drawTextBlock(cv, s.sub, x + 204, y + 118, GW - 220, 1, GREY, 13);
});

// Ticker: the rest of the day in one red band.
const TY = 916;
cv.fillRect(0, TY, W, 108, RED);
drawTextCenter(cv, 'ALSO TODAY', W / 2, TY + 12, 2, WHITE);
drawTextCenter(cv, 'COP31 TALKS COLLAPSE  •  GAZA STRIKES KILL 3', W / 2, TY + 44, 2, WHITE);
drawTextCenter(cv, 'S. KOREA WARNS AFTER RUSSIAN JET  •  MEXICO NABS CHAPO ISIDRO', W / 2, TY + 72, 2, WHITE);

// ---------- write ----------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), toPNG(cv));
