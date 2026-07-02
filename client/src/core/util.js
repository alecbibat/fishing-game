// Core utilities: seeded RNG, value noise, math + DOM helpers.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed = 1337) {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise
export function noise2(x, y, seed = 1337) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise, ~[0,1]
export function fbm(x, y, octaves = 4, seed = 1337) {
  let val = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2(x * freq, y * freq, seed + i * 101);
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return val / norm;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
export const dist2d = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
export const randPick = (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)];
export const randRange = (a, b, rng = Math.random) => a + rng() * (b - a);

export function fmtNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'b';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
  if (n >= 10000) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.floor(n));
}
export function fmtLen(cm) {
  return cm >= 100 ? (cm / 100).toFixed(2) + ' m' : cm.toFixed(1) + ' cm';
}
export function fmtWt(kg) {
  return kg >= 1 ? kg.toFixed(2) + ' kg' : (kg * 1000).toFixed(0) + ' g';
}

// DOM helpers
export const $ = (sel) => document.querySelector(sel);
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'transcendent'];
export const RARITY_COLOR = {
  common: '#9aa5a7', uncommon: '#6cb56e', rare: '#4f8fd3', epic: '#a45fd0',
  legendary: '#e9932c', mythic: '#e04f6f', transcendent: '#46e0d0',
};
export const rarityRank = (r) => RARITY_ORDER.indexOf(r);
