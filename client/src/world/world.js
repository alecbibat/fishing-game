// The world: procedural overworld + interior maps, day cycle, water, hotspots.
import * as THREE from '../../vendor/three.module.js';
import { fbm, hash2, clamp, lerp, smoothstep, dist2d } from '../core/util.js';
import { emit } from '../core/events.js';
import * as P from './prims.js';
import { INTERIORS } from './interiors.js';
import { PORTAL_SPOTS } from '../data/static.js';
import { S, setFlag, visitZone } from '../core/state.js';

const SEED = 20260702;
export const HALF = 800; // world spans [-800, 800]

// ---------------- overworld geography (pure functions) ----------------
const RIVER = [
  [-420, -500], [-300, -350], [-180, -260], [-60, -180], [20, -40],
  [0, 100], [-30, 300], [-10, 520], [0, 700],
];
function distToRiver(x, z) {
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, dist2d(x, z, ax + dx * t, az + dz * t));
  }
  return best;
}
const gauss = (x, z, cx, cz, sigma) => Math.exp(-(dist2d(x, z, cx, cz) ** 2) / (2 * sigma * sigma));

export function overworldHeight(x, z) {
  let h = fbm(x * 0.0022, z * 0.0022, 4, SEED) * 26 - 6;
  // mountains
  h += gauss(x, z, -420, -560, 280) * 52 * (0.65 + fbm(x * 0.008, z * 0.008, 3, SEED + 5));
  h += gauss(x, z, 600, -120, 200) * 42 * (0.7 + fbm(x * 0.009, z * 0.009, 3, SEED + 9));
  // keep-in rims (not on south ocean side)
  h += smoothstep(-560, -790, z) * 34;
  h += smoothstep(640, 790, Math.abs(x)) * 26 * (1 - smoothstep(380, 520, z));
  // swamp flats
  const sw = gauss(x, z, -520, 80, 150);
  h = lerp(h, 0.7 + (fbm(x * 0.02, z * 0.02, 2, SEED + 3) - 0.5) * 4.4, Math.min(1, sw * 1.6));
  // lake + ponds
  h -= gauss(x, z, 380, -320, 140) * 34;
  h -= gauss(x, z, -320, 260, 55) * 10;
  h -= gauss(x, z, -390, 170, 40) * 9;
  h -= gauss(x, z, -245, 345, 45) * 9;
  // glacier crater lake + volcanic pools (flatten-carve so they always hold water)
  h -= gauss(x, z, -425, -565, 62) * 46;
  h = lerp(h, 9, smoothstep(42, 14, dist2d(x, z, 585, -95)));
  h = lerp(h, 10, smoothstep(34, 11, dist2d(x, z, 632, -162)));
  // town & docks flatten
  h = lerp(h, 4, smoothstep(175, 95, dist2d(x, z, 0, 100)));
  h = lerp(h, 3, smoothstep(120, 55, dist2d(x, z, 480, 420)));
  // ocean to the south
  h = lerp(h, -20, smoothstep(430, 640, z));
  // river carve (keeps deeper of ocean/river)
  const rd = distToRiver(x, z);
  if (rd < 26) h = Math.min(h, lerp(-4.5, h, smoothstep(9, 26, rd)));
  return h;
}
export function overworldWaterLevel(x, z) {
  if (dist2d(x, z, -425, -565) < 85) return 26;
  if (dist2d(x, z, 585, -95) < 42 || dist2d(x, z, 632, -162) < 34) return 14;
  return 0;
}
export function overworldBiome(x, z) {
  if (dist2d(x, z, -425, -565) < 85) return 'glacier';
  if (dist2d(x, z, 585, -95) < 42 || dist2d(x, z, 632, -162) < 34) return 'volcanic';
  if (dist2d(x, z, -520, 80) < 175) return 'swamp';
  if (dist2d(x, z, -320, 260) < 75 || dist2d(x, z, -390, 170) < 55 || dist2d(x, z, -245, 345) < 60) return 'pond';
  if (dist2d(x, z, 0, 100) < 170) return 'harbor';
  if (dist2d(x, z, 480, 420) < 115) return 'harbor';
  if (distToRiver(x, z) < 28) return 'river';
  if (dist2d(x, z, 380, -320) < 200) return 'lake';
  if (z > 420) return 'coast';
  return 'lake';
}
const ZONE_CENTERS = [
  ['town', 0, 100, 170], ['docks', 480, 420, 115], ['swamp', -520, 80, 180],
  ['glacier', -420, -560, 170], ['volcanic', 600, -120, 195], ['pond', -320, 260, 150],
  ['lake', 380, -320, 205],
];
export function overworldZone(x, z) {
  for (const [id, cx, cz, r] of ZONE_CENTERS) if (dist2d(x, z, cx, cz) < r) return id;
  if (z > 430) return 'coast';
  if (distToRiver(x, z) < 45) return 'river';
  let best = 'river', bd = 1e9;
  for (const [id, cx, cz] of ZONE_CENTERS) {
    const d = dist2d(x, z, cx, cz);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

// terrain vertex color
function groundColor(x, z, h, wl) {
  const biome = overworldBiome(x, z);
  const n = fbm(x * 0.01, z * 0.01, 2, SEED + 77);
  let c;
  if (h < wl - 6) c = [0.13, 0.22, 0.28];
  else if (h < wl + 0.3) {
    c = biome === 'swamp' ? [0.32, 0.3, 0.2] : biome === 'volcanic' ? [0.4, 0.28, 0.2] : [0.85, 0.76, 0.55];
  } else if (h < wl + 1.6) {
    c = biome === 'swamp' ? [0.36, 0.35, 0.24] : biome === 'volcanic' ? [0.48, 0.32, 0.22] : [0.88, 0.8, 0.58];
  } else if (h > 46) c = [0.92, 0.94, 0.96];
  else if (h > 27) c = [0.52, 0.52, 0.5];
  else {
    switch (biome) {
      case 'swamp': c = [0.33, 0.42, 0.27]; break;
      case 'volcanic': c = [0.5, 0.34, 0.24]; break;
      case 'glacier': c = [0.72, 0.8, 0.82]; break;
      case 'harbor': {
        const town = dist2d(x, z, 0, 100) < 150;
        c = town ? [0.66, 0.63, 0.56] : [0.46, 0.62, 0.34];
        break;
      }
      default: c = [0.44, 0.63, 0.34];
    }
    c = c.map((v) => v * (0.88 + n * 0.24));
  }
  return c;
}

// ---------------- geometry merge helper ----------------
export function bakeGroup(group) {
  // returns [{geo (non-indexed, vertex-colored, transformed to group space)}]
  group.updateMatrixWorld(true);
  const out = [];
  group.traverse((node) => {
    if (!node.isMesh) return;
    let g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    g = g.clone();
    g.applyMatrix4(node.matrixWorld);
    const color = node.material.color || new THREE.Color('#ffffff');
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.push(g);
  });
  return out;
}
export function mergeGeometries(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), norm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, off * 3);
    norm.set(g.attributes.normal.array, off * 3);
    col.set(g.attributes.color.array, off * 3);
    off += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const STATIC_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
export function placeMerged(items) {
  // items: [{proto: THREE.Group|geos, x, y, z, ry, s}]
  const all = [];
  const protoCache = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const it of items) {
    let geos = protoCache.get(it.proto);
    if (!geos) { geos = bakeGroup(it.proto); protoCache.set(it.proto, geos); }
    q.setFromAxisAngle(up, it.ry || 0);
    m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s || 1, it.s || 1, it.s || 1));
    for (const g of geos) {
      const c = g.clone();
      c.applyMatrix4(m4);
      all.push(c);
    }
  }
  if (!all.length) return null;
  return new THREE.Mesh(mergeGeometries(all), STATIC_MAT);
}

