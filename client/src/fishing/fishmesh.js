// ---------------------------------------------------------------------------
// fishmesh.js — procedural low-poly fish meshes for Driftwood Isles
//
// Exports:
//   makeFishMesh(fish, detail)        -> THREE.Group (1.0 unit long on X, head +X)
//   makeEffectParticles(effect, r)    -> THREE.Group with userData.animate(t, dt)
//   fishThumbnailDataUrl(fish, size)  -> PNG data URL (or null if no WebGL)
//
// All randomness is seeded from fish.id, so a species always looks identical.
// No DOM / WebGL access happens at import time — safe to import under node.
// ---------------------------------------------------------------------------

import * as THREE from '../../vendor/three.module.js';

/* ============================== deterministic rng ============================== */

function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const frac = (v) => v - Math.floor(v);
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ============================== geometry helpers ============================== */

// Triangle-fan geometry in the XY plane from a list of [x, y] points (fan root = points[0]).
function triFan(points) {
  const pos = [];
  for (let i = 1; i < points.length - 1; i++) {
    pos.push(
      points[0][0], points[0][1], 0,
      points[i][0], points[i][1], 0,
      points[i + 1][0], points[i + 1][1], 0
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Fish body "spindle": rings of vertices along X (tail at -0.5, nose at +0.5)
// with pointed caps. Non-indexed so flat shading + per-face vertex colors pop.
// rFn(t) gives the base radius, t = 0 (tail) .. 1 (nose).
function buildSpindle(rFn, { stations = 10, radial = 7, sy = 1, sz = 1, yOff = null } = {}) {
  const rings = [];
  for (let i = 1; i < stations; i++) {
    const t = i / stations;
    const r = Math.max(0.004, rFn(t));
    const yo = yOff ? yOff(t) : 0;
    const ring = [];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      ring.push([-0.5 + t, Math.cos(a) * r * sy + yo, Math.sin(a) * r * sz]);
    }
    rings.push(ring);
  }
  const tailTip = [-0.5, yOff ? yOff(0) : 0, 0];
  const noseTip = [0.5, yOff ? yOff(1) : 0, 0];
  const pos = [];
  const push = (p) => pos.push(p[0], p[1], p[2]);
  const R = radial;
  for (let j = 0; j < R; j++) { // tail cap
    push(rings[0][(j + 1) % R]); push(rings[0][j]); push(tailTip);
  }
  for (let i = 0; i < rings.length - 1; i++) { // bands
    for (let j = 0; j < R; j++) {
      const A = rings[i][j], B = rings[i][(j + 1) % R];
      const C = rings[i + 1][(j + 1) % R], D = rings[i + 1][j];
      push(A); push(B); push(D);
      push(B); push(C); push(D);
    }
  }
  const L = rings[rings.length - 1];
  for (let j = 0; j < R; j++) { // nose cap
    push(L[j]); push(L[(j + 1) % R]); push(noseTip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Paint vertex colors onto any geometry. colorize(t, ny, ang, outColor):
//   t   = 0..1 along local X (tail -> nose)
//   ny  = -1..1 vertical position (belly -> back)
//   ang = atan2(z, y) angle around the body axis
function applyPatternColors(geometry, colorize) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const p = geometry.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const spanX = Math.max(1e-6, bb.max.x - bb.min.x);
  const maxY = Math.max(1e-6, Math.abs(bb.min.y), Math.abs(bb.max.y));
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    colorize((x - bb.min.x) / spanX, clamp(y / maxY, -1, 1), Math.atan2(z, y), c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

/* ============================== patterns & materials ============================== */

function makePatternColorizer(fish, rng) {
  const cols = fish.colors || {};
  const body = new THREE.Color(cols.body || '#5f9ea0');
  const belly = new THREE.Color(cols.belly || '#f2ecd8');
  const accent = new THREE.Color(cols.accent || '#ff9944');
  const pattern = fish.pattern || 'none';

  const stripeN = 4 + Math.floor(rng() * 4);
  const stripePhase = rng();
  const bandN = 2 + Math.floor(rng() * 2);
  const bandPhase = rng() * 0.5;
  const spots = [];
  if (pattern === 'spots' || pattern === 'glowspots') {
    const n = 7 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      spots.push({ t: 0.12 + rng() * 0.72, a: (rng() * 2 - 1) * Math.PI * 0.75, r: 0.13 + rng() * 0.1 });
    }
  }

  return function colorize(t, ny, ang, out) {
    if (pattern === 'gradient') {
      out.copy(body).lerp(belly, clamp((0.65 - ny) / 1.3, 0, 1));
    } else {
      out.copy(body).lerp(belly, clamp((-ny - 0.12) / 0.4, 0, 1)); // belly tint
    }
    if (pattern === 'stripes') {
      if (frac(t * stripeN + stripePhase) < 0.42 && ny > -0.45) out.lerp(accent, 0.8);
    } else if (pattern === 'banded') {
      if (frac(t * bandN + bandPhase) < 0.5) out.lerp(accent, 0.75);
    } else if (pattern === 'spots' || pattern === 'glowspots') {
      for (let k = 0; k < spots.length; k++) {
        const s = spots[k];
        const dt = (t - s.t) * 1.7;
        const da = angDiff(ang, s.a) * 0.42;
        if (dt * dt + da * da < s.r * s.r) {
          out.lerp(accent, pattern === 'glowspots' ? 0.95 : 0.85);
          break;
        }
      }
    }
    return out;
  };
}

function makeBodyMaterial(fish) {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const accent = new THREE.Color((fish.colors && fish.colors.accent) || '#ffffff');
  if (fish.rarity === 'legendary') {
    m.metalness = 0.45; m.roughness = 0.4;
  } else if (fish.rarity === 'mythic') {
    m.emissive = accent.clone(); m.emissiveIntensity = 0.18; m.roughness = 0.55;
  } else if (fish.rarity === 'transcendent') {
    m.emissive = accent.clone(); m.emissiveIntensity = 0.32; m.metalness = 0.3; m.roughness = 0.35;
  }
  if (fish.pattern === 'glowspots') {
    m.emissive = accent.clone();
    m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.12);
  }
  return m;
}

/* ============================== makeFishMesh ============================== */

export function makeFishMesh(fish, detail = 1) {
  const rng = mulberry32(hashString(String((fish && fish.id) || (fish && fish.name) || 'fish')));
  const d = clamp(detail, 0.4, 2);
  const stations = clamp(Math.round(10 * d), 6, 13);
  const radial = clamp(Math.round(7 * d), 5, 8);
  const jit = (v, f = 0.1) => v * (1 + (rng() * 2 - 1) * f);

  const colors = fish.colors || {};
  const colorize = makePatternColorizer(fish, rng);
  const bodyMat = makeBodyMaterial(fish);
  const finMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.fin || '#88bbcc'),
    flatShading: true, side: THREE.DoubleSide,
    roughness: 0.7, transparent: true, opacity: 0.95,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.accent || '#ff9944'),
    flatShading: true, side: THREE.DoubleSide, roughness: 0.7,
  });

  const group = new THREE.Group();
  group.name = 'fish:' + ((fish && fish.id) || '?');
  group.userData.fishId = fish && fish.id;
  const rig = new THREE.Group();
  group.add(rig);

  const type = fish.body || 'standard';
  const bodySurfaces = [];       // meshes glow-dots may stick to
  const eelSegs = [];
  let tail = null;               // wiggled by animate()

  // dims: layout info the fins/eyes/features use.
  const dims = {
    headX: 0.5, tailX: -0.5,
    maxY: 0.14, maxZ: 0.1,
    eyeX: 0.32, eyeY: 0.045, eyeZ: 0.09, eyeR: 0.028, eyeTop: false,
    topY: (x) => 0.1, botY: (x) => -0.1, sideZ: (x) => 0.08,
  };

  const spindleDims = (rFn, sy, sz) => {
    const at = (x) => rFn(clamp(x + 0.5, 0.03, 0.97));
    dims.topY = (x) => at(x) * sy;
    dims.botY = (x) => -at(x) * sy;
    dims.sideZ = (x) => at(x) * sz;
  };

  const addBodyMesh = (geom, colorizeFn) => {
    applyPatternColors(geom, colorizeFn || colorize);
    const mesh = new THREE.Mesh(geom, bodyMat);
    rig.add(mesh);
    bodySurfaces.push(mesh);
    return mesh;
  };

  const addFin = (points, pos, rot, scale = 1, mat = finMat) => {
    const mesh = new THREE.Mesh(triFan(points), mat);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.scale.setScalar(scale);
    rig.add(mesh);
    return mesh;
  };

  const makeTailGroup = (x, y = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, 0);
    return g;
  };
  const tailFin = (tailGroup, points, scale = 1, rot = null) => {
    const mesh = new THREE.Mesh(triFan(points), finMat);
    mesh.scale.setScalar(scale);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    tailGroup.add(mesh);
    return mesh;
  };

  const FAN_TAIL = [[0, 0], [-0.24, 0.17], [-0.3, 0.07], [-0.27, 0], [-0.3, -0.07], [-0.24, -0.17]];
  const PEC_FIN = [[0, 0], [-0.11, -0.025], [-0.17, -0.1], [-0.06, -0.07]];

  /* ---- body construction per silhouette ---- */

  if (type === 'slender') {
    const maxR = jit(0.072);
    const rFn = (t) => maxR * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.2)), 0.7);
    const sy = jit(1.05, 0.06), sz = jit(0.72, 0.06);
    addBodyMesh(buildSpindle(rFn, { stations, radial, sy, sz }));
    spindleDims(rFn, sy, sz);
    dims.maxY = maxR * sy; dims.maxZ = maxR * sz;
    Object.assign(dims, { eyeX: 0.35, eyeY: 0.018, eyeZ: maxR * sz * 0.85, eyeR: 0.022 });
    tail = makeTailGroup(-0.49);
    tailFin(tail, [[0, 0], [-0.3, 0.15], [-0.17, 0.02]]);   // forked tail
    tailFin(tail, [[0, 0], [-0.17, -0.02], [-0.3, -0.15]]);
    addFin([[0, 0], [-0.03, 0.1], [-0.14, 0.02]], [0.08, dims.topY(0.08) * 0.95, 0], [0, 0, 0], 0.9);
  } else if (type === 'deep') {
    const maxR = jit(0.13);
    const rFn = (t) => maxR * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.05)), 0.75);
    const sy = jit(2.1, 0.08), sz = jit(0.55, 0.08);
    addBodyMesh(buildSpindle(rFn, { stations, radial, sy, sz }));
    spindleDims(rFn, sy, sz);
    dims.maxY = maxR * sy; dims.maxZ = maxR * sz;
    Object.assign(dims, { eyeX: 0.31, eyeY: 0.07, eyeZ: dims.sideZ(0.31) * 0.95 + 0.005, eyeR: 0.03 });
    tail = makeTailGroup(-0.48);
    tailFin(tail, FAN_TAIL, 0.85);
    // tall trapezoid dorsal + mirrored anal fin (angelfish)
    addFin([[0, 0], [0.1, 0.16], [-0.08, 0.2], [-0.2, 0.06]], [0.0, dims.topY(0.0) * 0.8, 0], [0, 0, 0]);
    const anal = addFin([[0, 0], [0.1, 0.16], [-0.08, 0.2], [-0.2, 0.06]], [0.0, dims.botY(0.0) * 0.8, 0], [0, 0, 0]);
    anal.scale.y = -1;
  } else if (type === 'eel') {
    const n = clamp(Math.round(7 * d), 5, 7);
    const spacing = 0.92 / (n - 1);
    const segLen = spacing;
    for (let i = 0; i < n; i++) {
      const ti = 1 - i / (n - 1); // 1 = head
      const r = 0.055 * (0.6 + 0.5 * Math.sin(Math.PI * (0.2 + 0.65 * ti))) * (0.55 + 0.45 * ti) * jit(1, 0.05);
      const segX = 0.46 - i * spacing;
      const geom = new THREE.SphereGeometry(r, Math.max(6, radial - 1), 4).toNonIndexed();
      geom.scale((segLen * 0.85) / r, 1, 1);
      const t0 = clamp(segX + 0.5 - segLen * 0.5, 0, 1);
      applyPatternColors(geom, (t, ny, ang, out) => colorize(clamp(t0 + t * segLen, 0, 1), ny, ang, out));
      const mesh = new THREE.Mesh(geom, bodyMat);
      mesh.position.set(segX, 0, 0);
      mesh.userData.z0 = 0;
      rig.add(mesh);
      bodySurfaces.push(mesh);
      eelSegs.push(mesh);
    }
    const headR = 0.052;
    Object.assign(dims, {
      maxY: headR, maxZ: headR, eyeX: 0.47, eyeY: 0.02, eyeZ: 0.034, eyeR: 0.018,
      topY: (x) => headR * 0.95, botY: (x) => -headR * 0.95, sideZ: (x) => headR * 0.95,
    });
    tail = makeTailGroup(0);
    tail.position.set(-segLen * 0.7, 0, 0);
    tailFin(tail, [[0, 0], [-0.14, 0.07], [-0.19, 0], [-0.14, -0.07]]); // paddle
    eelSegs[eelSegs.length - 1].add(tail);
    // low dorsal ridge riding a middle segment so it undulates too
    const ridge = new THREE.Mesh(triFan([[-0.22, 0], [0.22, 0], [0.16, 0.045], [-0.16, 0.045]]), finMat);
    ridge.position.set(0, headR * 0.9, 0);
    eelSegs[Math.floor(n / 2)].add(ridge);
  } else if (type === 'flat') {
    const maxR = jit(0.15);
    const rFn = (t) => maxR * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.1)), 0.8);
    const sy = jit(0.3, 0.1), sz = jit(1.75, 0.1);
    addBodyMesh(buildSpindle(rFn, { stations, radial, sy, sz }));
    spindleDims(rFn, sy, sz);
    dims.maxY = maxR * sy; dims.maxZ = maxR * sz;
    Object.assign(dims, { eyeX: 0.3, eyeY: dims.topY(0.3) + 0.012, eyeZ: 0.05, eyeR: 0.024, eyeTop: true });
    tail = makeTailGroup(-0.49);
    tailFin(tail, FAN_TAIL, 0.7, [-Math.PI / 2, 0, 0]); // horizontal tail fan
    // flounder skirt fins along both sides
    addFin([[0.25, 0], [-0.3, 0], [-0.1, 0.1]], [0, 0.008, dims.sideZ(0) * 0.8], [-Math.PI / 2, 0, 0]);
    addFin([[0.25, 0], [-0.3, 0], [-0.1, 0.1]], [0, 0.008, -dims.sideZ(0) * 0.8], [Math.PI / 2, 0, 0]);
  } else if (type === 'blob') {
    const R = jit(0.3, 0.08);
    const sx = 1.05, sy = 0.95, sz = 0.85, cx = 0.02;
    const geom = new THREE.SphereGeometry(R, Math.max(7, radial + 1), Math.max(5, Math.round(radial * 0.8))).toNonIndexed();
    geom.scale(sx, sy, sz);
    geom.translate(cx, 0, 0);
    addBodyMesh(geom);
    const half = (x, s) => {
      const u = clamp((x - cx) / (R * sx), -1, 1);
      return Math.sqrt(Math.max(0, 1 - u * u)) * R * s;
    };
    dims.maxY = R * sy; dims.maxZ = R * sz;
    Object.assign(dims, {
      headX: cx + R * sx, tailX: cx - R * sx,
      eyeX: cx + R * sx * 0.72, eyeY: R * sy * 0.32, eyeZ: half(cx + R * sx * 0.72, sz) * 0.8, eyeR: 0.036,
      topY: (x) => half(x, sy), botY: (x) => -half(x, sy), sideZ: (x) => half(x, sz),
    });
    tail = makeTailGroup(cx - R * sx * 0.96);
    tailFin(tail, FAN_TAIL, 0.55);
    addFin([[0, 0], [-0.05, 0.07], [-0.11, 0.01]], [cx, dims.topY(cx) * 0.97, 0], [0, 0, 0], 0.8); // tiny dorsal
  } else if (type === 'ray') {
    // diamond wing body
    const wing = jit(0.55, 0.08);
    const nose = [0.5, 0.02, 0], back = [-0.28, 0, 0];
    const wL = [-0.02, 0.01, wing], wR = [-0.02, 0.01, -wing];
    const top = [0.08, 0.1, 0], bot = [0.08, -0.07, 0];
    const pos = [];
    const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    tri(nose, wR, top); tri(wR, back, top); tri(back, wL, top); tri(wL, nose, top);
    tri(nose, wL, bot); tri(wL, back, bot); tri(back, wR, bot); tri(wR, nose, bot);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.computeVertexNormals();
    addBodyMesh(geom);
    // little raised body hump
    const hump = new THREE.SphereGeometry(0.16, 7, 5).toNonIndexed();
    hump.scale(1.15, 0.45, 0.8);
    hump.translate(0.12, 0.05, 0);
    addBodyMesh(hump);
    dims.maxY = 0.12; dims.maxZ = wing;
    Object.assign(dims, {
      headX: 0.5, tailX: -0.28,
      eyeX: 0.26, eyeY: 0.11, eyeZ: 0.065, eyeR: 0.022, eyeTop: true,
      topY: (x) => 0.1, botY: (x) => -0.06,
      sideZ: (x) => Math.max(0.04, wing * (x > -0.02 ? (0.5 - x) / 0.52 : (x + 0.28) / 0.26)),
    });
    tail = makeTailGroup(-0.27); // tail whip
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.018, 0.46, 4), finMat);
    whip.rotation.z = Math.PI / 2;
    whip.position.x = -0.23;
    tail.add(whip);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 4), accentMat);
    barb.position.set(-0.34, 0.02, 0);
    barb.rotation.z = 0.6;
    tail.add(barb);
  } else if (type === 'shark') {
    const maxR = jit(0.125);
    const rFn = (t) => maxR * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.35)), 0.6);
    const sy = jit(1.0, 0.06), sz = jit(0.85, 0.06);
    addBodyMesh(buildSpindle(rFn, { stations, radial, sy, sz }));
    spindleDims(rFn, sy, sz);
    dims.maxY = maxR * sy; dims.maxZ = maxR * sz;
    Object.assign(dims, { eyeX: 0.36, eyeY: 0.03, eyeZ: dims.sideZ(0.36) * 0.9 + 0.004, eyeR: 0.018 });
    tail = makeTailGroup(-0.49);
    tailFin(tail, [[0, 0], [-0.18, 0.3], [-0.07, 0.1]]);    // crescent: big upper lobe
    tailFin(tail, [[0, 0], [-0.06, -0.07], [-0.14, -0.18]]); // smaller lower lobe
    addFin([[0, 0], [-0.05, 0.2], [-0.18, 0.02]], [0.04, dims.topY(0.04) * 0.85, 0], [0, 0, 0]); // tall dorsal
    addFin([[0, 0], [-0.03, 0.08], [-0.09, 0.01]], [-0.28, dims.topY(-0.28) * 0.8, 0], [0, 0, 0], 0.8); // second dorsal
  } else { // 'standard'
    const maxR = jit(0.135);
    const rFn = (t) => maxR * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.15)), 0.85);
    const sy = jit(1.12, 0.08), sz = jit(0.8, 0.08);
    addBodyMesh(buildSpindle(rFn, { stations, radial, sy, sz }));
    spindleDims(rFn, sy, sz);
    dims.maxY = maxR * sy; dims.maxZ = maxR * sz;
    Object.assign(dims, { eyeX: 0.33, eyeY: 0.045, eyeZ: dims.sideZ(0.33) * 0.9 + 0.004, eyeR: 0.028 });
    tail = makeTailGroup(-0.48);
    tailFin(tail, FAN_TAIL);
    addFin([[0, 0], [-0.02, 0.13], [-0.16, 0.03]], [0.06, dims.topY(0.06) * 0.9, 0], [0, 0, 0]); // dorsal
    const anal = addFin([[0, 0], [-0.02, 0.08], [-0.11, 0.02]], [-0.12, dims.botY(-0.12) * 0.9, 0], [0, 0, 0], 0.8);
    anal.scale.y = -0.8;
  }

  if (tail && !tail.parent) rig.add(tail);

  // pectoral pair (the ray's wings already serve as pectorals)
  if (type !== 'ray') {
    const pecScale = type === 'blob' || type === 'flat' ? 0.55 : type === 'shark' ? 1.2 : 0.9;
    const px = type === 'eel' ? 0.36 : dims.headX * 0.42;
    for (const side of [1, -1]) {
      const pec = addFin(PEC_FIN, [px, -dims.maxY * 0.15, side * dims.sideZ(px) * 0.9], [side * 0.55, -side * 0.5, 0.15], pecScale);
      pec.scale.z = side; // mirror
    }
  }

  /* ---- eyes ---- */
  const features = Array.isArray(fish.features) ? fish.features : [];
  const has = (f) => features.indexOf(f) !== -1;
  {
    const es = has('bigEyes') ? 1.85 : 1;
    const r = dims.eyeR * es;
    const scleraG = new THREE.SphereGeometry(r, 6, 4);
    const pupilG = new THREE.SphereGeometry(r * 0.52, 5, 4);
    const scleraM = new THREE.MeshStandardMaterial({ color: 0xf5f1e6, roughness: 0.35, flatShading: true });
    const pupilM = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, flatShading: true });
    for (const side of [1, -1]) {
      const eye = new THREE.Group();
      eye.position.set(dims.eyeX, dims.eyeY + (dims.eyeTop ? r * 0.4 : 0), side * dims.eyeZ);
      eye.add(new THREE.Mesh(scleraG, scleraM));
      const pupil = new THREE.Mesh(pupilG, pupilM);
      if (dims.eyeTop) pupil.position.set(r * 0.3, r * 0.55, 0);
      else pupil.position.set(r * 0.35, 0, side * r * 0.55);
      eye.add(pupil);
      rig.add(eye);
    }
  }

  /* ---- features ---- */
  if (has('whiskers')) {
    const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.13, 4);
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(g, accentMat);
      w.position.set(dims.headX * 0.88 + 0.02, dims.botY(dims.headX * 0.85) * 0.55 - 0.02, side * 0.025);
      w.rotation.set(side * 0.35, 0, -2.0);
      rig.add(w);
    }
  }
  if (has('spines')) {
    const n = 4 + Math.floor(rng() * 2);
    const g = new THREE.ConeGeometry(0.013, 0.055, 4);
    for (let i = 0; i < n; i++) {
      const x = 0.18 - i * (0.4 / n) + (rng() - 0.5) * 0.02;
      const s = new THREE.Mesh(g, accentMat);
      s.position.set(x, dims.topY(x) * 0.96 + 0.015, 0);
      s.rotation.z = 0.35 + rng() * 0.2;
      rig.add(s);
    }
  }
  if (has('longSnout')) {
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 5), bodyMatSolid());
    snout.position.set(dims.headX + 0.07, -0.004, 0);
    snout.rotation.z = -Math.PI / 2;
    rig.add(snout);
  }
  if (has('lure')) {
    const lure = new THREE.Group();
    lure.position.set(0.32, dims.topY(0.32) * 0.95, 0);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.16, 4), accentMat);
    stalk.position.set(0.05, 0.06, 0);
    stalk.rotation.z = -0.7;
    lure.add(stalk);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 6, 4),
      new THREE.MeshStandardMaterial({
        color: 0x111111, flatShading: true,
        emissive: new THREE.Color(colors.accent || '#ffee88'), emissiveIntensity: 2.5,
      })
    );
    orb.position.set(0.105, 0.125, 0);
    lure.add(orb);
    rig.add(lure);
  }
  if (has('frills')) {
    const arc = [[0, 0]];
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI / 3 + (i / 4) * (Math.PI * 2 / 3);
      arc.push([Math.cos(a) * 0.1 - 0.02, Math.sin(a) * 0.1]);
    }
    for (const side of [1, -1]) {
      const f = addFin(arc, [dims.headX * 0.38, 0.01, side * dims.sideZ(dims.headX * 0.38) * 0.9], [side * 0.3, -side * 0.95, 0], 1, accentMat);
      f.scale.z = side;
    }
  }
  if (has('horns')) {
    const g = new THREE.ConeGeometry(0.016, 0.075, 4);
    for (const side of [1, -1]) {
      const h = new THREE.Mesh(g, accentMat);
      h.position.set(0.27, dims.topY(0.27) * 0.95 + 0.02, side * 0.035);
      h.rotation.set(-side * 0.22, 0, 0.5);
      rig.add(h);
    }
  }
  if (has('armor')) {
    const armorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors.accent || '#c0c0c0'),
      flatShading: true, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide,
    });
    const n = 3;
    for (let i = 0; i < n; i++) {
      const x = 0.2 - i * 0.17;
      const g = new THREE.BoxGeometry(0.16, Math.max(0.06, dims.maxY * 1.1), 0.014);
      for (const side of [1, -1]) {
        const plate = new THREE.Mesh(g, armorMat);
        plate.position.set(x, dims.maxY * 0.08, side * dims.sideZ(x) * 0.78);
        plate.rotation.y = -side * 0.14;
        rig.add(plate);
      }
    }
  }
  if (has('tentacles')) {
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const z0 = (n === 1 ? 0 : (i / (n - 1) - 0.5)) * dims.maxZ * 1.1;
      const sx = dims.headX * 0.55;
      const sy0 = dims.botY(sx) * 0.85;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(sx, sy0, z0),
        new THREE.Vector3(sx + 0.02, sy0 - 0.09, z0 * 1.3),
        new THREE.Vector3(sx - 0.05 - rng() * 0.04, sy0 - 0.16, z0 * 1.5 + (rng() - 0.5) * 0.04)
      );
      const t = new THREE.Mesh(new THREE.TubeGeometry(curve, 4, 0.011, 4, false), finMat);
      rig.add(t);
    }
  }
  if (has('beard')) {
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const g = new THREE.ConeGeometry(0.012, 0.05 + rng() * 0.03, 4);
      const b = new THREE.Mesh(g, accentMat);
      const x = dims.headX * 0.72 - i * 0.025;
      b.position.set(x, dims.botY(x) * 0.9 - 0.02, (rng() - 0.5) * 0.04);
      b.rotation.z = Math.PI + (rng() - 0.5) * 0.4;
      rig.add(b);
    }
  }

  // glowspots: small emissive dots stuck to the body surface
  if (fish.pattern === 'glowspots' && bodySurfaces.length) {
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x111111, flatShading: true,
      emissive: new THREE.Color(colors.accent || '#88ffee'), emissiveIntensity: 2.2,
    });
    const dotG = new THREE.SphereGeometry(0.012, 4, 3);
    const nd = 8;
    for (let i = 0; i < nd; i++) {
      const surf = bodySurfaces[Math.floor(rng() * bodySurfaces.length)];
      const p = surf.geometry.getAttribute('position');
      const vi = Math.floor(rng() * p.count);
      const vx = p.getX(vi), vy = p.getY(vi), vz = p.getZ(vi);
      const rl = Math.max(1e-5, Math.hypot(vy, vz));
      const dot = new THREE.Mesh(dotG, glowMat);
      dot.position.set(vx, vy + (vy / rl) * 0.006, vz + (vz / rl) * 0.006);
      surf.add(dot);
    }
  }

  // longSnout helper: solid (non-vertex-color) body-tinted material
  function bodyMatSolid() {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors.body || '#5f9ea0'),
      flatShading: true, roughness: 0.85,
    });
  }

  /* ---- normalize: exactly 1.0 unit long on X, centered, head at +X ---- */
  const bbox = new THREE.Box3().setFromObject(rig);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const s = 1 / Math.max(1e-6, size.x);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  rig.scale.setScalar(s);
  rig.position.set(-center.x * s, -center.y * s, -center.z * s);

  /* ---- effect particles ---- */
  const fx = fish.effect ? makeEffectParticles(fish.effect, 0.75) : null;
  if (fx) group.add(fx);

  /* ---- animation ---- */
  const tailSpeed = 4.2 + rng() * 2.5;
  const tailAmp = 0.28 + rng() * 0.14;
  const nSeg = Math.max(1, eelSegs.length - 1);
  group.userData.animate = (t, dt = 0.016) => {
    if (tail) tail.rotation.y = Math.sin(t * tailSpeed) * tailAmp;
    for (let i = 0; i < eelSegs.length; i++) {
      const seg = eelSegs[i];
      const k = i / nSeg;
      seg.position.z = seg.userData.z0 + Math.sin(t * 4.5 + i * 0.85) * 0.05 * (0.15 + 0.85 * k);
      seg.rotation.y = Math.cos(t * 4.5 + i * 0.85) * 0.12 * k;
    }
    if (fx && fx.userData.animate) fx.userData.animate(t, dt);
  };

  return group;
}

