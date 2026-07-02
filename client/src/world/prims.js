// Low-poly primitive builders for the world. All flat-shaded, cozy.
import * as THREE from '../../vendor/three.module.js';
import { hash2 } from '../core/util.js';

export const MAT = {};
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!MAT[key]) MAT[key] = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  return MAT[key];
}
export function emissiveMat(color, intensity = 0.9) {
  const key = 'em' + color + intensity;
  if (!MAT[key]) MAT[key] = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: intensity });
  return MAT[key];
}

function m(geo, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------- vegetation ----------
export function makeTree(kind = 'oak', seed = 1) {
  const g = new THREE.Group();
  const r = (n) => hash2(seed, n);
  const s = 0.8 + r(1) * 0.6;
  if (kind === 'pine') {
    g.add(m(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2.2 * s, 5), mat('#6e4a2e'), 0, 1.1 * s, 0));
    for (let i = 0; i < 3; i++) {
      g.add(m(new THREE.ConeGeometry((2.1 - i * 0.55) * s, 2.2 * s, 6), mat(i % 2 ? '#2e6b46' : '#35754e'), 0, (2.2 + i * 1.25) * s, 0));
    }
  } else if (kind === 'palm') {
    const trunk = m(new THREE.CylinderGeometry(0.18 * s, 0.3 * s, 4.5 * s, 5), mat('#8a6642'), 0, 2.25 * s, 0);
    trunk.rotation.z = (r(2) - 0.5) * 0.35;
    g.add(trunk);
    const top = new THREE.Group();
    top.position.set(trunk.rotation.z * -4.5 * s, 4.4 * s, 0);
    for (let i = 0; i < 5; i++) {
      const frond = m(new THREE.ConeGeometry(0.5 * s, 3 * s, 4), mat('#3d8f57'));
      frond.rotation.z = Math.PI / 2.4;
      frond.rotation.y = (i / 5) * Math.PI * 2;
      frond.translateY(1.2 * s);
      top.add(frond);
    }
    g.add(top);
  } else if (kind === 'dead') {
    const trunk = m(new THREE.CylinderGeometry(0.15 * s, 0.35 * s, 3.4 * s, 5), mat('#5d5248'), 0, 1.7 * s, 0);
    trunk.rotation.z = (r(3) - 0.5) * 0.3;
    g.add(trunk);
    const b1 = m(new THREE.CylinderGeometry(0.07, 0.12, 1.6 * s, 4), mat('#5d5248'), 0.5 * s, 2.6 * s, 0);
    b1.rotation.z = -0.8; g.add(b1);
    const b2 = m(new THREE.CylinderGeometry(0.05, 0.1, 1.2 * s, 4), mat('#5d5248'), -0.4 * s, 2.2 * s, 0.1);
    b2.rotation.z = 0.9; g.add(b2);
  } else if (kind === 'willow') {
    g.add(m(new THREE.CylinderGeometry(0.3 * s, 0.45 * s, 2.6 * s, 6), mat('#6e4a2e'), 0, 1.3 * s, 0));
    g.add(m(new THREE.SphereGeometry(2.2 * s, 7, 5), mat('#5fa06a'), 0, 3.6 * s, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(m(new THREE.CylinderGeometry(0.12 * s, 0.05, 2.4 * s, 4), mat('#549961'), Math.cos(a) * 1.9 * s, 2.6 * s, Math.sin(a) * 1.9 * s));
    }
  } else { // oak
    g.add(m(new THREE.CylinderGeometry(0.3 * s, 0.45 * s, 2 * s, 6), mat('#7a5230'), 0, 1 * s, 0));
    g.add(m(new THREE.IcosahedronGeometry(1.7 * s, 0), mat(r(4) > 0.5 ? '#4a8f4f' : '#57a05a'), 0, 3 * s, 0));
    if (r(5) > 0.5) g.add(m(new THREE.IcosahedronGeometry(1.1 * s, 0), mat('#3f7f45'), 1.1 * s, 2.4 * s, 0.4 * s));
  }
  return g;
}

export function makeRock(seed = 1, scale = 1) {
  const r = hash2(seed, 7);
  const rock = m(new THREE.IcosahedronGeometry((0.5 + r) * scale, 0), mat(r > 0.6 ? '#8d8d85' : '#7b7d76'));
  rock.position.y = 0.3 * scale;
  rock.rotation.set(r * 3, r * 7, r * 5);
  return rock;
}

export function makeCattail(seed = 1) {
  const g = new THREE.Group();
  const n = 2 + Math.floor(hash2(seed, 3) * 3);
  for (let i = 0; i < n; i++) {
    const h = 1 + hash2(seed, i) * 0.8;
    const x = (hash2(seed, i + 10) - 0.5) * 0.8, z = (hash2(seed, i + 20) - 0.5) * 0.8;
    g.add(m(new THREE.CylinderGeometry(0.02, 0.03, h, 4), mat('#5c8a4a'), x, h / 2, z));
    g.add(m(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 5), mat('#6b4a2e'), x, h, z));
  }
  return g;
}

