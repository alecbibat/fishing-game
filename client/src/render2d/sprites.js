/*
 * Driftwood Isles — procedural pixel-art sprite library.
 * Stardew-Valley-ish look: chunky pixels, warm saturated palette, 1px darker
 * outlines, 2-tone shading, zero anti-aliasing. Every sprite is drawn at
 * 1 pixel = 1 canvas pixel; the renderer upscales with nearest neighbor.
 *
 * Plain browser ES module, no imports. All canvas creation is lazy (inside
 * functions) so the module parses cleanly under node.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (no Math.random anywhere)
// ---------------------------------------------------------------------------

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(name, seed) {
  let a = hash32(name + '|' + seed) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function shade(hex, f) {
  const [r, g, b] = hexRgb(hex);
  return rgbHex(r * f, g * f, b * f);
}

function alphaCol(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// ---------------------------------------------------------------------------
// Canvas + pixel drawing helpers (all integer fillRect, no AA)
// ---------------------------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return c;
}

function rec(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, Math.max(0, w | 0), Math.max(0, h | 0));
}

function px(g, x, y, c) {
  rec(g, x, y, 1, 1, c);
}

// Filled integer ellipse (scanline rows).
function ell(g, cx, cy, rx, ry, c) {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / (ry + 0.5);
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    rec(g, cx - hw, cy + dy, hw * 2 + 1, 1, c);
  }
}

// Clear an integer ellipse region.
function ellClear(g, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / (ry + 0.5);
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    g.clearRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}

// Filled triangle pointing up: apex at (cx, yTop), base half-width hbw.
function tri(g, cx, yTop, hgt, hbw, c, cDark) {
  for (let i = 0; i < hgt; i++) {
    const hw = Math.max(0, Math.round((hbw * (i + 1)) / hgt));
    rec(g, cx - hw, yTop + i, hw * 2 + 1, 1, cDark && i >= hgt - 2 ? cDark : c);
  }
}

// 1px Bresenham line.
function line(g, x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    px(g, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

// Darken the 1px rim of the opaque silhouette — the "Stardew outline".
function outlineDarken(canvas, f) {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= 160;
  const marks = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 160) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) marks.push(i);
    }
  }
  for (const i of marks) {
    d[i] = (d[i] * f) | 0;
    d[i + 1] = (d[i + 1] * f) | 0;
    d[i + 2] = (d[i + 2] * f) | 0;
    d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
}

// ---------------------------------------------------------------------------
// Shared palette
// ---------------------------------------------------------------------------

const TRUNK = '#7a5230', TRUNK_D = '#5b3c20';
const LEAF = '#4e9440', LEAF_D = '#39752f', LEAF_L = '#68b050';
const WOOD = '#b08a54', WOOD_D = '#8a6240', WOOD_L = '#c9a670';
const STONE = '#9a948c', STONE_D = '#6e6a62', STONE_L = '#b6b0a6';
const WATER = '#4a9ac9', WATER_L = '#7fc4e0';
const GLASS = '#8ad4e8', GLASS_L = '#c9ecf4', GLASS_D = '#5aa8c4';
const DOOR = '#5e3820';
const GOLD = '#e8bc48';

// ---------------------------------------------------------------------------
// Building helper: walls + pitched roof + south-facing door (+ windows)
// ---------------------------------------------------------------------------

function drawBuilding(g, r, W, H, o) {
  const wallM = o.wallM !== undefined ? o.wallM : 3;
  const roofY = o.roofY !== undefined ? o.roofY : 1;
  const roofH = o.roofH !== undefined ? o.roofH : Math.floor(H * 0.4);
  const wallTop = roofY + roofH - 2;
  const wallX = wallM, wallW = W - wallM * 2;
  const wallDark = o.wallDark || shade(o.wall, 0.78);
  const cx = W / 2;

  // Walls (2-tone: base + darker footing)
  rec(g, wallX, wallTop, wallW, H - wallTop, o.wall);
  rec(g, wallX, H - 3, wallW, 3, wallDark);
  // Right side shade strip
  rec(g, wallX + wallW - 2, wallTop, 2, H - wallTop, wallDark);

  // Roof: trapezoid from ridge to full-width eaves
  const ridgeHW = o.ridgeHW !== undefined ? o.ridgeHW : Math.max(4, Math.floor(wallW * 0.24));
  const eaveHW = Math.floor(W / 2);
  const roofDark = o.roofDark || shade(o.roof, 0.72);
  const roofLight = o.roofLight || shade(o.roof, 1.22);
  for (let i = 0; i < roofH; i++) {
    const t = i / (roofH - 1);
    const hw = Math.round(ridgeHW + (eaveHW - ridgeHW) * t);
    let c = o.roof;
    if (i <= 1) c = roofLight;
    else if (i >= roofH - 3) c = roofDark;
    rec(g, Math.round(cx - hw), roofY + i, hw * 2, 1, c);
  }
  // Thatch / shingle texture flecks
  if (o.roofTex) {
    for (let i = 0; i < roofH * 1.6; i++) {
      const yy = roofY + 2 + ((r() * (roofH - 5)) | 0);
      const t = (yy - roofY) / (roofH - 1);
      const hw = Math.round(ridgeHW + (eaveHW - ridgeHW) * t) - 2;
      px(g, Math.round(cx - hw + r() * hw * 2), yy, roofDark);
    }
  }
  // Eave shadow line on wall
  rec(g, wallX, wallTop + 1, wallW, 1, wallDark);

  // Door (south-facing, centered unless overridden)
  const dw = o.doorW || Math.max(6, Math.floor(W * 0.16));
  const dh = o.doorH || Math.max(9, Math.floor(H * 0.24));
  const dx = o.doorX !== undefined ? o.doorX : Math.round(cx - dw / 2);
  rec(g, dx - 1, H - dh - 1, dw + 2, dh + 1, o.trim || '#6e4a2c');
  rec(g, dx, H - dh, dw, dh, o.door || DOOR);
  rec(g, dx, H - dh, dw, 1, shade(o.door || DOOR, 1.35));
  px(g, dx + dw - 2, H - ((dh / 2) | 0), GOLD);

  // Windows
  for (const wpos of o.windows || []) {
    const wx = wpos[0], wy = wpos[1];
    rec(g, wx - 1, wy - 1, 8, 8, o.trim || '#6e4a2c');
    rec(g, wx, wy, 6, 6, o.glass || GLASS);
    rec(g, wx, wy, 3, 2, o.glassL || GLASS_L);
    rec(g, wx, wy + 3, 6, 1, GLASS_D);
    rec(g, wx + 3, wy, 1, 6, GLASS_D);
    rec(g, wx - 1, wy + 6, 8, 1, shade(o.trim || '#6e4a2c', 0.72));
  }
  return { cx: cx | 0, wallTop, wallX, wallW, doorX: dx, doorW: dw, doorTop: H - dh };
}

function signSquare(g, x, y, dotColor) {
  rec(g, x - 1, y - 1, 8, 8, '#a8842c');
  rec(g, x, y, 6, 6, GOLD);
  rec(g, x, y, 6, 1, '#f4dc8a');
  if (dotColor) rec(g, x + 2, y + 2, 2, 2, dotColor);
}

// ---------------------------------------------------------------------------
// Sprite draw functions
// ---------------------------------------------------------------------------

function drTreeOak(g, r, W, H) {
  rec(g, 11, 20, 4, 14, TRUNK);
  rec(g, 14, 20, 1, 14, TRUNK_D);
  rec(g, 9, 32, 2, 2, TRUNK);
  rec(g, 15, 32, 2, 2, TRUNK_D);
  ell(g, 13, 11, 11, 9, LEAF);
  ell(g, 6, 14, 5, 5, LEAF);
  ell(g, 20, 14, 5, 5, LEAF);
  ell(g, 13, 16, 9, 4, LEAF_D);
  ell(g, 9, 7, 5, 3, LEAF_L);
  for (let i = 0; i < 10; i++) {
    const a = r() * Math.PI * 2, d = r();
    px(g, 13 + Math.round(Math.cos(a) * 9 * d), 11 + Math.round(Math.sin(a) * 7 * d), r() < 0.5 ? LEAF_L : LEAF_D);
  }
}

function drTreePine(g, r, W, H) {
  const PINE = '#2e7040', PINE_D = '#215434', PINE_L = '#3f8a52';
  rec(g, 10, 30, 3, 6, TRUNK);
  px(g, 12, 30, TRUNK_D); px(g, 12, 33, TRUNK_D);
  tri(g, 11, 17, 13, 10, PINE, PINE_D);
  tri(g, 11, 9, 12, 8, PINE, PINE_D);
  tri(g, 11, 1, 11, 6, PINE, PINE_D);
  for (let i = 0; i < 8; i++) {
    const yy = 3 + ((r() * 24) | 0);
    px(g, 11 - ((r() * 5) | 0), yy, r() < 0.6 ? PINE_L : PINE_D);
  }
}

function drTreePalm(g, r, W, H) {
  // Curved trunk from base (10,33) to crown (14,12)
  for (let y = 33; y >= 12; y--) {
    const t = (33 - y) / 21;
    const x = 10 + Math.round(t * t * 5);
    rec(g, x, y, 2, 1, '#b98d5c');
    if (y % 2) px(g, x + 1, y, '#96703f');
  }
  const P1 = '#3f9448', P2 = '#35803c';
  const fronds = [
    [14, 10, 9, 6], [16, 10, 21, 6],
    [13, 11, 6, 14], [17, 11, 23, 14],
    [14, 12, 10, 17], [16, 12, 20, 17],
  ];
  for (const f of fronds) {
    const dy = (r() * 2) | 0;
    line(g, f[0], f[1], f[2], f[3] + dy, P1);
    line(g, f[0], f[1] + 1, f[2], f[3] + 1 + dy, P2);
    px(g, f[2], f[3] + dy, LEAF_D);
  }
  rec(g, 14, 11, 3, 2, P1);
  px(g, 14, 13, '#6b4226'); px(g, 16, 13, '#6b4226'); px(g, 15, 14, '#57351d');
}

function drTreeDead(g, r, W, H) {
  const BARK = '#8a7660', BARK_D = '#6b5a48';
  rec(g, 8, 6, 3, 22, BARK);
  rec(g, 10, 6, 1, 22, BARK_D);
  rec(g, 6, 26, 2, 2, BARK_D); rec(g, 11, 26, 2, 2, BARK);
  line(g, 8, 12, 4, 8, BARK); line(g, 7, 12, 4, 9, BARK_D);
  line(g, 10, 9, 14, 5, BARK); line(g, 11, 10, 14, 6, BARK_D);
  px(g, 3, 7, BARK); px(g, 15, 4, BARK);
  px(g, 9, 5, BARK); px(g, 9, 4, BARK_D);
  rec(g, 9, 16, 1, 4, BARK_D);
}

function drTreeWillow(g, r, W, H) {
  const WIL = '#5e9c4e', WIL_D = '#48823c', WIL_L = '#74b45e';
  rec(g, 12, 20, 4, 12, TRUNK);
  rec(g, 15, 20, 1, 12, TRUNK_D);
  ell(g, 14, 9, 13, 8, WIL);
  ell(g, 14, 13, 11, 4, WIL_D);
  ell(g, 10, 6, 6, 3, WIL_L);
  // Hanging strands
  for (let x = 2; x <= 26; x += 2 + ((r() * 2) | 0)) {
    const top = 11 + ((r() * 3) | 0);
    const len = 7 + ((r() * 11) | 0);
    rec(g, x, top, 1, Math.min(len, 29 - top), r() < 0.5 ? WIL : WIL_D);
  }
}

function drBush(g, r, W, H) {
  ell(g, 7, 6, 6, 4, LEAF);
  ell(g, 3, 8, 3, 2, LEAF);
  ell(g, 7, 9, 5, 2, LEAF_D);
  ell(g, 5, 4, 3, 1, LEAF_L);
  if (r() < 0.55) {
    for (let i = 0; i < 3; i++) px(g, 3 + ((r() * 8) | 0), 4 + ((r() * 5) | 0), '#d8453a');
  }
}

function drGrassTuft(g, r, W, H) {
  const xs = [1, 3, 5, 7, 8];
  for (let i = 0; i < xs.length; i++) {
    const hgt = 3 + ((r() * 4) | 0);
    rec(g, xs[i], 8 - hgt, 1, hgt, i % 2 ? LEAF_L : LEAF);
    if (r() < 0.5) px(g, xs[i] + (i % 2 ? 1 : -1), 8 - hgt, i % 2 ? LEAF : LEAF_D);
  }
}

function drFlowers(g, r, W, H) {
  const cols = ['#e85a5a', '#f2d04a', '#e88ac9', '#f4f4e8', '#9a6ae8'];
  rec(g, 1, 8, 4, 2, LEAF); rec(g, 5, 9, 3, 1, LEAF_D); rec(g, 8, 8, 3, 2, LEAF);
  const heads = [[1, 2], [5, 0], [8, 3]];
  for (const hd of heads) {
    const hx = hd[0], hy = hd[1] + ((r() * 2) | 0);
    rec(g, hx + 1, hy + 3, 1, 6 - hy, '#4a8038'); // stem
    const c = cols[(r() * cols.length) | 0];
    // plus-shaped 3x3 head
    rec(g, hx, hy + 1, 3, 1, c);
    rec(g, hx + 1, hy, 1, 3, c);
    px(g, hx + 1, hy + 1, '#fff2c9');
  }
}

function drCattail(g, r, W, H) {
  rec(g, 3, 6, 1, 8, '#5e8a3c');
  rec(g, 6, 5, 1, 9, '#4a7530');
  rec(g, 2, 2, 2, 4, '#7a4a28');
  px(g, 2, 2, '#9a6a42'); px(g, 3, 1, '#5e8a3c');
  rec(g, 5, 1, 2, 4, '#7a4a28');
  px(g, 5, 1, '#9a6a42'); px(g, 6, 0, '#5e8a3c');
  px(g, 8, 8, LEAF); px(g, 8, 9, LEAF); px(g, 9, 7, LEAF_D);
  px(g, 1, 10, LEAF); px(g, 1, 11, LEAF_D);
}

function drLilypad(g, r, W, H) {
  ell(g, 6, 4, 5, 3, '#3f8a3a');
  ell(g, 4, 3, 2, 1, '#57a848');
  rec(g, 2, 6, 8, 1, '#31702c');
  // notch wedge
  g.clearRect(8, 3, 4, 1);
  g.clearRect(9, 2, 3, 1);
  px(g, 8, 4, '#31702c');
  if (r() < 0.4) { px(g, 4, 2, '#f2a0c9'); px(g, 5, 2, '#fff'); }
}

function drMushroomGlow(g, r, W, H) {
  const cap = r() < 0.5 ? '#3fd4c4' : '#a86ae8';
  g.fillStyle = alphaCol(cap, 0.25);
  for (let dy = -4; dy <= 4; dy++) {
    const hw = Math.floor(6 * Math.sqrt(Math.max(0, 1 - (dy / 4.5) * (dy / 4.5))));
    g.fillRect(5 - hw, 4 + dy, hw * 2 + 1, 1);
  }
  rec(g, 4, 7, 2, 5, '#cfe0dc');
  rec(g, 5, 7, 1, 5, '#a8beba');
  ell(g, 5, 4, 4, 3, cap);
  rec(g, 2, 6, 6, 1, shade(cap, 0.6));
  px(g, 3, 3, '#e8fef8'); px(g, 6, 2, '#e8fef8'); px(g, 7, 4, shade(cap, 1.3));
}

function drRock(g, r, W, H) {
  ell(g, 7, 5, 6, 4, STONE);
  ell(g, 7, 7, 5, 2, STONE_D);
  rec(g, 4, 2, 4, 1, STONE_L); rec(g, 3, 3, 3, 1, STONE_L);
  for (let i = 0; i < 3; i++) px(g, 4 + ((r() * 7) | 0), 4 + ((r() * 4) | 0), STONE_D);
}

function drRockBig(g, r, W, H) {
  ell(g, 6, 8, 6, 5, STONE);
  ell(g, 13, 7, 6, 5, STONE);
  ell(g, 9, 11, 8, 2, STONE_D);
  rec(g, 10, 3, 5, 1, STONE_L); rec(g, 3, 5, 3, 1, STONE_L);
  for (let i = 0; i < 4; i++) px(g, 3 + ((r() * 14) | 0), 5 + ((r() * 7) | 0), STONE_D);
  if (r() < 0.5) { px(g, 5, 4, '#5e9c4e'); px(g, 15, 5, '#5e9c4e'); }
}

function drCrystal(g, r, W, H) {
  const teal = '#4ee0d8', purp = '#a86ae8';
  const c1 = r() < 0.5 ? teal : purp, c2 = c1 === teal ? purp : teal;
  g.fillStyle = alphaCol(c1, 0.22);
  g.fillRect(1, 8, 14, 11);
  ell(g, 8, 17, 6, 2, STONE_D);
  // main shard: sharp tip, faceted sides, slight taper at the base
  for (let y = 1; y <= 17; y++) {
    let hw;
    if (y < 11) hw = Math.min(3, Math.round((y - 1) * 0.4));
    else hw = y >= 16 ? 2 : 3;
    rec(g, 6 - hw, y, hw * 2 + 1, 1, c1);
    px(g, 6 - Math.max(0, hw - 1), y, shade(c1, 1.45));
    px(g, 6 + hw, y, shade(c1, 0.6));
  }
  px(g, 6, 1, '#ffffff'); px(g, 5, 3, '#ffffff');
  // side shard
  for (let y = 7; y <= 17; y++) {
    const hw = Math.min(2, Math.round((y - 7) * 0.45));
    rec(g, 12 - hw, y, hw * 2 + 1, 1, c2);
    px(g, 12 + hw, y, shade(c2, 0.6));
  }
  px(g, 12, 7, shade(c2, 1.4));
  px(g, 2, 13, c2); px(g, 2, 14, shade(c2, 0.7)); px(g, 2, 15, shade(c2, 0.7));
}

function drHouse(g, r, W, H) {
  drawBuilding(g, r, W, H, {
    wall: '#f2e0ba', wallDark: '#d6bd8e',
    roof: '#c96b46', roofDark: '#a04f2e', roofLight: '#e0855c',
    roofH: 19, doorW: 8, doorH: 11,
    windows: [[9, 27], [31, 27]],
  });
}

function drHouseBlue(g, r, W, H) {
  drawBuilding(g, r, W, H, {
    wall: '#f2e0ba', wallDark: '#d6bd8e',
    roof: '#4a74c4', roofDark: '#35568e', roofLight: '#6b92d8',
    roofH: 19, doorW: 8, doorH: 11,
    windows: [[9, 27], [31, 27]],
  });
}

function drBank(g, r, W, H) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#e0d8c8', wallDark: '#bfb49e',
    roof: '#2f8f86', roofDark: '#226b64', roofLight: '#44ab9f',
    roofH: 17, doorW: 10, doorH: 13,
    windows: [[8, 27], [38, 27]],
  });
  // Pillars flanking door
  rec(g, b.doorX - 5, 25, 3, H - 27, '#f0ead8');
  rec(g, b.doorX - 4, 25, 1, H - 27, '#c9bfa8');
  rec(g, b.doorX + b.doorW + 2, 25, 3, H - 27, '#f0ead8');
  rec(g, b.doorX + b.doorW + 3, 25, 1, H - 27, '#c9bfa8');
  // Steps
  rec(g, b.doorX - 3, H - 2, b.doorW + 6, 2, '#b6b0a6');
  signSquare(g, b.cx - 3, 19, '#a8842c');
}

function drShop(g, r, W, H, roof, roofD, dot) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#c99a62', wallDark: '#a87c48',
    roof: roof, roofDark: roofD,
    roofH: 16, doorW: 7, doorH: 10,
    windows: [[7, 24]],
  });
  signSquare(g, b.cx + 6, 22, dot);
}

function drShopPotion(g, r, W, H) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#cfc4b0', wallDark: '#aa9e86',
    roof: '#1f6b66', roofDark: '#164e4a', roofLight: '#2d8a80',
    roofH: 16, doorW: 7, doorH: 10,
    windows: [[27, 24]],
  });
  signSquare(g, b.cx + 6, 22, '#5ee06a');
  // Cauldron by the door
  rec(g, 7, 33, 5, 1, '#42424c');
  rec(g, 6, 34, 7, 4, '#33333b');
  rec(g, 8, 33, 3, 1, '#5ee06a');
  px(g, 9, 31, '#8af29a'); px(g, 7, 30, '#8af29a');
  px(g, 7, 38, '#1c1c22'); px(g, 11, 38, '#1c1c22');
}

function drBakery(g, r, W, H) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#cf9d64', wallDark: '#ab7c48',
    roof: '#8a5634', roofDark: '#6b4026', roofLight: '#a06a42',
    roofH: 16, doorW: 7, doorH: 10,
    windows: [[7, 24]],
    glass: '#f2cf6a', glassL: '#fae9ae',
  });
  // Chimney
  rec(g, 28, 1, 5, 9, '#9a8a7c');
  rec(g, 27, 1, 7, 2, '#7c6e60');
  signSquare(g, b.cx + 6, 22, '#a8672c');
}

function drHall(g, r, W, H) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#e8dcc4', wallDark: '#c6b898',
    roof: '#5a6e8a', roofDark: '#42526a', roofLight: '#70859e',
    roofH: 17, doorW: 10, doorH: 12,
    windows: [[8, 27], [36, 27]],
  });
  // Clock on the gable
  ell(g, b.cx, 8, 3, 3, '#f4f0e4');
  px(g, b.cx, 8, '#3a3a42'); px(g, b.cx, 7, '#3a3a42');
  // Steps
  rec(g, b.doorX - 3, H - 2, b.doorW + 6, 2, '#b6b0a6');
  // Banner
  rec(g, 8, 20, 3, 6, '#c9342a'); px(g, 9, 26, '#c9342a');
  rec(g, 39, 20, 3, 6, '#c9342a'); px(g, 40, 26, '#c9342a');
}

function drHut(g, r, W, H) {
  const b = drawBuilding(g, r, W, H, {
    wall: '#a87c50', wallDark: '#84603c',
    roof: '#c9a95e', roofDark: '#a8874a', roofLight: '#dcc078',
    roofH: 13, roofTex: true, doorW: 6, doorH: 9,
    windows: [],
  });
  // Round porthole window
  ell(g, b.cx + 8, 21, 2, 2, '#6e4a2c');
  ell(g, b.cx + 8, 21, 1, 1, GLASS);
  // Buoy on the wall
  px(g, 7, 19, '#d8443a'); px(g, 7, 20, '#f4f0e4'); px(g, 7, 21, '#d8443a');
}

function drWindmill(g, r, W, H) {
  const WALL = '#e8dcc4', WALL_D = '#c6b898';
  // Tower (tapered)
  for (let y = 12; y < H; y++) {
    const hw = 6 + Math.round((4 * (y - 12)) / (H - 13));
    rec(g, 17 - hw, y, hw * 2, 1, WALL);
    rec(g, 17 + hw - 3, y, 3, 1, WALL_D);
  }
  rec(g, 7, H - 3, 20, 3, WALL_D);
  // Cap
  tri(g, 16, 4, 9, 8, '#8a5634', '#6b4026');
  // Blades (X) in front
  for (let i = 2; i <= 12; i++) {
    const c = i % 2 ? '#c4a06a' : '#a5854f';
    rec(g, 16 + i, 15 - i, 2, 2, c);
    rec(g, 15 - i, 15 - i, 2, 2, c);
    if (15 + i < 40) {
      rec(g, 16 + i, 15 + i, 2, 2, c);
      rec(g, 15 - i, 15 + i, 2, 2, c);
    }
  }
  rec(g, 15, 14, 3, 3, '#5b3c20');
  // Door + window
  rec(g, 13, H - 10, 8, 10, '#6e4a2c');
  rec(g, 14, H - 9, 6, 9, DOOR);
  px(g, 18, H - 5, GOLD);
  rec(g, 14, 26, 5, 5, '#6e4a2c');
  rec(g, 15, 27, 3, 3, GLASS);
}

function drLighthouse(g, r, W, H) {
  const WHT = '#f4f0e8', WHT_D = '#d5cfc2', RED = '#d8443a', RED_D = '#a83228';
  rec(g, 3, H - 4, 16, 4, STONE_D);
  rec(g, 4, H - 5, 14, 1, STONE);
  for (let y = 13; y < H - 4; y++) {
    const hw = 5 + Math.round((2 * (y - 13)) / (H - 18));
    const stripe = (y >= 18 && y <= 22) || (y >= 31 && y <= 35);
    rec(g, 11 - hw, y, hw * 2, 1, stripe ? RED : WHT);
    rec(g, 11 + hw - 2, y, 2, 1, stripe ? RED_D : WHT_D);
  }
  // Gallery + lamp room
  rec(g, 4, 10, 14, 3, '#4a4a52');
  for (let x = 5; x < 17; x += 2) px(g, x, 9, '#4a4a52');
  g.fillStyle = alphaCol('#ffd966', 0.3);
  g.fillRect(3, 2, 16, 9);
  rec(g, 7, 4, 8, 6, '#ffd966');
  rec(g, 9, 5, 4, 3, '#fff2b0');
  rec(g, 7, 4, 1, 6, '#4a4a52');
  rec(g, 14, 4, 1, 6, '#4a4a52');
  tri(g, 10, 1, 3, 4, RED, RED_D);
  // Door
  rec(g, 8, H - 12, 6, 8, '#6e4a2c');
  rec(g, 9, H - 11, 4, 7, DOOR);
}

function drStall(g, r, W, H, col) {
  // Posts
  rec(g, 2, 9, 2, 16, WOOD_D);
  rec(g, 26, 9, 2, 16, WOOD_D);
  // Counter
  rec(g, 2, 15, 26, 7, WOOD);
  rec(g, 2, 15, 26, 1, WOOD_L);
  rec(g, 2, 20, 26, 2, WOOD_D);
  rec(g, 2, 18, 26, 1, shade(WOOD, 0.85));
  // Awning (striped, sloped)
  for (let i = 0; i < 8; i++) {
    const hw = Math.round(12 + (3 * i) / 7);
    const y = 1 + i;
    for (let x = 15 - hw; x < 15 + hw; x++) {
      const stripe = ((x + 60) / 3 | 0) % 2 === 0;
      px(g, x, y, stripe ? col : '#f4f0e4');
    }
  }
  // Scalloped edge
  for (let x = 1; x < 29; x += 3) {
    const stripe = ((x + 60) / 3 | 0) % 2 === 0;
    rec(g, x, 9, 2, 1, stripe ? col : '#f4f0e4');
  }
  // Goods on the counter
  const goods = ['#d8a03a', '#c94a3a', '#5e9c4e', '#e88ac9'];
  for (let i = 0; i < 3; i++) {
    rec(g, 6 + i * 7 + ((r() * 2) | 0), 13, 2, 2, goods[(r() * goods.length) | 0]);
  }
}

function drFountain(g, r, W, H, frame) {
  ell(g, 15, 17, 14, 8, STONE);
  ell(g, 15, 15, 12, 6, STONE_L);
  ell(g, 15, 17, 11, 6, STONE_D);
  ell(g, 15, 17, 9, 5, WATER);
  // Pedestal + top bowl
  rec(g, 13, 7, 4, 9, STONE);
  rec(g, 15, 7, 2, 9, STONE_D);
  rec(g, 11, 5, 8, 2, STONE_L);
  rec(g, 12, 4, 6, 1, STONE);
  rec(g, 13, 3, 4, 1, WATER_L);
  // Falling streams (animate by frame)
  for (let y = 7; y <= 14; y++) {
    if ((y + frame) % 3 !== 0) {
      px(g, 10, y, WATER_L);
      px(g, 20, y, WATER_L);
    }
  }
  // Sparkles on the pool
  const sp0 = [[9, 16], [14, 19], [20, 17], [12, 15], [18, 20]];
  const sp1 = [[11, 18], [16, 15], [21, 19], [8, 18], [15, 21]];
  for (const s of frame ? sp1 : sp0) px(g, s[0], s[1], '#aee0f2');
  rec(g, 6, 23, 18, 1, shade(STONE_D, 0.85));
}

function drBench(g, r, W, H) {
  rec(g, 1, 0, 16, 2, WOOD);
  rec(g, 1, 0, 16, 1, WOOD_L);
  px(g, 3, 2, WOOD_D); px(g, 14, 2, WOOD_D);
  px(g, 3, 3, WOOD_D); px(g, 14, 3, WOOD_D);
  rec(g, 1, 4, 16, 3, WOOD_L);
  rec(g, 1, 6, 16, 1, WOOD_D);
  rec(g, 2, 7, 2, 3, WOOD_D);
  rec(g, 14, 7, 2, 3, WOOD_D);
}

function drLamp(g, r, W, H) {
  g.fillStyle = alphaCol('#ffcf5e', 0.3);
  g.fillRect(0, 1, 8, 8);
  px(g, 3, 0, '#3a3a42'); px(g, 4, 0, '#3a3a42');
  rec(g, 2, 1, 4, 1, '#3a3a42');
  rec(g, 2, 2, 4, 5, '#ffd966');
  rec(g, 3, 3, 2, 3, '#fff6cf');
  px(g, 2, 2, '#3a3a42'); px(g, 5, 2, '#3a3a42');
  rec(g, 2, 7, 4, 1, '#3a3a42');
  rec(g, 3, 8, 2, 11, '#3a3a42');
  rec(g, 3, 8, 1, 11, '#54545e');
  rec(g, 2, 19, 4, 1, '#3a3a42');
  rec(g, 1, 20, 6, 2, '#2c2c34');
}

function drSignpost(g, r, W, H) {
  rec(g, 6, 3, 2, 13, WOOD_D);
  rec(g, 6, 3, 1, 13, WOOD);
  rec(g, 1, 2, 12, 7, WOOD);
  rec(g, 2, 3, 10, 5, WOOD_L);
  rec(g, 3, 4, 4, 1, TRUNK_D);
  rec(g, 8, 4, 2, 1, TRUNK_D);
  rec(g, 3, 6, 5, 1, TRUNK_D);
  px(g, 2, 3, '#5b3c20'); px(g, 11, 3, '#5b3c20');
}

function drNoticeboard(g, r, W, H) {
  rec(g, 2, 4, 2, 15, WOOD_D);
  rec(g, 20, 4, 2, 15, WOOD_D);
  rec(g, 1, 1, 22, 12, WOOD_D);
  rec(g, 2, 2, 20, 10, WOOD);
  rec(g, 0, 0, 24, 1, '#5b3c20');
  const papers = [[4, 3, 5, 6, '#f4f0e0'], [11, 4, 4, 5, '#f2e8c9'], [17, 3, 4, 6, '#f4f0e0']];
  for (const p of papers) {
    rec(g, p[0], p[1], p[2], p[3], p[4]);
    for (let i = 1; i < p[3] - 1; i += 2) rec(g, p[0] + 1, p[1] + i, p[2] - 2, 1, '#a8a49a');
    px(g, p[0] + ((p[2] / 2) | 0), p[1], r() < 0.5 ? '#d8443a' : '#3a6ab0');
  }
}

function drCrate(g, r, W, H) {
  rec(g, 0, 0, 12, 12, WOOD);
  rec(g, 2, 2, 8, 8, WOOD_D);
  for (let i = 0; i < 8; i++) px(g, 2 + i, 2 + i, WOOD);
  rec(g, 0, 0, 12, 1, WOOD_L);
  rec(g, 0, 5, 12, 1, shade(WOOD, 0.85));
  px(g, 1, 1, '#5b3c20'); px(g, 10, 1, '#5b3c20');
  px(g, 1, 10, '#5b3c20'); px(g, 10, 10, '#5b3c20');
}

function drBarrel(g, r, W, H) {
  const B = '#8a5e38', B_D = '#754c2c', B_L = '#a5764a';
  rec(g, 1, 1, 8, 12, B);
  rec(g, 0, 2, 10, 10, B);
  rec(g, 2, 0, 6, 1, B_L);
  rec(g, 2, 1, 1, 12, B_L);
  rec(g, 5, 1, 1, 12, B_D);
  rec(g, 0, 3, 10, 1, '#4a4a52');
  rec(g, 0, 10, 10, 1, '#4a4a52');
  px(g, 2, 3, '#6a6a78'); px(g, 2, 10, '#6a6a78');
}

function drTent(g, r, W, H) {
  const T = '#c9683f', T_D = '#a04e2c';
  for (let i = 0; i < 16; i++) {
    const hw = Math.max(0, Math.round((10 * (i + 1)) / 16));
    rec(g, 11 - hw, 1 + i, hw, 1, T);
    rec(g, 11, 1 + i, hw + 1, 1, T_D);
  }
  rec(g, 10, 0, 2, 2, '#5b3c20');
  tri(g, 11, 10, 7, 4, '#42281c');
  px(g, 1, 16, '#5b3c20'); px(g, 20, 16, '#5b3c20');
}

function drCampfire(g, r, W, H, frame) {
  // Stone ring
  const stones = [[1, 8], [3, 10], [6, 11], [9, 10], [12, 8], [11, 10]];
  for (const s of stones) { rec(g, s[0], s[1], 2, 1, STONE); px(g, s[0], s[1] + 1, STONE_D); }
  // Logs
  rec(g, 3, 9, 8, 1, '#6b4226');
  line(g, 4, 10, 10, 8, TRUNK);
  // Flames
  rec(g, 5, 8, 4, 1, '#d8443a');
  if (!frame) {
    ell(g, 7, 5, 2, 3, '#f28c3a');
    ell(g, 7, 6, 1, 2, '#ffd94a');
    px(g, 7, 1, '#f28c3a'); px(g, 6, 2, '#f28c3a');
    px(g, 10, 3, '#ffd94a');
  } else {
    ell(g, 7, 5, 3, 3, '#f28c3a');
    ell(g, 8, 6, 1, 2, '#ffd94a');
    px(g, 8, 1, '#f28c3a'); px(g, 9, 2, '#f28c3a');
    px(g, 4, 2, '#ffd94a');
  }
}

function drRuinTower(g, r, W, H) {
  rec(g, 4, 12, 20, 26, STONE);
  rec(g, 19, 12, 5, 26, STONE_D);
  rec(g, 4, 12, 2, 26, STONE_L);
  // Broken crenellated top
  for (let x = 4; x < 24; x += 3) {
    if (x >= 16 && x <= 21) continue; // missing chunk
    const hgt = 2 + ((r() * 5) | 0);
    rec(g, x, 12 - hgt, 3, hgt, x > 17 ? STONE_D : STONE);
  }
  // Brick hints
  for (let i = 0; i < 14; i++) {
    const yy = 14 + ((r() * 22) | 0);
    const xx = 5 + ((r() * 17) | 0);
    rec(g, xx, yy, 1 + ((r() * 2) | 0), 1, xx > 18 ? '#565248' : STONE_D);
  }
  // Window slits + door
  rec(g, 9, 18, 2, 4, '#2e2a26');
  rec(g, 15, 26, 2, 4, '#2e2a26');
  rec(g, 12, 31, 6, 7, '#2e2a26');
  rec(g, 13, 30, 4, 1, '#2e2a26');
  // Moss + rubble
  for (let i = 0; i < 5; i++) px(g, 5 + ((r() * 17) | 0), 13 + ((r() * 22) | 0), '#5e9c4e');
  rec(g, 1, 38, 3, 2, STONE_D); px(g, 2, 37, STONE);
  rec(g, 24, 38, 3, 2, STONE_D); px(g, 25, 37, STONE);
  rec(g, 6, 38, 18, 2, shade(STONE_D, 0.85));
}

function drBridgeH(g, r, W, H) {
  // Deck: vertical planks
  rec(g, 0, 2, 16, 16, WOOD);
  for (let p = 0; p < 4; p++) {
    if (p % 2) rec(g, p * 4, 2, 4, 16, '#b89258');
    rec(g, p * 4 + 3, 2, 1, 16, WOOD_D);
  }
  for (let i = 0; i < 6; i++) px(g, (r() * 16) | 0, 3 + ((r() * 14) | 0), '#9c7647');
  // Rails top and bottom
  rec(g, 0, 0, 16, 1, WOOD_L);
  rec(g, 0, 1, 16, 1, '#5b3c20');
  rec(g, 0, 18, 16, 1, WOOD_L);
  rec(g, 0, 19, 16, 1, '#5b3c20');
}

function drPierH(g, r, W, H) {
  rec(g, 0, 0, 16, 8, '#c4a274');
  rec(g, 0, 2, 16, 1, '#9a7a50');
  rec(g, 0, 5, 16, 1, '#9a7a50');
  rec(g, 5, 0, 1, 2, '#9a7a50');
  rec(g, 12, 3, 1, 2, '#9a7a50');
  rec(g, 3, 6, 1, 2, '#9a7a50');
  rec(g, 0, 8, 16, 1, '#8a6240');
  // Posts
  rec(g, 2, 8, 3, 4, '#6e5638');
  rec(g, 2, 8, 3, 1, '#8a6c44');
  rec(g, 11, 8, 3, 4, '#6e5638');
  rec(g, 11, 8, 3, 1, '#8a6c44');
}

function drBoat(g, r, W, H) {
  for (let y = 9; y <= 16; y++) {
    const hw = Math.round(13 - (5 * (y - 9)) / 7);
    rec(g, 15 - hw, y, hw * 2, 1, y >= 15 ? '#6b4226' : '#8a5e38');
  }
  rec(g, 3, 8, 24, 1, WOOD);
  for (let y = 9; y <= 11; y++) {
    const hw = Math.round(13 - (5 * (y - 9)) / 7) - 2;
    rec(g, 15 - hw, y, hw * 2, 1, '#a87c48');
  }
  rec(g, 14, 0, 1, 9, '#5b3c20');
  for (let y = 1; y <= 7; y++) {
    const w = 1 + Math.round((y - 1) * 1.5);
    rec(g, 16, y, w, 1, y === 7 ? '#dcd4c0' : '#f4f0e4');
  }
  rec(g, 11, 0, 3, 2, '#d8443a');
}

function drFerry(g, r, W, H) {
  for (let y = 12; y <= 20; y++) {
    const hw = Math.round(18 - (5 * (y - 12)) / 8);
    rec(g, 20 - hw, y, hw * 2, 1, y >= 19 ? '#523823' : '#6b4a30');
  }
  rec(g, 3, 13, 34, 1, '#c94a3a');
  rec(g, 3, 11, 34, 1, WOOD);
  rec(g, 6, 9, 28, 2, '#c4a274');
  for (let x = 6; x < 34; x += 3) px(g, x, 8, '#5b3c20');
  // Cabin
  rec(g, 12, 3, 16, 8, '#f2e0ba');
  rec(g, 26, 3, 2, 8, '#d6bd8e');
  rec(g, 11, 2, 18, 2, '#c96b46');
  rec(g, 11, 2, 18, 1, '#e0855c');
  for (let i = 0; i < 3; i++) rec(g, 14 + i * 5, 5, 3, 3, GLASS);
  rec(g, 30, 0, 3, 4, '#4a4a52');
  rec(g, 30, 1, 3, 1, '#d8443a');
}

function drPortal(g, r, W, H, off) {
  const glowC = '#2ec4b8';
  if (!off) {
    g.fillStyle = alphaCol(glowC, 0.22);
    g.fillRect(1, 1, 26, 27);
  }
  rec(g, 5, 26, 18, 4, STONE);
  rec(g, 5, 28, 18, 2, STONE_D);
  ell(g, 14, 14, 11, 13, off ? '#847e76' : STONE);
  ell(g, 14, 14, 7, 9, off ? '#44444e' : '#0f3a3a');
  if (!off) {
    ell(g, 14, 14, 6, 8, glowC);
    ell(g, 14, 14, 3, 5, '#7ef2e8');
    px(g, 12, 9, '#c8fcf6'); px(g, 16, 12, '#c8fcf6');
    px(g, 13, 18, '#c8fcf6'); px(g, 15, 15, '#c8fcf6');
  } else {
    ell(g, 14, 14, 5, 7, '#38383f');
    px(g, 13, 12, '#50505c'); px(g, 15, 16, '#50505c'); px(g, 12, 17, '#50505c');
  }
  // Stone block chunks on the ring
  const blocks = [[3, 12, 2, 3], [23, 12, 2, 3], [13, 1, 3, 2], [7, 4, 2, 2], [19, 4, 2, 2], [6, 23, 2, 2], [20, 23, 2, 2]];
  for (const b of blocks) rec(g, b[0], b[1], b[2], b[3], off ? '#6a655e' : STONE_D);
  px(g, 9, 2, STONE_L); px(g, 24, 16, STONE_L); px(g, 4, 18, STONE_L);
}

function drGrate(g, r, W, H) {
  rec(g, 1, 1, 12, 8, '#5a5a62');
  rec(g, 2, 1, 10, 1, '#7c7c88');
  rec(g, 3, 3, 8, 1, '#1c1c22');
  rec(g, 3, 5, 8, 1, '#1c1c22');
  rec(g, 3, 7, 8, 1, '#1c1c22');
  px(g, 2, 2, '#8a8a96'); px(g, 11, 2, '#8a8a96');
  px(g, 2, 7, '#8a8a96'); px(g, 11, 7, '#8a8a96');
}

function drCaveMouth(g, r, W, H) {
  const RK = '#8a7a6c', RK_L = '#a4948c', RK_D = '#6e6054';
  ell(g, 13, 13, 12, 8, RK);
  ell(g, 13, 8, 9, 6, RK);
  ell(g, 10, 4, 5, 2, RK_L);
  ell(g, 13, 18, 11, 3, RK_D);
  // Opening
  ell(g, 13, 13, 5, 4, '#141018');
  rec(g, 8, 13, 11, 9, '#141018');
  rec(g, 9, 8, 9, 1, RK_L);
  for (let i = 0; i < 4; i++) px(g, 3 + ((r() * 20) | 0), 6 + ((r() * 10) | 0), RK_D);
}

function drBobber(g, r, W, H) {
  const rows = [[2, 2], [1, 4], [0, 6], [0, 6], [1, 4], [2, 2]];
  for (let y = 0; y < 6; y++) {
    rec(g, rows[y][0], y, rows[y][1], 1, y < 3 ? '#d8362a' : '#f4f4f4');
  }
  px(g, 1, 1, '#ff8a7a');
  rec(g, 1, 3, 4, 1, '#e0e0e0');
}

function drRipple(g, r, W, H) {
  g.fillStyle = 'rgba(214,242,250,0.85)';
  for (let dy = -2; dy <= 2; dy++) {
    const hw = Math.floor(5 * Math.sqrt(Math.max(0, 1 - (dy / 2.5) * (dy / 2.5))));
    g.fillRect(6 - hw, 3 + dy, hw * 2 + 1, 1);
  }
  ellClear(g, 6, 3, 3, 1);
  g.clearRect(2, 1, 2, 1);
  g.clearRect(8, 5, 2, 1);
}

function drHotspot(g, r, W, H, frame) {
  ell(g, 8, 5, 7, 4, '#5ea8cc');
  ell(g, 8, 5, 6, 3, '#3d84ae');
  const b0 = [[5, 3], [10, 6], [12, 4], [7, 7], [4, 6]];
  const b1 = [[6, 6], [9, 3], [12, 6], [5, 4], [11, 7]];
  for (const b of frame ? b1 : b0) px(g, b[0], b[1], '#e8f8ff');
  if (frame) rec(g, 7, 4, 2, 1, '#9ed4ea');
  else rec(g, 9, 6, 2, 1, '#9ed4ea');
}

function drPlotPegs(g, r, W, H) {
  const pegs = [[1, 1], [17, 1], [1, 10], [17, 10]];
  for (const p of pegs) {
    rec(g, p[0], p[1], 2, 4, '#8a6240');
    rec(g, p[0], p[1], 2, 1, WOOD);
  }
  for (let x = 4; x <= 16; x += 2) { px(g, x, 2, '#e0d0a0'); px(g, x, 11, '#e0d0a0'); }
  for (let y = 5; y <= 9; y += 2) { px(g, 2, y, '#e0d0a0'); px(g, 18, y, '#e0d0a0'); }
  rec(g, 9, 9, 2, 7, WOOD_D);
  rec(g, 6, 5, 8, 5, WOOD);
  rec(g, 7, 6, 6, 3, WOOD_L);
  rec(g, 8, 7, 4, 1, TRUNK_D);
}

function drBuildingFarm(g, r, W, H) {
  rec(g, 1, 7, 22, 18, '#7a5a3e');
  for (let y = 8; y < 25; y += 3) rec(g, 2, y, 20, 1, '#654a30');
  for (let i = 0; i < 11; i++) {
    const sx = 3 + ((r() * 18) | 0), sy = 10 + 3 * ((r() * 5) | 0);
    px(g, sx, sy, '#5e9c4e'); px(g, sx, sy - 1, '#74b45e');
    if (r() < 0.5) px(g, sx + 1, sy, '#4a8038');
  }
  // Tiny shed
  rec(g, 24, 7, 9, 17, '#a87c48');
  rec(g, 31, 7, 2, 17, '#84603c');
  rec(g, 24, 22, 9, 2, '#84603c');
  rec(g, 23, 3, 11, 4, '#8a5634');
  rec(g, 23, 6, 11, 1, '#6b4026');
  rec(g, 23, 3, 11, 1, '#a06a42');
  rec(g, 27, 17, 4, 7, '#4a3020');
}

function drBuildingWorkshop(g, r, W, H) {
  drawBuilding(g, r, W, H, {
    wall: '#b0a89a', wallDark: '#8a8276',
    roof: '#6e6a62', roofDark: '#565248', roofLight: '#847f75',
    roofH: 12, doorW: 7, doorH: 9,
    windows: [[7, 17]],
  });
  rec(g, 26, 1, 4, 8, '#5a5652');
  rec(g, 25, 1, 6, 2, '#3f3c38');
  // Anvil out front
  rec(g, 5, 27, 5, 2, '#33333b');
  rec(g, 6, 25, 4, 2, '#42424c');
  px(g, 4, 25, '#42424c');
  rec(g, 6, 25, 4, 1, '#5a5a66');
}

function drBuildingBrewery(g, r, W, H) {
  drawBuilding(g, r, W, H, {
    wall: '#a87c50', wallDark: '#84603c',
    roof: '#7a4a28', roofDark: '#5e3820', roofLight: '#96602f',
    roofH: 12, doorW: 7, doorH: 9,
    windows: [[25, 17]],
  });
  // Cauldron out front
  rec(g, 5, 23, 5, 1, '#42424c');
  rec(g, 4, 24, 7, 4, '#33333b');
  rec(g, 5, 23, 5, 1, '#5ee06a');
  px(g, 6, 22, '#8af29a'); px(g, 8, 21, '#8af29a');
  px(g, 4, 28, '#1c1c22'); px(g, 10, 28, '#1c1c22');
  // Barrel beside door
  rec(g, 27, 24, 4, 5, '#8a5e38');
  rec(g, 27, 25, 4, 1, '#4a4a52');
}

function drBuildingShrine(g, r, W, H) {
  const RED = '#c9342a', RED_D = '#96261e';
  rec(g, 2, 26, 24, 4, STONE);
  rec(g, 2, 28, 24, 2, STONE_D);
  // Torii
  rec(g, 5, 9, 3, 18, RED);
  rec(g, 7, 9, 1, 18, RED_D);
  rec(g, 20, 9, 3, 18, RED);
  rec(g, 22, 9, 1, 18, RED_D);
  rec(g, 2, 4, 24, 3, RED);
  rec(g, 2, 6, 24, 1, RED_D);
  px(g, 1, 3, RED); px(g, 26, 3, RED);
  rec(g, 1, 3, 26, 1, '#7a1e16');
  rec(g, 4, 10, 20, 2, RED);
  rec(g, 4, 11, 20, 1, RED_D);
  // Plaque
  rec(g, 12, 7, 4, 4, '#f2e0ba');
  rec(g, 13, 8, 2, 2, '#6e4a2c');
  // Basin
  rec(g, 10, 21, 8, 5, '#8a8a86');
  rec(g, 11, 22, 6, 1, WATER);
  px(g, 12, 22, WATER_L);
  rec(g, 10, 25, 8, 1, '#5f5f5c');
}

function drDerrick(g, r, W, H) {
  const OR = '#e07828', OR_D = '#b45a1a', OR_M = '#c9691f';
  const lx = (y) => Math.round(12 - (9 * (y - 4)) / 38);
  const rx = (y) => Math.round(16 + (9 * (y - 4)) / 38);
  // Cross braces first (behind legs)
  const bars = [10, 18, 26, 34, 41];
  for (let i = 0; i < bars.length - 1; i++) {
    const y0 = bars[i], y1 = bars[i + 1];
    line(g, lx(y0) + 1, y0, rx(y1), y1, OR_D);
    line(g, rx(y0), y0, lx(y1) + 1, y1, OR_D);
  }
  for (const y of bars) rec(g, lx(y) + 1, y, rx(y) - lx(y) + 1, 1, OR_M);
  // Legs
  for (let y = 4; y <= 42; y++) {
    rec(g, lx(y), y, 2, 1, OR);
    px(g, lx(y) + 1, y, y % 2 ? OR : OR_D);
    rec(g, rx(y), y, 2, 1, OR);
    px(g, rx(y) + 1, y, OR_D);
  }
  // Platform + crown + cable
  rec(g, 9, 2, 12, 3, '#a86a34');
  rec(g, 9, 4, 12, 1, '#7c4c22');
  rec(g, 13, 0, 4, 2, '#5a5652');
  rec(g, 14, 5, 1, 16, '#3a3a42');
  rec(g, 13, 21, 3, 2, '#5a5652');
  // Base pads
  rec(g, 1, 42, 6, 2, '#565248');
  rec(g, 23, 42, 6, 2, '#565248');
}

function drContainer(g, r, W, H, col) {
  const D = shade(col, 0.72), L = shade(col, 1.25);
  rec(g, 1, 1, 18, 12, col);
  rec(g, 1, 1, 18, 2, L);
  rec(g, 1, 11, 18, 2, D);
  for (let x = 3; x <= 13; x += 2) rec(g, x, 3, 1, 8, D);
  rec(g, 15, 2, 4, 11, shade(col, 0.9));
  rec(g, 15, 2, 1, 11, D);
  rec(g, 17, 3, 1, 9, shade(col, 0.6));
  px(g, 17, 7, '#e8e8e8');
  rec(g, 1, 1, 1, 12, D);
}

function drBeacon(g, r, W, H) {
  g.fillStyle = alphaCol('#ff5a4a', 0.3);
  g.fillRect(1, 0, 6, 7);
  px(g, 3, 0, '#3a3a42'); px(g, 4, 0, '#3a3a42');
  rec(g, 2, 1, 4, 5, '#3a3a42');
  rec(g, 3, 2, 2, 3, '#ff4a3a');
  px(g, 3, 2, '#ff8a7a');
  rec(g, 3, 6, 2, 8, '#8a8a92');
  rec(g, 4, 6, 1, 8, '#6e6e78');
  rec(g, 3, 10, 2, 1, '#d8443a');
  rec(g, 1, 14, 6, 2, '#4a4a52');
}

function drCoral(g, r, W, H) {
  const cols = ['#e86a8a', '#f2914a', '#a86ae8', '#4ee0d8', '#f2c94a'];
  const pick = () => cols[(r() * cols.length) | 0];
  const c1 = pick();
  let c2 = pick(); if (c2 === c1) c2 = cols[(cols.indexOf(c1) + 2) % cols.length];
  let c3 = pick(); if (c3 === c1 || c3 === c2) c3 = cols[(cols.indexOf(c1) + 1) % cols.length];
  rec(g, 0, 10, 16, 2, '#e0cf9a');
  for (let i = 0; i < 4; i++) px(g, (r() * 16) | 0, 10 + ((r() * 2) | 0), '#c9b47e');
  // Candelabra branch coral
  rec(g, 3, 4, 2, 7, c1);
  rec(g, 1, 3, 1, 4, c1); px(g, 2, 6, c1);
  rec(g, 6, 2, 1, 5, c1); px(g, 5, 7, c1);
  px(g, 3, 3, shade(c1, 1.35)); px(g, 1, 2, shade(c1, 1.35)); px(g, 6, 1, shade(c1, 1.35));
  // Brain blob
  ell(g, 10, 8, 3, 3, c2);
  px(g, 9, 7, shade(c2, 0.7)); px(g, 11, 9, shade(c2, 0.7));
  px(g, 10, 8, shade(c2, 0.7)); px(g, 10, 5, shade(c2, 1.3)); px(g, 9, 6, shade(c2, 1.3));
  // Fan coral
  rec(g, 13, 4 + ((r() * 2) | 0), 2, 7, c3);
  px(g, 12, 4, c3); px(g, 15, 4, c3); px(g, 12, 3, shade(c3, 1.3)); px(g, 15, 3, shade(c3, 1.3));
  px(g, 13, 3, shade(c3, 1.3)); px(g, 14, 2, shade(c3, 1.35));
}

// ---------------------------------------------------------------------------
// Sprite registry
// ---------------------------------------------------------------------------
// ax/ay omitted => bottom-center anchor. no:true => skip outline pass.

const REG = {
  tree_oak: { w: 26, h: 34, draw: drTreeOak },
  tree_pine: { w: 22, h: 36, draw: drTreePine },
  tree_palm: { w: 24, h: 34, draw: drTreePalm },
  tree_dead: { w: 18, h: 28, draw: drTreeDead },
  tree_willow: { w: 28, h: 32, draw: drTreeWillow },
  bush: { w: 14, h: 12, draw: drBush },
  grass_tuft: { w: 10, h: 8, no: true, draw: drGrassTuft },
  flowers: { w: 12, h: 10, no: true, draw: drFlowers },
  cattail: { w: 10, h: 14, no: true, draw: drCattail },
  lilypad: { w: 12, h: 8, ax: 6, ay: 4, draw: drLilypad },
  mushroom_glow: { w: 10, h: 12, draw: drMushroomGlow },
  rock: { w: 14, h: 10, draw: drRock },
  rock_big: { w: 20, h: 14, draw: drRockBig },
  crystal: { w: 16, h: 20, draw: drCrystal },
  house: { w: 46, h: 44, draw: drHouse },
  house_blue: { w: 46, h: 44, draw: drHouseBlue },
  bank: { w: 52, h: 48, draw: drBank },
  shop_bait: { w: 40, h: 40, draw: (g, r, W, H) => drShop(g, r, W, H, '#3f8a3a', '#2f6a2c', '#3a6a8a') },
  shop_attach: { w: 40, h: 40, draw: (g, r, W, H) => drShop(g, r, W, H, '#8a5ac9', '#68409c', '#f28c3a') },
  shop_potion: { w: 40, h: 40, draw: drShopPotion },
  bakery: { w: 40, h: 40, draw: drBakery },
  hall: { w: 50, h: 44, draw: drHall },
  hut: { w: 32, h: 30, draw: drHut },
  windmill: { w: 34, h: 54, draw: drWindmill },
  lighthouse: { w: 22, h: 52, draw: drLighthouse },
  stall_red: { w: 30, h: 26, draw: (g, r, W, H) => drStall(g, r, W, H, '#d84a3a') },
  stall_blue: { w: 30, h: 26, draw: (g, r, W, H) => drStall(g, r, W, H, '#4a74c4') },
  fountain: { w: 30, h: 26, draw: (g, r, W, H) => drFountain(g, r, W, H, 0) },
  fountain_1: { w: 30, h: 26, draw: (g, r, W, H) => drFountain(g, r, W, H, 1) },
  bench: { w: 18, h: 10, draw: drBench },
  lamp: { w: 8, h: 22, draw: drLamp },
  signpost: { w: 14, h: 16, draw: drSignpost },
  noticeboard: { w: 24, h: 20, draw: drNoticeboard },
  crate: { w: 12, h: 12, draw: drCrate },
  barrel: { w: 10, h: 14, draw: drBarrel },
  tent: { w: 22, h: 18, draw: drTent },
  campfire: { w: 14, h: 12, draw: (g, r, W, H) => drCampfire(g, r, W, H, 0) },
  campfire_1: { w: 14, h: 12, draw: (g, r, W, H) => drCampfire(g, r, W, H, 1) },
  ruin_tower: { w: 28, h: 40, draw: drRuinTower },
  bridge_h: { w: 16, h: 20, ax: 8, ay: 10, draw: drBridgeH },
  pier_h: { w: 16, h: 12, ax: 8, ay: 6, draw: drPierH },
  boat: { w: 30, h: 18, draw: drBoat },
  ferry: { w: 40, h: 22, draw: drFerry },
  portal: { w: 28, h: 30, draw: (g, r, W, H) => drPortal(g, r, W, H, false) },
  portal_off: { w: 28, h: 30, draw: (g, r, W, H) => drPortal(g, r, W, H, true) },
  grate: { w: 14, h: 10, ax: 7, ay: 5, draw: drGrate },
  cave_mouth: { w: 26, h: 22, draw: drCaveMouth },
  bobber: { w: 6, h: 6, ax: 3, ay: 3, no: true, draw: drBobber },
  ripple: { w: 12, h: 6, ax: 6, ay: 3, no: true, draw: drRipple },
  hotspot: { w: 16, h: 10, no: true, draw: (g, r, W, H) => drHotspot(g, r, W, H, 0) },
  hotspot_1: { w: 16, h: 10, no: true, draw: (g, r, W, H) => drHotspot(g, r, W, H, 1) },
  plot_pegs: { w: 20, h: 16, draw: drPlotPegs },
  building_farm: { w: 34, h: 26, draw: drBuildingFarm },
  building_workshop: { w: 36, h: 30, draw: drBuildingWorkshop },
  building_brewery: { w: 36, h: 30, draw: drBuildingBrewery },
  building_shrine: { w: 28, h: 30, draw: drBuildingShrine },
  derrick: { w: 30, h: 44, draw: drDerrick },
  container_red: { w: 20, h: 14, draw: (g, r, W, H) => drContainer(g, r, W, H, '#c94a3a') },
  container_blue: { w: 20, h: 14, draw: (g, r, W, H) => drContainer(g, r, W, H, '#3a6ab0') },
  beacon: { w: 8, h: 16, draw: drBeacon },
  coral: { w: 16, h: 12, draw: drCoral },
};

const spriteCache = new Map();

export function getSprite(name, seed = 0) {
  const key = name + ':' + seed;
  let s = spriteCache.get(key);
  if (s) return s;
  const def = REG[name];
  if (!def) {
    // Unknown sprite: loud magenta placeholder so it's obvious in-game.
    const c = makeCanvas(8, 8);
    const g = c.getContext('2d');
    rec(g, 0, 0, 8, 8, '#ff00ff');
    rec(g, 0, 0, 4, 4, '#880088');
    rec(g, 4, 4, 4, 4, '#880088');
    s = { canvas: c, w: 8, h: 8, ax: 4, ay: 7 };
    spriteCache.set(key, s);
    return s;
  }
  const c = makeCanvas(def.w, def.h);
  const g = c.getContext('2d');
  def.draw(g, makeRng(name, seed), def.w, def.h);
  if (!def.no) outlineDarken(c, 0.58);
  s = {
    canvas: c,
    w: def.w,
    h: def.h,
    ax: def.ax !== undefined ? def.ax : def.w >> 1,
    ay: def.ay !== undefined ? def.ay : def.h - 1,
  };
  spriteCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Character sheet
// ---------------------------------------------------------------------------

const FACES = ['down', 'left', 'right', 'up'];
const POSES = ['idle', 'walk1', 'walk2', 'fish'];
const EYE = '#20141c';
const SHOE = '#4e3018';
const ROD = '#7a4a28';

function drawCharFrame(g, ox, oy, face, pose, look) {
  const skin = look.skin, hair = look.hair, shirt = look.shirt, pants = look.pants, hat = look.hat;
  const pantsD = shade(pants, 0.78);
  const shirtD = shade(shirt, 0.8);
  const p = (x, y, c) => px(g, ox + x, oy + y, c);
  const rc = (x, y, w, h, c) => rec(g, ox + x, oy + y, w, h, c);

  // ---- Head ----
  if (hat) {
    rc(4, 1, 8, 3, hat); // crown
    rc(4, 1, 8, 1, shade(hat, 1.2));
    rc(2, 4, 12, 1, shade(hat, 0.75)); // brim
    rc(3, 5, 10, 1, hair); // fringe
  } else {
    rc(3, 2, 10, 3, hair);
    rc(3, 2, 10, 1, shade(hair, 1.2));
    rc(4, 5, 8, 1, hair);
    p(3, 5, hair); p(12, 5, hair);
  }
  if (face === 'up') {
    // Back of head: all hair
    rc(3, hat ? 6 : 5, 10, hat ? 3 : 4, hair);
    rc(4, 9, 8, 1, skin); // neck sliver
  } else {
    const faceTop = hat ? 6 : 6;
    rc(4, faceTop, 8, 10 - faceTop, skin);
    p(3, 6, hair); p(12, 6, hair); // sideburns
    if (face === 'down') { p(5, 7, EYE); p(10, 7, EYE); }
    else if (face === 'left') { p(4, 7, EYE); p(8, 7, EYE); }
    else { p(7, 7, EYE); p(11, 7, EYE); }
  }

  // ---- Torso ----
  rc(5, 10, 6, 7, shirt);
  rc(5, 15, 6, 2, shirtD);
  if (face === 'left') rc(9, 10, 2, 7, shirtD);
  else if (face === 'right') rc(5, 10, 2, 7, shirtD);

  // ---- Arms ----
  const armY = { l: 11, r: 11 };
  if (pose === 'walk1') { armY.l = 12; armY.r = 10; }
  if (pose === 'walk2') { armY.l = 10; armY.r = 12; }
  if (pose !== 'fish') {
    rc(4, armY.l, 1, 1, shirt);
    rc(4, armY.l + 1, 1, 4, skin);
    rc(11, armY.r, 1, 1, shirt);
    rc(11, armY.r + 1, 1, 4, skin);
  }

  // ---- Legs + shoes ----
  rc(5, 17, 6, 2, pants); // hips
  let lOff = 0, rOff = 0, lDx = 0, rDx = 0;
  if (pose === 'walk1') {
    if (face === 'left' || face === 'right') { lDx = face === 'left' ? -1 : 1; rDx = -lDx; }
    else { lOff = -1; }
  } else if (pose === 'walk2') {
    if (face === 'left' || face === 'right') { rDx = face === 'left' ? -1 : 1; lDx = -rDx; }
    else { rOff = -1; }
  }
  rc(5 + lDx, 19, 2, 4 + lOff, pants);
  rc(9 + rDx, 19, 2, 4 + rOff, pants);
  p(6 + lDx, 22 + lOff, pantsD);
  p(10 + rDx, 22 + rOff, pantsD);
  rc(5 + lDx, 23 + lOff, 2, 3 + (lOff ? 1 : 0), SHOE);
  rc(9 + rDx, 23 + rOff, 2, 3 + (rOff ? 1 : 0), SHOE);

  // ---- Fishing pose: both arms toward facing + rod ----
  if (pose === 'fish') {
    if (face === 'down') {
      rc(5, 12, 1, 3, skin); rc(10, 12, 1, 3, skin);
      p(6, 14, skin); p(9, 14, skin);
      const pts = [[10, 16], [10, 17], [11, 18], [11, 19], [12, 20], [12, 21]];
      for (const q of pts) p(q[0], q[1], ROD);
      p(12, 21, shade(ROD, 1.3));
    } else if (face === 'left') {
      rc(3, 11, 2, 2, skin); rc(3, 13, 2, 2, skin);
      const pts = [[2, 11], [2, 10], [1, 9], [1, 8], [0, 7], [0, 6]];
      for (const q of pts) p(q[0], q[1], ROD);
      p(0, 6, shade(ROD, 1.3));
    } else if (face === 'right') {
      rc(11, 11, 2, 2, skin); rc(11, 13, 2, 2, skin);
      const pts = [[13, 11], [13, 10], [14, 9], [14, 8], [15, 7], [15, 6]];
      for (const q of pts) p(q[0], q[1], ROD);
      p(15, 6, shade(ROD, 1.3));
    } else {
      rc(4, 7, 1, 4, skin); rc(11, 7, 1, 4, skin);
      p(12, 8, skin);
      rc(13, 2, 1, 7, ROD);
      p(13, 2, shade(ROD, 1.3));
    }
  }
}

const charCache = new Map();

export function makeCharacterSheet(look) {
  const key = JSON.stringify(look);
  let s = charCache.get(key);
  if (s) return s;
  const fw = 16, fh = 26;
  const c = makeCanvas(fw * 4, fh * 4);
  const g = c.getContext('2d');
  for (let f = 0; f < 4; f++) {
    for (let pcol = 0; pcol < 4; pcol++) {
      drawCharFrame(g, pcol * fw, f * fh, FACES[f], POSES[pcol], look);
    }
  }
  outlineDarken(c, 0.5);
  s = { canvas: c, fw, fh, ax: 8, ay: 25 };
  charCache.set(key, s);
  return s;
}

// ---------------------------------------------------------------------------
// Ground tile textures (16x16, seamlessly tiling)
// ---------------------------------------------------------------------------

function wrapRow(g, x, y, w, c) {
  y = ((y % 16) + 16) % 16;
  for (let i = 0; i < w; i++) {
    const xx = (((x + i) % 16) + 16) % 16;
    px(g, xx, y, c);
  }
}

function speckle(g, r, colors, count) {
  for (let i = 0; i < count; i++) {
    px(g, (r() * 16) | 0, (r() * 16) | 0, colors[(r() * colors.length) | 0]);
  }
}

function tileBase(g, base) {
  rec(g, 0, 0, 16, 16, base);
}

function tileWaterKind(g, r, base, light, dark) {
  tileBase(g, base);
  for (let i = 0; i < 3; i++) {
    const x = (r() * 12) | 0, y = (r() * 16) | 0;
    rec(g, x, y, 2 + ((r() * 2) | 0), 1, light);
  }
  for (let i = 0; i < 2; i++) px(g, (r() * 16) | 0, (r() * 16) | 0, dark);
}

const TILE_DRAWERS = {
  grass(g, r, seed) {
    const bases = ['#57a04a', '#519a45', '#5ca64c'];
    const b = bases[((seed % 3) + 3) % 3];
    tileBase(g, b);
    speckle(g, r, [shade(b, 0.85), shade(b, 0.82)], 14);
    speckle(g, r, [shade(b, 1.15)], 6);
    for (let i = 0; i < 3; i++) rec(g, (r() * 16) | 0, (r() * 15) | 0, 1, 2, shade(b, 0.78));
  },
  grass_cold(g, r) {
    tileBase(g, '#528e77');
    speckle(g, r, ['#457a65', '#41755f'], 14);
    speckle(g, r, ['#66a389'], 6);
    for (let i = 0; i < 3; i++) rec(g, (r() * 16) | 0, (r() * 15) | 0, 1, 2, '#3e6e5a');
  },
  sand(g, r) {
    tileBase(g, '#e8d49a');
    speckle(g, r, ['#d4bc7e'], 9);
    speckle(g, r, ['#f4e4b0'], 6);
  },
  path(g, r) {
    tileBase(g, '#b08a5a');
    speckle(g, r, ['#9c7648', '#a37e50'], 12);
    speckle(g, r, ['#c9a670'], 6);
    for (let i = 0; i < 3; i++) {
      const x = (r() * 15) | 0, y = (r() * 15) | 0;
      px(g, x, y, '#8a6a42'); px(g, x + 1, y, '#c9a670');
    }
  },
  cobble(g, r) {
    tileBase(g, '#6a665e');
    const stones = [[1, 1, 6, 4], [9, 0, 6, 4], [5, 6, 6, 4], [13, 6, 6, 4], [1, 11, 6, 4], [9, 11, 6, 4]];
    const tones = ['#9a948c', '#908a80', '#a39d92'];
    for (let i = 0; i < stones.length; i++) {
      const s = stones[i];
      const tone = tones[i % 3];
      for (let dy = 0; dy < s[3]; dy++) {
        const inset = dy === 0 || dy === s[3] - 1 ? 1 : 0;
        wrapRow(g, s[0] + inset, s[1] + dy, s[2] - inset * 2, dy === s[3] - 1 ? shade(tone, 0.85) : tone);
      }
      wrapRow(g, s[0] + 1, s[1], s[2] - 2, shade(tone, 1.12));
    }
  },
  stone(g, r) {
    tileBase(g, '#8a8a84');
    speckle(g, r, ['#76766f', '#71716a'], 12);
    speckle(g, r, ['#9c9c95'], 6);
    for (let i = 0; i < 2; i++) rec(g, (r() * 13) | 0, (r() * 16) | 0, 3, 1, '#6c6c65');
  },
  snow(g, r) {
    tileBase(g, '#f0f4fa');
    speckle(g, r, ['#dde6f2', '#d6e0ee'], 10);
    speckle(g, r, ['#ffffff'], 5);
  },
  ice(g, r) {
    tileBase(g, '#bcdcec');
    speckle(g, r, ['#cfe8f4'], 8);
    line(g, 3, 12, 8, 5, '#eef8fc');
    line(g, 8, 5, 12, 9, '#eef8fc');
    px(g, 12, 10, '#a8ccdf'); px(g, 4, 13, '#a8ccdf');
  },
  swamp(g, r) {
    tileBase(g, '#5f7042');
    for (let i = 0; i < 4; i++) {
      rec(g, (r() * 13) | 0, (r() * 13) | 0, 2 + ((r() * 2) | 0), 2, '#4e5c36');
    }
    speckle(g, r, ['#6d8050'], 6);
  },
  mud(g, r) {
    tileBase(g, '#7a5a3e');
    for (let i = 0; i < 3; i++) rec(g, (r() * 13) | 0, (r() * 14) | 0, 3, 2, '#654a30');
    speckle(g, r, ['#8c6c4c'], 6);
  },
  redrock(g, r) {
    tileBase(g, '#b05a3c');
    speckle(g, r, ['#94482e', '#8e442b'], 12);
    speckle(g, r, ['#c9724c'], 6);
    for (let i = 0; i < 2; i++) rec(g, (r() * 13) | 0, (r() * 16) | 0, 3, 1, '#8a3f27');
  },
  ash(g, r) {
    tileBase(g, '#5a524e');
    speckle(g, r, ['#4a443f', '#463f3b'], 12);
    speckle(g, r, ['#6a615c'], 6);
  },
  water(g, r) {
    tileWaterKind(g, r, '#4795c4', '#7cc4e2', '#3a7ba6');
  },
  water_deep(g, r) {
    tileWaterKind(g, r, '#2e6b94', '#4a90b8', '#265a7e');
  },
  water_swamp(g, r) {
    tileWaterKind(g, r, '#5a6e46', '#77895b', '#4a5c3a');
  },
  water_sewer(g, r) {
    tileWaterKind(g, r, '#4a7a52', '#6a9a6a', '#3c6644');
  },
  wood(g, r) {
    tileBase(g, '#a97b50');
    for (let p = 0; p < 4; p++) {
      if (p % 2) rec(g, 0, p * 4, 16, 3, '#a1734a');
      rec(g, 0, p * 4 + 3, 16, 1, '#7c5836');
    }
    px(g, 5, 0, '#7c5836'); px(g, 5, 1, '#7c5836'); px(g, 5, 2, '#7c5836');
    px(g, 12, 4, '#7c5836'); px(g, 12, 5, '#7c5836'); px(g, 12, 6, '#7c5836');
    px(g, 2, 8, '#7c5836'); px(g, 2, 9, '#7c5836'); px(g, 2, 10, '#7c5836');
    px(g, 9, 12, '#7c5836'); px(g, 9, 13, '#7c5836'); px(g, 9, 14, '#7c5836');
    speckle(g, r, ['#93673f'], 4);
  },
  metal(g, r) {
    tileBase(g, '#788088');
    speckle(g, r, ['#6a727a'], 10);
    speckle(g, r, ['#868e96'], 6);
    const riv = [[3, 3], [12, 3], [3, 12], [12, 12]];
    for (const q of riv) {
      px(g, q[0], q[1], '#9aa4ae');
      px(g, q[0] + 1, q[1] + 1, '#565e66');
    }
  },
  brick(g, r) {
    for (let y = 0; y < 16; y++) {
      if (y % 4 === 3) {
        rec(g, 0, y, 16, 1, '#3f443c');
      } else {
        const band = (y / 4) | 0;
        rec(g, 0, y, 16, 1, band % 2 ? '#6a634f' : '#716a56');
        const joints = band % 2 ? [4, 12] : [0, 8];
        for (const jx of joints) px(g, jx, y, '#3f443c');
      }
    }
    speckle(g, r, ['#5e5846'], 6);
    speckle(g, r, ['#5e7a4a'], 2);
  },
  cave_floor(g, r) {
    tileBase(g, '#4e4640');
    speckle(g, r, ['#403a34', '#3c3630'], 12);
    speckle(g, r, ['#5c534c'], 6);
    for (let i = 0; i < 2; i++) rec(g, (r() * 14) | 0, (r() * 16) | 0, 2, 1, '#372f2a');
  },
};

const tileCache = new Map();

export function tileTexture(kind, seed = 0) {
  const key = kind + ':' + seed;
  let c = tileCache.get(key);
  if (c) return c;
  c = makeCanvas(16, 16);
  const g = c.getContext('2d');
  const fn = TILE_DRAWERS[kind];
  if (fn) {
    fn(g, makeRng('tile:' + kind, seed), seed);
  } else {
    rec(g, 0, 0, 16, 16, '#ff00ff');
    rec(g, 0, 0, 8, 8, '#880088');
    rec(g, 8, 8, 8, 8, '#880088');
  }
  tileCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Water edge overlays
// ---------------------------------------------------------------------------

let edgeCache = null;

export function edgeOverlays() {
  if (edgeCache) return edgeCache;
  const foam = makeCanvas(16, 16);
  {
    const g = foam.getContext('2d');
    const r = makeRng('foam', 1);
    for (let x = 0; x < 16; x++) {
      if (x === 0 || x === 15 || r() < 0.85) px(g, x, 0, '#eefcff');
      if (r() < 0.55) px(g, x, 1, '#d8f2fa');
      if (r() < 0.16) px(g, x, 2, '#d8f2fa');
    }
  }
  const sandLip = makeCanvas(16, 16);
  {
    const g = sandLip.getContext('2d');
    const r = makeRng('sandLip', 1);
    rec(g, 0, 0, 16, 1, '#eedca6');
    for (let x = 0; x < 16; x++) {
      if (r() < 0.6) px(g, x, 1, '#e2c98e');
      if (r() < 0.15) px(g, x, 2, '#d8bc7c');
    }
  }
  edgeCache = { foam, sandLip };
  return edgeCache;
}