/* ============================== makeEffectParticles ============================== */

function pointsSystem(count, size, opacity) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size, transparent: true, opacity,
    vertexColors: true, color: 0xffffff,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  return { points, positions, colors, geom, mat };
}

export function makeEffectParticles(effect, radius = 0.8) {
  const group = new THREE.Group();
  group.name = 'fx:' + ((effect && effect.type) || 'none');
  if (!effect || !effect.type) {
    group.userData.animate = () => {};
    return group;
  }
  const rng = mulberry32(hashString(effect.type + '|' + (effect.color || '')));
  const col = new THREE.Color(effect.color || '#ffffff');
  const type = effect.type;
  const R = radius;

  if (type === 'bubbles') {
    const n = 40;
    const { points, positions, colors, geom } = pointsSystem(n, 0.045, 0.75);
    const px = [], pz = [], py0 = [], sp = [], ph = [];
    for (let i = 0; i < n; i++) {
      px.push((rng() * 2 - 1) * R * 0.55); pz.push((rng() * 2 - 1) * R * 0.45);
      py0.push(rng() * 2 * R); sp.push(0.15 + rng() * 0.28); ph.push(rng() * Math.PI * 2);
      colors[i * 3] = col.r * 0.8 + 0.2; colors[i * 3 + 1] = col.g * 0.8 + 0.2; colors[i * 3 + 2] = col.b * 0.8 + 0.2;
    }
    geom.getAttribute('color').needsUpdate = true;
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        positions[i * 3] = px[i] + Math.sin(t * 2 + ph[i]) * 0.03;
        positions[i * 3 + 1] = ((py0[i] + t * sp[i]) % (2 * R)) - R;
        positions[i * 3 + 2] = pz[i];
      }
      geom.getAttribute('position').needsUpdate = true;
    };
  } else if (type === 'embers') {
    const n = 60;
    const { points, positions, colors, geom } = pointsSystem(n, 0.04, 0.9);
    const px = [], pz = [], py0 = [], sp = [], ph = [];
    const warm = new THREE.Color(1, 0.45, 0.1);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      px.push((rng() * 2 - 1) * R * 0.5); pz.push((rng() * 2 - 1) * R * 0.4);
      py0.push(rng() * 1.6 * R); sp.push(0.5 + rng() * 0.5); ph.push(rng() * Math.PI * 2);
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const y = ((py0[i] + t * sp[i]) % (1.6 * R)) - 0.8 * R;
        positions[i * 3] = px[i] + Math.sin(t * 3 + ph[i]) * 0.02;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = pz[i];
        const flick = 0.55 + 0.45 * Math.sin(t * 11 + ph[i] * 5);
        const fade = 1 - (y + 0.8 * R) / (1.6 * R);
        c.copy(col).lerp(warm, 0.5 + 0.5 * Math.sin(ph[i]));
        colors[i * 3] = c.r * flick * (0.3 + 0.7 * fade);
        colors[i * 3 + 1] = c.g * flick * (0.3 + 0.7 * fade);
        colors[i * 3 + 2] = c.b * flick * (0.3 + 0.7 * fade);
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
    };
  } else if (type === 'void') {
    const n = 55;
    const { points, positions, colors, geom } = pointsSystem(n, 0.05, 0.85);
    const th = [], spin = [], rsp = [], ph = [];
    const dark = new THREE.Color(0.06, 0.01, 0.1);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      th.push(rng() * Math.PI * 2); spin.push(1 + rng() * 1.4);
      rsp.push(0.12 + rng() * 0.18); ph.push(rng());
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const q = 1 - frac(t * rsp[i] + ph[i]); // 1 = rim, 0 = center
        const r = R * q;
        const a = th[i] + t * spin[i] + (1 - q) * 4;
        positions[i * 3] = Math.cos(a) * r;
        positions[i * 3 + 1] = Math.sin(ph[i] * 7 + t) * 0.16 * r;
        positions[i * 3 + 2] = Math.sin(a) * r;
        c.copy(dark).lerp(col, Math.pow(q, 2.2));
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
    };
  } else if (type === 'lightning') {
    const bolts = 3, segs = 6;
    const count = bolts * segs * 2;
    const positions = new Float32Array(count * 3);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: col, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.frustumCulled = false;
    group.add(lines);
    const randPt = (v) => {
      const a = rng() * Math.PI * 2, e = (rng() - 0.5) * Math.PI * 0.8, r = R * (0.5 + rng() * 0.5);
      v.set(Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r);
    };
    const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
    const regen = () => {
      let k = 0;
      for (let b = 0; b < bolts; b++) {
        randPt(A); randPt(B);
        P.copy(A);
        for (let s2 = 1; s2 <= segs; s2++) {
          const u = s2 / segs;
          Q.copy(A).lerp(B, u);
          if (s2 < segs) {
            Q.x += (rng() - 0.5) * R * 0.28;
            Q.y += (rng() - 0.5) * R * 0.28;
            Q.z += (rng() - 0.5) * R * 0.28;
          }
          positions[k++] = P.x; positions[k++] = P.y; positions[k++] = P.z;
          positions[k++] = Q.x; positions[k++] = Q.y; positions[k++] = Q.z;
          P.copy(Q);
        }
      }
      geom.getAttribute('position').needsUpdate = true;
    };
    regen();
    group.userData.next = 0;
    group.userData.animate = (t) => {
      if (t >= group.userData.next) {
        group.userData.next = t + 0.13 + rng() * 0.06;
        regen();
      }
      mat.opacity = 0.55 + 0.45 * Math.sin(t * 30);
    };
  } else if (type === 'prism') {
    const n = 70;
    const { points, positions, colors, geom } = pointsSystem(n, 0.045, 0.9);
    const rr = [], th = [], sp2 = [], ph = [], tilt = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      rr.push(R * (0.45 + rng() * 0.55)); th.push(rng() * Math.PI * 2);
      sp2.push(0.4 + rng() * 0.6); ph.push(rng()); tilt.push((rng() - 0.5) * 0.9);
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const a = th[i] + t * sp2[i];
        positions[i * 3] = Math.cos(a) * rr[i];
        positions[i * 3 + 1] = Math.sin(a) * rr[i] * tilt[i] + Math.sin(t + ph[i] * 7) * 0.1;
        positions[i * 3 + 2] = Math.sin(a) * rr[i];
        c.setHSL(frac(t * 0.15 + ph[i]), 0.9, 0.6);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
    };
  } else if (type === 'aurora') {
    const ribbons = [];
    const tints = [col.clone(), col.clone().lerp(new THREE.Color(0x44ffaa), 0.5), col.clone().lerp(new THREE.Color(0x66ddff), 0.5)];
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.PlaneGeometry(R * 1.9, R * 0.32, 16, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: tints[i], transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, R * (0.5 + 0.2 * i), (i - 1) * R * 0.12);
      mesh.rotation.x = -1.1;
      mesh.frustumCulled = false;
      group.add(mesh);
      ribbons.push({ mesh, geo, mat, base: geo.getAttribute('position').array.slice(), phase: i * 2.1 });
    }
    group.userData.animate = (t) => {
      for (let i = 0; i < ribbons.length; i++) {
        const rb = ribbons[i];
        const p = rb.geo.getAttribute('position');
        for (let v = 0; v < p.count; v++) {
          const bx = rb.base[v * 3];
          p.setZ(v, Math.sin(bx * (4 / R) + t * (0.6 + 0.2 * i) + rb.phase) * R * 0.07);
        }
        p.needsUpdate = true;
        rb.mat.opacity = 0.15 + 0.09 * Math.sin(t * 0.6 + rb.phase);
      }
    };
  } else if (type === 'toxic') {
    const n = 36;
    const { points, positions, colors, geom, mat } = pointsSystem(n, 0.1, 0.45);
    mat.sizeAttenuation = true;
    const px = [], pz = [], py0 = [], sp = [], ph = [];
    const green = new THREE.Color(0.35, 1, 0.25);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      px.push((rng() * 2 - 1) * R * 0.6); pz.push((rng() * 2 - 1) * R * 0.5);
      py0.push(rng() * 1.4 * R); sp.push(0.04 + rng() * 0.06); ph.push(rng() * Math.PI * 2);
      c.copy(col).lerp(green, 0.6);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geom.getAttribute('color').needsUpdate = true;
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const m = 1.4 * R;
        const y = (((py0[i] - t * sp[i]) % m) + m) % m - 0.7 * R; // slow sink, wraps
        positions[i * 3] = px[i] + Math.sin(t * 0.4 + ph[i]) * 0.09;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = pz[i] + Math.cos(t * 0.3 + ph[i]) * 0.07;
      }
      geom.getAttribute('position').needsUpdate = true;
    };
  } else if (type === 'frost') {
    const n = 50;
    const { points, positions, colors, geom } = pointsSystem(n, 0.035, 0.85);
    const px = [], pz = [], py0 = [], sp = [], ph = [];
    const pale = new THREE.Color(0.75, 0.9, 1);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      px.push((rng() * 2 - 1) * R * 0.6); pz.push((rng() * 2 - 1) * R * 0.5);
      py0.push(rng() * 1.6 * R); sp.push(0.06 + rng() * 0.1); ph.push(rng() * Math.PI * 2);
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const m = 1.6 * R;
        positions[i * 3] = px[i] + Math.sin(t * 0.8 + ph[i]) * 0.04;
        positions[i * 3 + 1] = (((py0[i] - t * sp[i]) % m) + m) % m - 0.8 * R;
        positions[i * 3 + 2] = pz[i];
        const tw = 0.55 + 0.45 * Math.max(0, Math.sin(t * 7 + ph[i] * 9)); // sparkle
        c.copy(pale).lerp(col, 0.4);
        colors[i * 3] = c.r * tw; colors[i * 3 + 1] = c.g * tw; colors[i * 3 + 2] = c.b * tw;
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
    };
  } else if (type === 'bloom') {
    const n = 80;
    const { points, positions, colors, geom } = pointsSystem(n, 0.05, 0.9);
    const dx = [], dy = [], dz = [], ph = [], pink = [];
    const c = new THREE.Color();
    const rose = new THREE.Color(1, 0.6, 0.75);
    const white = new THREE.Color(1, 0.95, 0.98);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, e = (rng() - 0.5) * Math.PI;
      dx.push(Math.cos(a) * Math.cos(e)); dy.push(Math.sin(e) * 0.6); dz.push(Math.sin(a) * Math.cos(e));
      ph.push(rng()); pink.push(rng());
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const p = frac(t * 0.45 + ph[i]);
        const r = (1 - (1 - p) * (1 - p)) * R; // ease-out pulse
        positions[i * 3] = dx[i] * r;
        positions[i * 3 + 1] = dy[i] * r;
        positions[i * 3 + 2] = dz[i] * r;
        const b = 1 - p;
        c.copy(rose).lerp(white, pink[i]).lerp(col, 0.35);
        colors[i * 3] = c.r * b; colors[i * 3 + 1] = c.g * b; colors[i * 3 + 2] = c.b * b;
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
    };
  } else { // 'sparkle' (also the fallback)
    const n = 60;
    const { points, positions, colors, geom, mat } = pointsSystem(n, 0.05, 0.9);
    const rr = [], th = [], sp2 = [], ph = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      rr.push(R * (0.45 + rng() * 0.55)); th.push(rng() * Math.PI * 2);
      sp2.push(0.25 + rng() * 0.5); ph.push(rng() * Math.PI * 2);
    }
    group.add(points);
    group.userData.animate = (t) => {
      for (let i = 0; i < n; i++) {
        const a = th[i] + t * sp2[i];
        positions[i * 3] = Math.cos(a) * rr[i];
        positions[i * 3 + 1] = Math.sin(a * 0.7 + ph[i]) * rr[i] * 0.35;
        positions[i * 3 + 2] = Math.sin(a) * rr[i];
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6 + ph[i] * 7)); // twinkle
        colors[i * 3] = col.r * tw; colors[i * 3 + 1] = col.g * tw; colors[i * 3 + 2] = col.b * tw;
      }
      geom.getAttribute('position').needsUpdate = true;
      geom.getAttribute('color').needsUpdate = true;
      mat.size = 0.05 * (0.85 + 0.15 * Math.sin(t * 3));
    };
  }

  return group;
}