// ---------------- water material ----------------
export function makeWater(width, depth, color, opacity = 0.82) {
  const geo = new THREE.PlaneGeometry(width, depth, Math.min(96, width / 12 | 0 || 8), Math.min(96, depth / 12 | 0 || 8));
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color, transparent: true, opacity, shininess: 120,
    specular: new THREE.Color('#bfeeff'), flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const base = geo.attributes.position.array.slice();
  mesh.userData.animate = (t) => {
    const p = geo.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      p[i + 1] = Math.sin(t * 1.1 + base[i] * 0.05 + base[i + 2] * 0.07) * 0.22
        + Math.sin(t * 0.7 + base[i + 2] * 0.045) * 0.14;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return mesh;
}

// ---------------- World class ----------------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.animated = [];
    this.map = null;
    this.mapId = null;
    this.hotspots = [];
    this.hotspotTimer = 0;
    this.dayLength = 1200; // seconds per full day
    this.gameTime = 0.35;  // start mid-morning

    this.hemi = new THREE.HemisphereLight('#cfe8ef', '#5a6b4a', 0.9);
    this.sun = new THREE.DirectionalLight('#fff4d6', 1.2);
    this.sun.position.set(120, 180, 80);
    scene.add(this.hemi, this.sun);
    this.fog = new THREE.Fog('#bfe3e0', 180, 700);
    scene.fog = this.fog;
  }

  timeKey() {
    const t = this.gameTime % 1;
    if (t > 0.27 && t < 0.72) return 'day';
    if ((t > 0.2 && t <= 0.27) || (t >= 0.72 && t < 0.8)) return 'dawnDusk';
    return 'night';
  }
  clockLabel() {
    const t = this.timeKey();
    return t === 'day' ? '☀️ Day' : t === 'night' ? '🌙 Night' : '🌅 Dusk';
  }

  loadMap(id, spawnHint = null) {
    // clear old
    this.group.clear();
    this.animated = [];
    this.hotspots = [];
    this.mapId = id;
    const isInterior = id !== 'overworld';
    if (isInterior) {
      const builder = INTERIORS[id];
      this.map = builder(this.group, this, { placeMerged, makeWater, bakeGroup });
      const mood = this.map.mood || {};
      const bg = new THREE.Color(mood.bg || '#9fd8e8');
      this.scene.background = bg;
      this._skyCur = bg.clone();
      this.fog.color.copy(bg);
      this.fog.near = mood.fogNear ?? 60;
      this.fog.far = mood.fogFar ?? 400;
      this.hemi.color.set(mood.hemi || '#cfe8ef');
      this.hemi.intensity = mood.hemiI ?? 0.9;
      this.sun.intensity = mood.sunI ?? 1.0;
      this.sun.position.set(120, 180, 80);
    } else {
      this.fog.near = 180; this.fog.far = 700;
      this.map = this.buildOverworld();
    }
    for (const a of this.map.animated || []) this.animated.push(a);
    let sp = spawnHint || this.map.spawn;
    if (!this.walkableAt(sp.x, sp.z)) sp = this.map.spawn;
    visitZone(this.map.zone ? this.map.zone(sp.x, sp.z) : id);
    if (this.map.flag) setFlag(this.map.flag);
    return sp;
  }

  // ---- queries ----
  heightAt(x, z) { return this.map.ground(x, z); }
  waterLevelAt(x, z) { return this.map.water(x, z); }
  isWaterAt(x, z) { return this.map.ground(x, z) < this.map.water(x, z) - 0.15; }
  biomeAt(x, z) { return this.map.biome(x, z); }
  zoneAt(x, z) { return this.map.zone ? this.map.zone(x, z) : this.mapId; }
  walkableAt(x, z) {
    if (!this.map.inBounds(x, z)) return false;
    if (this.onPlatform(x, z)) return true;
    if (this.map.ground(x, z) < this.map.water(x, z) - 0.45) return false;
    for (const b of this.map.blockers || []) {
      if (dist2d(x, z, b.x, b.z) < b.r) return false;
    }
    return true;
  }
  surfaceYAt(x, z) {
    // where the player stands (docks/platforms override ground)
    for (const p of this.map.platforms || []) {
      if (x > p.x1 && x < p.x2 && z > p.z1 && z < p.z2) return p.y;
    }
    return Math.max(this.map.ground(x, z), this.map.water(x, z) - 0.35);
  }
  onPlatform(x, z) {
    for (const p of this.map.platforms || []) if (x > p.x1 && x < p.x2 && z > p.z1 && z < p.z2) return true;
    return false;
  }
  hotspotAt(x, z) {
    return this.hotspots.some((h) => dist2d(x, z, h.x, h.z) < h.r);
  }
  interactables() { return this.map.interactables || []; }

  // ---- per-frame ----
  update(dt, t) {
    for (const a of this.animated) a.userData.animate?.(t, dt);
    // day cycle (interiors keep their mood lighting but time still passes)
    this.gameTime = (this.gameTime + dt / this.dayLength) % 1;
    if (this.mapId === 'overworld') this.applySky();
    // hotspots
    this.hotspotTimer -= dt;
    if (this.hotspotTimer <= 0) {
      this.hotspotTimer = 45;
      this.refreshHotspots();
    }
    for (const h of this.hotspots) h.mesh?.userData.animate?.(t, dt);
  }

  applySky() {
    const tt = this.gameTime;
    const dayC = new THREE.Color('#9fd8e8'), duskC = new THREE.Color('#f2b98a'), nightC = new THREE.Color('#16243c');
    let sky, sunI, hemiI;
    const k = this.timeKey();
    if (k === 'day') { sky = dayC; sunI = 1.15; hemiI = 0.9; }
    else if (k === 'dawnDusk') { sky = duskC; sunI = 0.75; hemiI = 0.65; }
    else { sky = nightC; sunI = 0.12; hemiI = 0.32; }
    this._skyCur = this._skyCur || sky.clone();
    this._skyCur.lerp(sky, 0.02);
    this.scene.background = this._skyCur;
    this.fog.color.copy(this._skyCur);
    this.sun.intensity = lerp(this.sun.intensity, sunI, 0.02);
    this.hemi.intensity = lerp(this.hemi.intensity, hemiI, 0.02);
    const ang = tt * Math.PI * 2 - Math.PI / 2;
    this.sun.position.set(Math.cos(ang) * 200, Math.sin(ang) * 220 + 40, 80);
  }

  refreshHotspots() {
    if (!this.map.hotspotAreas) return;
    while (this.hotspots.length > 3) {
      const h = this.hotspots.shift();
      h.mesh && this.group.remove(h.mesh);
    }
    const area = this.map.hotspotAreas[Math.floor(Math.random() * this.map.hotspotAreas.length)];
    for (let tries = 0; tries < 24; tries++) {
      const x = area.x + (Math.random() - 0.5) * area.spread;
      const z = area.z + (Math.random() - 0.5) * area.spread;
      if (this.isWaterAt(x, z)) {
        const wl = this.waterLevelAt(x, z);
        const mesh = this.makeHotspotMesh();
        mesh.position.set(x, wl + 0.15, z);
        this.group.add(mesh);
        this.hotspots.push({ x, z, r: 7, mesh });
        break;
      }
    }
  }
  makeHotspotMesh() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4.6, 5.6, 24),
      new THREE.MeshBasicMaterial({ color: '#bff3ec', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    g.add(ring);
    const n = 26;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 8;
      pts[i * 3 + 1] = Math.random() * 1.2;
      pts[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#e8fffb', size: 0.35, transparent: true, opacity: 0.85 }));
    g.add(points);
    g.userData.animate = (t, dt) => {
      ring.material.opacity = 0.35 + Math.sin(t * 3) * 0.18;
      ring.scale.setScalar(1 + Math.sin(t * 2) * 0.06);
      const p = pg.attributes.position.array;
      for (let i = 0; i < n; i++) {
        p[i * 3 + 1] += dt * (0.6 + (i % 5) * 0.2);
        if (p[i * 3 + 1] > 1.4) p[i * 3 + 1] = 0;
      }
      pg.attributes.position.needsUpdate = true;
    };
    return g;
  }

  // ---------------- OVERWORLD ----------------
  buildOverworld() {
    const group = this.group;
    // terrain
    const SEGS = 220;
    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, SEGS, SEGS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = overworldHeight(x, z);
      pos.setY(i, h);
      const wl = overworldWaterLevel(x, z);
      const c = groundColor(x, z, h, wl);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    group.add(terrain);

    // water planes
    const sea = makeWater(HALF * 2 + 400, HALF * 2 + 400, '#3e8f96');
    sea.position.y = 0;
    group.add(sea);
    const glacierLake = makeWater(180, 180, '#7ccfe0', 0.85);
    glacierLake.position.set(-425, 26, -565);
    group.add(glacierLake);
    const springs = makeWater(160, 160, '#5fb8a8', 0.85);
    springs.position.set(600, 14, -120);
    group.add(springs);
    this.animated.push(sea, glacierLake, springs);

    // scatter props (merged into few draw calls)
    const items = [];
    const protos = {
      oak: P.makeTree('oak', 1), oak2: P.makeTree('oak', 2), pine: P.makeTree('pine', 3),
      pine2: P.makeTree('pine', 4), palm: P.makeTree('palm', 5), dead: P.makeTree('dead', 6),
      willow: P.makeTree('willow', 7), rock: P.makeRock(8), rock2: P.makeRock(9, 1.8),
      cattail: P.makeCattail(10), lily: P.makeLilypad(11),
    };
    for (let gx = -HALF + 12; gx < HALF; gx += 22) {
      for (let gz = -HALF + 12; gz < HALF; gz += 22) {
        const r = hash2(gx, gz, SEED + 21);
        const x = gx + (hash2(gx, gz, 1) - 0.5) * 18;
        const z = gz + (hash2(gx, gz, 2) - 0.5) * 18;
        const h = overworldHeight(x, z);
        const wl = overworldWaterLevel(x, z);
        const zone = overworldZone(x, z);
        const nearTown = dist2d(x, z, 0, 100) < 180 || dist2d(x, z, 480, 420) < 120;
        // water edge deco
        if (h > wl - 0.4 && h < wl + 0.6 && (zone === 'pond' || zone === 'swamp') && r > 0.45) {
          items.push({ proto: protos.cattail, x, y: h, z, ry: r * 6, s: 1 });
          continue;
        }
        if (h < wl - 0.2 && h > wl - 2 && (zone === 'pond' || zone === 'swamp') && r > 0.7) {
          items.push({ proto: protos.lily, x, y: wl + 0.05, z, ry: r * 6, s: 1 });
          continue;
        }
        if (h < wl + 0.8 || nearTown) continue;
        if (h > 42) {
          if (r > 0.82) items.push({ proto: r > 0.92 ? protos.rock2 : protos.rock, x, y: h - 0.2, z, ry: r * 6, s: 1 + r });
          continue;
        }
        const forest = fbm(x * 0.004, z * 0.004, 2, SEED + 31);
        const density = forest > 0.55 ? 0.4 : 0.72;
        if (r < density) continue;
        if (distToRiver(x, z) < 30) continue;
        let proto;
        if (zone === 'glacier' || z < -420) proto = r > 0.86 ? protos.pine2 : protos.pine;
        else if (zone === 'swamp') proto = r > 0.75 ? protos.willow : protos.dead;
        else if (zone === 'volcanic') { if (r < 0.9) continue; proto = protos.dead; }
        else if (z > 380) proto = protos.palm;
        else if (zone === 'pond') proto = r > 0.8 ? protos.willow : protos.oak;
        else proto = r > 0.88 ? protos.pine : (r > 0.6 ? protos.oak2 : protos.oak);
        items.push({ proto, x, y: h - 0.15, z, ry: r * 6.28, s: 0.8 + r * 0.7 });
        if (r > 0.93) items.push({ proto: protos.rock, x: x + 6, y: overworldHeight(x + 6, z), z, ry: r, s: 0.8 });
      }
    }
    const blockers = [];

    // ---- town ----
    const town = [
      { proto: P.makeHouse({ w: 9, d: 7, h: 4.4, wall: '#e8ddc4', roof: '#4f7a8a' }), x: 30, z: 52, ry: Math.PI, tag: 'bank' },
      { proto: P.makeHouse({ w: 7, d: 6, wall: '#e0c9a8', roof: '#a8543f' }), x: -38, z: 48, ry: Math.PI * 0.9, tag: 'general' },
      { proto: P.makeHouse({ w: 6, d: 5, wall: '#d4e0c4', roof: '#6b8f4a' }), x: -66, z: 128, ry: Math.PI / 2, tag: 'bait' },
      { proto: P.makeHouse({ w: 6, d: 5, wall: '#d8c8e0', roof: '#7a5fa0' }), x: 66, z: 132, ry: -Math.PI / 2, tag: 'attachments' },
      { proto: P.makeHouse({ w: 6, d: 5, wall: '#c8dce0', roof: '#3f6b7a' }), x: -24, z: 186, ry: 0, tag: 'potions' },
      { proto: P.makeHouse({ w: 8, d: 6, h: 4, wall: '#eee4cc', roof: '#8a6642' }), x: 44, z: 12, ry: Math.PI, tag: 'hall' },
      { proto: P.makeHouse({ w: 5.5, d: 5, wall: '#f0d8c0', roof: '#c46b4f' }), x: 96, z: 88, ry: -Math.PI / 2, tag: 'bakery' },
      { proto: P.makeHouse({ w: 5, d: 4.5, wall: '#e8d9b8', roof: '#a8543f' }), x: -90, z: 80, ry: Math.PI / 2 },
      { proto: P.makeHouse({ w: 5, d: 4.5, wall: '#dcd0b4', roof: '#8f5f43' }), x: 110, z: 40, ry: -Math.PI / 2 },
      { proto: P.makeHouse({ w: 5, d: 4.5, wall: '#e4d4ac', roof: '#5f7a43' }), x: -70, z: 220, ry: 0.4 },
      { proto: P.makeHouse({ w: 5, d: 4.5, wall: '#e8ccb8', roof: '#7a4343' }), x: 60, z: 226, ry: -0.4 },
    ];
    for (const t of town) {
      const y = overworldHeight(t.x, t.z);
      items.push({ proto: t.proto, x: t.x, y, z: t.z, ry: t.ry || 0, s: 1 });
      blockers.push({ x: t.x, z: t.z, r: 5.2 });
    }
    // lamps, benches, well
    const lampProto = P.makeLamp();
    for (const [lx, lz] of [[10, 70], [-14, 96], [16, 130], [-40, 160], [40, 170], [84, 110], [-8, 30], [470, 400], [492, 436]]) {
      items.push({ proto: lampProto, x: lx, y: overworldHeight(lx, lz), z: lz, ry: 0, s: 1 });
    }
    const crateProto = P.makeCrate(), barrelProto = P.makeBarrel();
    for (const [cx, cz] of [[458, 428], [462, 431], [500, 415], [24, 44], [98, 96]]) {
      items.push({ proto: hash2(cx, cz) > 0.5 ? crateProto : barrelProto, x: cx, y: overworldHeight(cx, cz), z: cz, ry: hash2(cx, cz) * 3, s: 1 });
    }
    // bridges over river
    for (const [bx, bz, ry] of [[-1, -110, 0.32], [-16, 224, 0.1]]) {
      const b = P.makeBridge(26, 4.5);
      items.push({ proto: b, x: bx, y: overworldWaterLevel(bx, bz) + 0.6, z: bz, ry, s: 1 });
    }
    // town canal bridges (walkable)
    for (const [bx, bz] of [[6, 58], [-8, 150]]) {
      const b = P.makeBridge(34, 5);
      items.push({ proto: b, x: bx, y: 0.6, z: bz, ry: 0, s: 1 });
    }
    // lighthouse
    const lh = new THREE.Group();
    {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 16, 10), P.mat('#f0ece0'));
      body.position.y = 8; lh.add(body);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.95, 3, 10), P.mat('#c65b4e'));
      stripe.position.y = 6; lh.add(stripe);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 8), P.mat('#3a3f45'));
      top.position.y = 17; lh.add(top);
    }
    items.push({ proto: lh, x: 150, y: overworldHeight(150, 555), z: 555, ry: 0, s: 1 });
    blockers.push({ x: 150, z: 555, r: 4 });
    const lhLamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), P.emissiveMat('#ffe9a8', 1));
    lhLamp.position.set(150, overworldHeight(150, 555) + 17, 555);
    group.add(lhLamp);

    // docks piers
    for (const [dx, dz, ry] of [[470, 452, 0], [500, 448, 0.2]]) {
      items.push({ proto: P.makeDock(20, 3), x: dx, y: 0, z: dz, ry, s: 1 });
    }
    // ferry boat
    const ferry = P.makeBoat(1.6);
    ferry.position.set(475, 0.2, 478);
    group.add(ferry);
    this.animated.push(ferry);
    ferry.userData.animate = (t) => { ferry.position.y = 0.2 + Math.sin(t * 1.2) * 0.18; ferry.rotation.z = Math.sin(t * 0.9) * 0.03; };

    // sewer grate (behind bakery)
    const grate = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.25, 10), P.mat('#4a4f55'));
    grate.position.set(112, overworldHeight(112, 104) + 0.1, 104);
    group.add(grate);
    // cave door in the mountains
    const caveDoor = new THREE.Group();
    caveDoor.add(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.8, 6, 12, Math.PI), P.mat('#5a5a55')));
    const dark = new THREE.Mesh(new THREE.CircleGeometry(2.4, 12), new THREE.MeshBasicMaterial({ color: '#0a0e12' }));
    caveDoor.add(dark);
    const cdy = overworldHeight(-322, -458);
    caveDoor.position.set(-322, cdy + 0.4, -458);
    caveDoor.rotation.y = Math.PI / 3;
    group.add(caveDoor);

    // portal stone circles
    for (const spot of PORTAL_SPOTS) {
      const active = S.island.spot === spot.id;
      const portal = P.makePortal(active);
      const py = Math.max(overworldHeight(spot.x, spot.z), overworldWaterLevel(spot.x, spot.z));
      portal.position.set(spot.x, py, spot.z);
      group.add(portal);
      if (active) this.animated.push(portal);
      blockers.push({ x: spot.x, z: spot.z, r: 3.4 });
    }

    // signposts at zone gateways
    const signProto = P.makeSignpost();
    for (const [sx, sz] of [[-150, 210], [180, -160], [-330, 40], [-260, -370], [420, -140], [120, 380], [390, 390]]) {
      items.push({ proto: signProto, x: sx, y: overworldHeight(sx, sz), z: sz, ry: hash2(sx, sz) * 6, s: 1 });
    }

    const merged = placeMerged(items);
    if (merged) group.add(merged);

    // campfire cozy spot at lake
    const fire = P.makeCampfire();
    fire.position.set(300, overworldHeight(300, -240), -240);
    group.add(fire);
    this.animated.push(fire);

    // interactables
    const interactables = [
      { x: 112, z: 104, r: 3.5, label: 'Climb into the Old Sewers', action: { type: 'map', target: 'sewer' } },
      { x: -322, z: -458, r: 4.5, label: 'Enter the Glowworm Cavern', action: { type: 'map', target: 'cave' } },
      { x: 470, z: 468, r: 5.5, label: 'Ferry to distant waters', action: { type: 'ferry' } },
      { x: 30, z: 57, r: 4, label: 'Open the Bank', action: { type: 'bank' } },
      { x: -38, z: 53, r: 4, label: 'General Store', action: { type: 'shop', shop: 'general' } },
      { x: -63, z: 124, r: 4, label: 'Bait Shop', action: { type: 'shop', shop: 'bait' } },
      { x: 63, z: 128, r: 4, label: "Tinkerer's Attachments", action: { type: 'shop', shop: 'attachments' } },
      { x: -24, z: 181, r: 4, label: 'Potion Cauldron', action: { type: 'shop', shop: 'potions' } },
    ];
    for (const spot of PORTAL_SPOTS) {
      interactables.push({
        x: spot.x, z: spot.z, r: 4.5,
        label: S.island.spot === spot.id ? 'Step through to your island' : 'A dormant portal circle…',
        action: S.island.spot === spot.id ? { type: 'map', target: 'island' } : { type: 'info', text: 'The Island Broker in Willowbrook can anchor your island portal here.' },
        portalSpot: spot.id,
      });
    }

    return {
      id: 'overworld',
      ground: overworldHeight,
      water: overworldWaterLevel,
      biome: overworldBiome,
      zone: overworldZone,
      inBounds: (x, z) => x > -HALF + 6 && x < HALF - 6 && z > -HALF + 6 && z < HALF - 6,
      spawn: { x: 42, z: 72 },
      interactables,
      blockers,
      platforms: [
        { x1: 468.5, x2: 471.5, z1: 452, z2: 472, y: 0.95 },
        { x1: 498.5, x2: 501.5, z1: 448, z2: 468, y: 0.95 },
        { x1: -11, x2: 23, z1: 55.4, z2: 60.6, y: 1.7 },
        { x1: -25, x2: 9, z1: 147.4, z2: 152.6, y: 1.7 },
      ],
      hotspotAreas: [
        { x: -320, z: 260, spread: 120 }, { x: 380, z: -320, spread: 220 },
        { x: -40, z: -120, spread: 160 }, { x: 200, z: 540, spread: 260 },
        { x: -520, z: 80, spread: 200 }, { x: 0, z: 100, spread: 160 },
      ],
      animated: [],
    };
  }
}