export function makeLilypad(seed = 1) {
  const g = new THREE.Group();
  const pad = m(new THREE.CircleGeometry(0.5 + hash2(seed, 2) * 0.4, 8), mat('#4d9955', { side: THREE.DoubleSide }));
  pad.rotation.x = -Math.PI / 2;
  g.add(pad);
  if (hash2(seed, 5) > 0.7) g.add(m(new THREE.ConeGeometry(0.12, 0.18, 6), mat('#e88fb0'), 0.2, 0.09, 0.1));
  return g;
}

export function makeMushroom(seed = 1) {
  const g = new THREE.Group();
  const s = 0.5 + hash2(seed, 1);
  g.add(m(new THREE.CylinderGeometry(0.08 * s, 0.12 * s, 0.4 * s, 5), mat('#e8dcc8'), 0, 0.2 * s, 0));
  g.add(m(new THREE.SphereGeometry(0.25 * s, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), emissiveMat(hash2(seed, 2) > 0.5 ? '#7fd4c1' : '#c17fd4', 0.5), 0, 0.4 * s, 0));
  return g;
}

// ---------- structures ----------
export function makeHouse({ w = 6, d = 5, h = 3, wall = '#e8d9b8', roof = '#a8543f', door = '#6b4a2e' } = {}) {
  const g = new THREE.Group();
  g.add(m(new THREE.BoxGeometry(w, h, d), mat(wall), 0, h / 2, 0));
  const roofG = new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.8, 4);
  const roofM = m(roofG, mat(roof), 0, h + h * 0.4, 0);
  roofM.rotation.y = Math.PI / 4;
  g.add(roofM);
  g.add(m(new THREE.BoxGeometry(1.1, 1.9, 0.15), mat(door), 0, 0.95, d / 2 + 0.05));
  g.add(m(new THREE.BoxGeometry(1, 1, 0.12), mat('#bcd8e8'), -w / 4, h * 0.55, d / 2 + 0.05));
  g.add(m(new THREE.BoxGeometry(1, 1, 0.12), mat('#bcd8e8'), w / 4, h * 0.55, d / 2 + 0.05));
  return g;
}

export function makeLamp() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.08, 0.12, 3, 6), mat('#3a3f45'), 0, 1.5, 0));
  g.add(m(new THREE.SphereGeometry(0.28, 6, 5), emissiveMat('#ffd98a', 1), 0, 3.1, 0));
  return g;
}

export function makeDock(length = 12, width = 3) {
  const g = new THREE.Group();
  const deck = m(new THREE.BoxGeometry(width, 0.3, length), mat('#8a6642'), 0, 0.8, length / 2);
  g.add(deck);
  for (let i = 0; i <= length; i += 3) {
    g.add(m(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 5), mat('#6e4a2e'), -width / 2 + 0.2, -0.2, i));
    g.add(m(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 5), mat('#6e4a2e'), width / 2 - 0.2, -0.2, i));
  }
  return g;
}

export function makeBridge(length = 20, width = 4) {
  const g = new THREE.Group();
  const deck = m(new THREE.BoxGeometry(length, 0.4, width), mat('#8a6642'), 0, 0.9, 0);
  g.add(deck);
  for (const side of [-1, 1]) {
    g.add(m(new THREE.BoxGeometry(length, 0.12, 0.12), mat('#6e4a2e'), 0, 1.9, side * (width / 2 - 0.1)));
    for (let i = -length / 2 + 1; i < length / 2; i += 2.5) {
      g.add(m(new THREE.BoxGeometry(0.12, 1, 0.12), mat('#6e4a2e'), i, 1.4, side * (width / 2 - 0.1)));
    }
  }
  return g;
}

export function makeBoat(scale = 1) {
  const g = new THREE.Group();
  const hull = m(new THREE.CylinderGeometry(1.4 * scale, 0.9 * scale, 4.6 * scale, 6, 1), mat('#7a5230'));
  hull.rotation.x = Math.PI / 2; hull.rotation.y = Math.PI / 6;
  hull.scale.set(0.7, 1, 0.45);
  hull.position.y = 0.3 * scale;
  g.add(hull);
  g.add(m(new THREE.CylinderGeometry(0.07 * scale, 0.09 * scale, 3.4 * scale, 5), mat('#6e4a2e'), 0, 1.9 * scale, 0));
  const sail = m(new THREE.PlaneGeometry(1.7 * scale, 2.2 * scale), mat('#f2ead4', { side: THREE.DoubleSide }), 0.9 * scale, 2.2 * scale, 0);
  g.add(sail);
  return g;
}