/* ============================== fishThumbnailDataUrl ============================== */

let _thumb = null;         // shared { renderer, scene, camera }, lazily created
let _thumbBroken = false;  // set if WebGL is unavailable, so we stop retrying
const _thumbCache = new Map();

export function fishThumbnailDataUrl(fish, size = 96) {
  if (!fish || fish.id == null) return null;
  const key = fish.id + '@' + size;
  if (_thumbCache.has(key)) return _thumbCache.get(key);
  if (_thumbBroken) return null;

  let added = null;
  try {
    if (!_thumb) {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 20);
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(2, 3, 4);
      const fill = new THREE.DirectionalLight(0xbfd8ff, 0.8);
      fill.position.set(-3, 1, -2);
      scene.add(keyLight, fill, new THREE.AmbientLight(0xffffff, 0.7));
      _thumb = { renderer, scene, camera };
    }
    const { renderer, scene, camera } = _thumb;
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    camera.position.set(1.05, 0.6, 1.35);
    camera.lookAt(0, 0, 0);

    const g = makeFishMesh(fish);
    g.rotation.y = -0.55; // 3/4 view, head angled toward camera
    if (g.userData.animate) g.userData.animate(0.4, 0.016); // pose tail/particles
    scene.add(g);
    added = g;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(g);
    added = null;
    disposeObject(g);
    _thumbCache.set(key, url);
    return url;
  } catch (e) {
    if (added && _thumb) {
      try { _thumb.scene.remove(added); disposeObject(added); } catch (_) { /* ignore */ }
    }
    if (!_thumb) _thumbBroken = true; // renderer creation failed: no WebGL here
    return null;
  }
}