export function makeCrystal(seed = 1, color = '#8fd4f0') {
  const g = new THREE.Group();
  const n = 2 + Math.floor(hash2(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const h = 0.8 + hash2(seed, i + 2) * 1.8;
    const c = m(new THREE.ConeGeometry(0.25 + hash2(seed, i + 9) * 0.2, h, 5), emissiveMat(color, 0.7),
      (hash2(seed, i + 4) - 0.5) * 1.2, h / 2, (hash2(seed, i + 6) - 0.5) * 1.2);
    c.rotation.z = (hash2(seed, i + 8) - 0.5) * 0.5;
    g.add(c);
  }
  return g;
}

export function makePortal(active = true) {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const stone = m(new THREE.BoxGeometry(0.7, 1.6 + (i % 2) * 0.7, 0.7), mat('#7b7d76'), Math.cos(a) * 2.6, 0.8, Math.sin(a) * 2.6);
    stone.rotation.y = -a;
    g.add(stone);
  }
  if (active) {
    const ring = m(new THREE.TorusGeometry(1.6, 0.12, 6, 24), emissiveMat('#7fd4c1', 1), 0, 2.2, 0);
    g.add(ring);
    const disc = m(new THREE.CircleGeometry(1.5, 24), new THREE.MeshBasicMaterial({ color: '#aef0e4', transparent: true, opacity: 0.55, side: THREE.DoubleSide }), 0, 2.2, 0);
    g.add(disc);
    g.userData.animate = (t) => { ring.rotation.z = t * 0.6; disc.material.opacity = 0.45 + Math.sin(t * 2) * 0.15; };
  }
  return g;
}

export function makeCampfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(m(new THREE.IcosahedronGeometry(0.22, 0), mat('#7b7d76'), Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6));
  }
  const log1 = m(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 5), mat('#5d4430'), 0, 0.15, 0);
  log1.rotation.z = Math.PI / 2; g.add(log1);
  g.add(m(new THREE.ConeGeometry(0.3, 0.7, 6), emissiveMat('#ff9a3c', 1), 0, 0.45, 0));
  g.userData.animate = (t) => { g.children[g.children.length - 1].scale.y = 0.85 + Math.sin(t * 9) * 0.2; };
  return g;
}

export function makeBarrel() {
  return m(new THREE.CylinderGeometry(0.45, 0.45, 1, 8), mat('#8a6642'), 0, 0.5, 0);
}

export function makeCrate() {
  return m(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat('#a87a4a'), 0, 0.45, 0);
}

export function makeSignpost() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 5), mat('#6e4a2e'), 0, 0.8, 0));
  g.add(m(new THREE.BoxGeometry(1.6, 0.7, 0.1), mat('#8a6642'), 0, 1.5, 0));
  return g;
}

export function makeCoral(seed = 1) {
  const g = new THREE.Group();
  const colors = ['#ff7a8a', '#ffb86b', '#c17fd4', '#6be0d0', '#ffe27a'];
  const n = 3 + Math.floor(hash2(seed, 1) * 4);
  for (let i = 0; i < n; i++) {
    const c = colors[Math.floor(hash2(seed, i + 3) * colors.length)];
    const kind = hash2(seed, i + 11);
    const x = (hash2(seed, i + 5) - 0.5) * 2, z = (hash2(seed, i + 7) - 0.5) * 2;
    if (kind < 0.4) {
      const h = 0.5 + hash2(seed, i) * 1.2;
      g.add(m(new THREE.CylinderGeometry(0.08, 0.15, h, 5), mat(c), x, h / 2, z));
      g.add(m(new THREE.SphereGeometry(0.2, 5, 4), mat(c), x, h, z));
    } else if (kind < 0.7) {
      g.add(m(new THREE.SphereGeometry(0.35 + hash2(seed, i) * 0.3, 6, 4), mat(c), x, 0.3, z));
    } else {
      const f = m(new THREE.ConeGeometry(0.4, 0.9, 4), mat(c), x, 0.45, z);
      f.rotation.z = (hash2(seed, i + 13) - 0.5) * 0.7;
      g.add(f);
    }
  }
  return g;
}

// ---------- text sprites (names, titles, chat bubbles, signs) ----------
export function makeTextSprite(text, { font = 'bold 26px Verdana, sans-serif', color = '#ffffff', bg = null, pad = 8, outline = 'rgba(0,0,0,.9)', maxWidth = 420, scale = 1 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const lines = wrapText(ctx, String(text), maxWidth);
  const lineH = 34;
  const w = Math.min(maxWidth, Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
  const h = lines.length * lineH + pad * 2;
  canvas.width = Math.ceil(w); canvas.height = Math.ceil(h);
  ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = pad + lineH * (i + 0.5);
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 5; ctx.strokeText(line, canvas.width / 2, y); }
    ctx.fillStyle = color;
    ctx.fillText(line, canvas.width / 2, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const u = 0.011 * scale;
  sprite.scale.set(canvas.width * u, canvas.height * u, 1);
  sprite.renderOrder = 999;
  return sprite;
}
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth - 16 && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
