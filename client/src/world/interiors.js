// Interior / remote maps: sewer, cave, reef, deepsea, rig, abyss, player island.
// Each builder(group, world, helpers) returns a map object:
// { id, ground(x,z), water(x,z), biome(x,z), zone?, inBounds(x,z), spawn, interactables,
//   blockers, platforms, hotspotAreas, animated, flag? }
import * as THREE from '../../vendor/three.module.js';
import * as P from './prims.js';
import { hash2, dist2d, clamp } from '../core/util.js';
import { S } from '../core/state.js';
import { BUILDINGS, PORTAL_SPOTS } from '../data/static.js';

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), P.mat(color));
  m.position.set(x, y, z);
  return m;
}
function flatMap({ id, groundY = 2, waterY = 0, biome, spawn, size = 90 }) {
  return {
    id,
    ground: () => groundY,
    water: () => waterY,
    biome: (x, z) => (typeof biome === 'function' ? biome(x, z) : biome),
    inBounds: (x, z) => Math.abs(x) < size && Math.abs(z) < size,
    spawn,
    interactables: [],
    blockers: [],
    platforms: [],
    animated: [],
  };
}
function exitBack(map, x, z, label = 'Head back outside') {
  map.interactables.push({ x, z, r: 3.5, label, action: { type: 'map', target: 'overworld', spawn: map.returnSpawn } });
}

// ---------------- SEWER ----------------
export function buildSewer(group, world, H) {
  const map = flatMap({ id: 'sewer', groundY: 2, waterY: 0.6, biome: () => 'sewer', spawn: { x: 0, z: -15 }, size: 60 });
  map.mood = { bg: '#1a2416', hemi: '#a8c494', hemiI: 1.25, sunI: 0.35, fogNear: 55, fogFar: 300 };
  map.flag = 'found_sewer';
  map.returnSpawn = { x: 112, z: 108 };
  // channel runs along x axis; walkways at |z| in [4, 12]
  map.ground = (x, z) => (Math.abs(z) < 4 ? -1.6 : 2);
  map.biome = () => 'sewer';
  // brick shell
  group.add(box(120, 0.5, 40, '#5a5148', 0, -0.25 - 1.6, 0)); // channel floor visual
  group.add(box(120, 0.5, 18, '#6b6258', 0, 2 - 0.25, 11));
  group.add(box(120, 0.5, 18, '#6b6258', 0, 2 - 0.25, -11));
  group.add(box(120, 10, 1.5, '#4f463d', 0, 6, 20.5));
  group.add(box(120, 10, 1.5, '#4f463d', 0, 6, -20.5));
  group.add(box(1.5, 10, 42, '#4f463d', 60, 6, 0));
  group.add(box(1.5, 10, 42, '#4f463d', -60, 6, 0));
  group.add(box(122, 1.5, 44, '#443c34', 0, 11, 0)); // ceiling
  // arches
  for (let x = -48; x <= 48; x += 16) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.4, 0.7, 5, 10, Math.PI), P.mat('#5f564c'));
    arch.position.set(x, 2, 0);
    group.add(arch);
  }
  // green water
  const water = H.makeWater(120, 8.5, '#5a8a4a', 0.85);
  water.position.set(0, 0.6, 0);
  group.add(water);
  map.animated.push(water);
  // glow fungus + barrels
  for (let i = 0; i < 10; i++) {
    const mush = P.makeMushroom(i + 40);
    mush.position.set(-55 + i * 12, 2, (i % 2 ? 8 : -8) + hash2(i, 3) * 4);
    group.add(mush);
  }
  for (const [bx, bz] of [[-40, 14], [-36, 15], [30, -14], [52, 13]]) {
    const b = P.makeBarrel();
    b.position.set(bx, 2, bz);
    group.add(b);
  }
  // moody light
  const glow = new THREE.PointLight('#8fd48a', 480, 110);
  glow.position.set(0, 8, 0);
  group.add(glow);
  for (const lx of [-38, 38]) {
    const pl = new THREE.PointLight('#ffd98a', 260, 70);
    pl.position.set(lx, 8, 0);
    group.add(pl);
  }
  // ladder out
  const ladder = box(0.4, 8, 2.2, '#8a6642', 0, 5, -19);
  group.add(ladder);
  map.platforms = [];
  map.walkZones = true;
  map.inBounds = (x, z) => Math.abs(x) < 58 && Math.abs(z) < 19;
  exitBack(map, 0, -17, 'Climb the ladder out');
  map.hotspotAreas = [{ x: 0, z: 0, spread: 90 }];
  return map;
}

// ---------------- CAVE ----------------
export function buildCave(group, world, H) {
  const R = 70;
  const map = flatMap({ id: 'cave', biome: () => 'cave', spawn: { x: 0, z: 52 }, size: R });
  map.mood = { bg: '#101a20', hemi: '#8aa8b8', hemiI: 1.35, sunI: 0.3, fogNear: 70, fogFar: 360 };
  map.flag = 'found_cave';
  map.returnSpawn = { x: -316, z: -452 };
  // ground: bowl with center lake
  map.ground = (x, z) => {
    const d = dist2d(x, z, 0, 0);
    return d < 34 ? -4 + (d / 34) * 5.2 : 1.2 + hash2(Math.round(x / 8), Math.round(z / 8), 4) * 1.5;
  };
  map.water = () => 0;
  map.inBounds = (x, z) => dist2d(x, z, 0, 0) < R - 4;
  // cavern floor mesh
  const geo = new THREE.CircleGeometry(R, 48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, map.ground(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, P.mat('#6a6058')));
  // dome walls
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), P.mat('#4a4438', { side: THREE.BackSide }));
  dome.position.y = 1;
  group.add(dome);
  // lake
  const water = H.makeWater(70, 70, '#3a7a8f', 0.85);
  water.position.y = 0;
  group.add(water);
  map.animated.push(water);
  // crystals + mushrooms + glowworm ceiling points
  const colors = ['#8fd4f0', '#c17fd4', '#7fd4c1', '#f0d48f'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const d = 38 + hash2(i, 9) * 22;
    const c = P.makeCrystal(i, colors[i % colors.length]);
    c.position.set(Math.cos(a) * d, map.ground(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d);
    c.scale.setScalar(1 + hash2(i, 2) * 1.4);
    group.add(c);
  }
  for (let i = 0; i < 8; i++) {
    const m = P.makeMushroom(i);
    m.position.set(-30 + i * 9, map.ground(-30 + i * 9, 40), 40);
    group.add(m);
  }
  const wormN = 160;
  const wpts = new Float32Array(wormN * 3);
  for (let i = 0; i < wormN; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * (R - 10);
    wpts[i * 3] = Math.cos(a) * d;
    wpts[i * 3 + 1] = 18 + Math.random() * 30;
    wpts[i * 3 + 2] = Math.sin(a) * d;
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.BufferAttribute(wpts, 3));
  const worms = new THREE.Points(wg, new THREE.PointsMaterial({ color: '#aef0c8', size: 0.5, transparent: true, opacity: 0.9 }));
  worms.userData.animate = (t) => { worms.material.opacity = 0.65 + Math.sin(t * 1.7) * 0.25; };
  group.add(worms);
  map.animated.push(worms);
  const glow = new THREE.PointLight('#7fd4c1', 1400, 220);
  glow.position.set(0, 18, 0);
  group.add(glow);
  for (const [lx, lz, lc] of [[34, 30, '#8fd4f0'], [-38, -18, '#c17fd4'], [10, -42, '#f0d48f']]) {
    const pl = new THREE.PointLight(lc, 320, 90);
    pl.position.set(lx, 7, lz);
    group.add(pl);
  }
  exitBack(map, 0, 56, 'Squeeze back through the cave mouth');
  map.hotspotAreas = [{ x: 0, z: 0, spread: 50 }];
  return map;
}

// ---------------- REEF ----------------
export function buildReef(group, world, H) {
  const map = flatMap({ id: 'reef', biome: () => 'reef', spawn: { x: 0, z: 30 }, size: 80 });
  map.mood = { bg: '#a8e4e0', hemi: '#d8f4f0', hemiI: 1.05, sunI: 1.3, fogNear: 80, fogFar: 420 };
  map.returnSpawn = { x: 470, z: 462 };
  // crescent sandbar
  map.ground = (x, z) => {
    const d = dist2d(x, z, 0, 34);
    const bar = d < 26 ? 1.8 - (d / 26) * 2.6 : -3.5 - Math.min(8, (d - 26) * 0.25);
    return bar;
  };
  map.water = () => 0;
  map.inBounds = (x, z) => dist2d(x, z, 0, 20) < 70;
  const geo = new THREE.CircleGeometry(90, 40);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = map.ground(x, z);
    pos.setY(i, h);
    const sand = h > -0.4;
    cols[i * 3] = sand ? 0.9 : 0.3; cols[i * 3 + 1] = sand ? 0.82 : 0.65; cols[i * 3 + 2] = sand ? 0.6 : 0.6;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  const water = H.makeWater(180, 180, '#4fd0c8', 0.6);
  group.add(water);
  map.animated.push(water);
  // corals visible in shallows
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const d = 30 + hash2(i, 5) * 24;
    const c = P.makeCoral(i);
    const x = Math.cos(a) * d, z = 20 + Math.sin(a) * d;
    c.position.set(x, map.ground(x, z), z);
    group.add(c);
  }
  const palm = P.makeTree('palm', 3);
  palm.position.set(4, map.ground(4, 34), 38);
  group.add(palm);
  const boat = P.makeBoat(1.2);
  boat.position.set(-2, 0.15, 14);
  boat.userData.animate = (t) => { boat.position.y = 0.15 + Math.sin(t * 1.3) * 0.15; };
  group.add(boat);
  map.animated.push(boat);
  map.interactables.push({ x: -2, z: 14, r: 4.5, label: 'Sail back to Driftwood Docks', action: { type: 'ferry' } });
  map.hotspotAreas = [{ x: 0, z: 0, spread: 90 }];
  return map;
}

// ---------------- DEEP SEA (boat) ----------------
export function buildDeepsea(group, world, H) {
  const map = flatMap({ id: 'deepsea', biome: () => 'deepsea', spawn: { x: 0, z: 2 }, size: 60 });
  map.mood = { bg: '#7fb8cc', hemi: '#cfe8ef', hemiI: 0.85, sunI: 1.1, fogNear: 90, fogFar: 480 };
  map.returnSpawn = { x: 470, z: 462 };
  map.ground = () => -30;
  map.water = () => 0;
  map.platforms = [{ x1: -5, x2: 5, z1: -9, z2: 9, y: 1.3 }];
  map.inBounds = (x, z) => x > -5 && x < 5 && z > -9 && z < 9; // stay on deck
  // the boat
  const deck = box(10, 0.6, 18, '#8a6642', 0, 1, 0);
  group.add(deck);
  const hullL = box(0.8, 2.2, 18, '#6e4a2e', -5.2, 0.6, 0);
  const hullR = box(0.8, 2.2, 18, '#6e4a2e', 5.2, 0.6, 0);
  const bow = box(9.6, 2.2, 0.8, '#6e4a2e', 0, 0.6, -9.2);
  const stern = box(9.6, 2.2, 0.8, '#6e4a2e', 0, 0.6, 9.2);
  group.add(hullL, hullR, bow, stern);
  for (const side of [-1, 1]) group.add(box(9.6, 0.15, 0.15, '#5d4430', 0, 2.4, side * 8.8));
  const mast = box(0.4, 12, 0.4, '#6e4a2e', 0, 7, -2);
  group.add(mast);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(6, 7), P.mat('#f2ead4', { side: THREE.DoubleSide }));
  sail.position.set(0, 8.5, -1.6);
  group.add(sail);
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), P.emissiveMat('#ffd98a', 1));
  lantern.position.set(0, 3.4, 8);
  group.add(lantern);
  for (const [cx, cz] of [[-3.4, 6.5], [-3.4, 7.6], [3.4, -6]]) {
    const c = P.makeCrate();
    c.position.set(cx, 1.3, cz);
    group.add(c);
  }
  // vast ocean
  const water = H.makeWater(500, 500, '#1d5a70', 0.94);
  group.add(water);
  map.animated.push(water);
  // whole boat bobs
  const boatParts = [...group.children];
  group.userData.animate = (t) => {
    const rock = Math.sin(t * 0.8) * 0.015;
    for (const c of boatParts) if (c !== water) { c.rotation.z = rock; }
  };
  map.animated.push(group);
  map.interactables.push({ x: 0, z: 8, r: 3.5, label: 'Take the helm — sail home', action: { type: 'ferry' } });
  map.hotspotAreas = [{ x: 0, z: 0, spread: 70 }];
  return map;
}

// ---------------- OIL RIG ----------------
export function buildRig(group, world, H) {
  const map = flatMap({ id: 'rig', biome: () => 'rig', spawn: { x: 0, z: 10 }, size: 60 });
  map.mood = { bg: '#8a9aa4', hemi: '#b8c4cc', hemiI: 0.75, sunI: 0.7, fogNear: 70, fogFar: 380 };
  map.flag = 'visited_rig';
  map.returnSpawn = { x: 470, z: 462 };
  map.ground = () => -40;
  map.water = () => 0;
  map.platforms = [
    { x1: -16, x2: 16, z1: -14, z2: 14, y: 3 },
    { x1: -6, x2: 16, z1: 14, z2: 26, y: 3 },
  ];
  map.inBounds = (x, z) => (x > -16 && x < 16 && z > -14 && z < 14) || (x > -6 && x < 16 && z > 14 && z < 26);
  // platform decks
  group.add(box(32, 0.8, 28, '#7a7f85', 0, 2.6, 0));
  group.add(box(22, 0.8, 12, '#6b7075', 5, 2.6, 20));
  // legs
  for (const [lx, lz] of [[-14, -12], [14, -12], [-14, 12], [14, 12], [0, 22]]) {
    group.add(box(1.6, 44, 1.6, '#5a5f65', lx, -19, lz));
  }
  // derrick tower
  const derrick = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = box(0.5, 16, 0.5, '#b8542e', Math.cos(a) * 3, 8, Math.sin(a) * 3);
    leg.rotation.x = Math.sin(a) * 0.12;
    leg.rotation.z = -Math.cos(a) * 0.12;
    derrick.add(leg);
  }
  derrick.add(box(3, 1, 3, '#b8542e', 0, 16, 0));
  derrick.position.set(-8, 3, -4);
  group.add(derrick);
  // crane + containers + barrels
  const crane = new THREE.Group();
  crane.add(box(1.2, 10, 1.2, '#d0a03c', 0, 5, 0));
  const arm = box(14, 0.8, 0.8, '#d0a03c', 5.5, 10, 0);
  crane.add(arm);
  crane.position.set(10, 3, 8);
  group.add(crane);
  for (const [bx, bz, c] of [[6, -8, '#a83c3c'], [9.2, -8, '#3c6ba8'], [6, -5, '#3ca85f']]) {
    group.add(box(3, 2.4, 2.4, c, bx, 4.2, bz));
  }
  for (let i = 0; i < 6; i++) {
    const b = P.makeBarrel();
    b.position.set(-13 + i * 1.3, 3, 11.5);
    group.add(b);
  }
  // railings
  for (const side of [-1, 1]) {
    group.add(box(32, 0.12, 0.12, '#c8cdd2', 0, 4.4, side * 13.9));
    group.add(box(0.12, 0.12, 28, '#c8cdd2', side * 15.9, 4.4, 0));
  }
  // warning light
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), P.emissiveMat('#ff5a3c', 1));
  beacon.position.set(-8, 20, -4);
  beacon.userData.animate = (t) => { beacon.material.emissiveIntensity = 0.4 + (Math.sin(t * 4) > 0 ? 0.8 : 0); };
  group.add(beacon);
  map.animated.push(beacon);
  // dark oily water
  const water = H.makeWater(400, 400, '#26424a', 0.95);
  group.add(water);
  map.animated.push(water);
  map.interactables.push({ x: 10, z: 22, r: 4, label: 'Climb down to the ferry', action: { type: 'ferry' } });
  map.hotspotAreas = [{ x: 0, z: 0, spread: 60 }];
  return map;
}

// ---------------- ABYSS ----------------
export function buildAbyss(group, world, H) {
  const map = flatMap({ id: 'abyss', biome: () => 'abyss', spawn: { x: 0, z: 4 }, size: 40 });
  map.mood = { bg: '#02060e', hemi: '#3a4a5c', hemiI: 0.65, sunI: 0.1, fogNear: 40, fogFar: 260 };
  map.flag = 'visited_abyss';
  map.returnSpawn = { x: 470, z: 462 };
  map.ground = () => -120;
  map.water = () => 0;
  map.platforms = [{ x1: -7, x2: 7, z1: -7, z2: 7, y: 1.1 }];
  map.inBounds = (x, z) => Math.abs(x) < 7 && Math.abs(z) < 7;
  // research barge
  group.add(box(14, 0.8, 14, '#3a4148', 0, 0.7, 0));
  group.add(box(14, 1.6, 0.6, '#2e343a', 0, 0.4, -7.2));
  group.add(box(14, 1.6, 0.6, '#2e343a', 0, 0.4, 7.2));
  group.add(box(0.6, 1.6, 14, '#2e343a', -7.2, 0.4, 0));
  group.add(box(0.6, 1.6, 14, '#2e343a', 7.2, 0.4, 0));
  // floodlight ring
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pole = box(0.3, 4, 0.3, '#4a5158', Math.cos(a) * 6, 3, Math.sin(a) * 6);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), P.emissiveMat('#bfe8ff', 1));
    lamp.position.set(Math.cos(a) * 6, 5.1, Math.sin(a) * 6);
    group.add(lamp);
  }
  const light = new THREE.PointLight('#9fd0e8', 420, 80);
  light.position.set(0, 8, 0);
  group.add(light);
  // ink-black water + bioluminescent motes
  const water = H.makeWater(300, 300, '#050a14', 0.97);
  group.add(water);
  map.animated.push(water);
  const n = 220;
  const pts = new Float32Array(n * 3);
  const pcol = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pts[i * 3] = (Math.random() - 0.5) * 220;
    pts[i * 3 + 1] = -Math.random() * 3 - 0.3;
    pts[i * 3 + 2] = (Math.random() - 0.5) * 220;
    const c = new THREE.Color().setHSL(0.45 + Math.random() * 0.25, 0.9, 0.6);
    pcol[i * 3] = c.r; pcol[i * 3 + 1] = c.g; pcol[i * 3 + 2] = c.b;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(pcol, 3));
  const motes = new THREE.Points(pg, new THREE.PointsMaterial({ vertexColors: true, size: 0.7, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.userData.animate = (t) => { motes.material.opacity = 0.6 + Math.sin(t * 2.2) * 0.3; motes.rotation.y = t * 0.01; };
  group.add(motes);
  map.animated.push(motes);
  map.interactables.push({ x: 0, z: 6, r: 3, label: 'Winch up — return to the light', action: { type: 'ferry' } });
  map.hotspotAreas = [{ x: 0, z: 0, spread: 40 }];
  return map;
}

// ---------------- PLAYER ISLAND ----------------
export function buildIsland(group, world, H) {
  const anchor = PORTAL_SPOTS.find((p) => p.id === S.island.spot);
  const inheritBiome = anchor
    ? { town_square: 'harbor', pond_meadow: 'pond', river_bend: 'river', lake_shore: 'lake', coast_dunes: 'coast', docks_edge: 'harbor', swamp_hollow: 'swamp', glacier_foot: 'glacier' }[anchor.id] || 'lake'
    : 'lake';
  const R = 55;
  const map = flatMap({ id: 'island', biome: () => inheritBiome, spawn: { x: 0, z: 24 }, size: R + 40 });
  map.mood = { bg: '#9fd8e8', hemi: '#cfe8ef', hemiI: 0.95, sunI: 1.2, fogNear: 100, fogFar: 500 };
  map.returnSpawn = anchor ? { x: anchor.x + 6, z: anchor.z + 6 } : { x: 0, z: 60 };
  map.ground = (x, z) => {
    const d = dist2d(x, z, 0, 0);
    if (d < R * 0.62) return 2.2;
    if (d < R) return 2.2 - ((d - R * 0.62) / (R * 0.38)) * 3.6;
    return -1.4 - Math.min(10, (d - R) * 0.2);
  };
  map.water = () => 0;
  map.inBounds = (x, z) => dist2d(x, z, 0, 0) < R + 30;
  // island mesh
  const geo = new THREE.CircleGeometry(R + 60, 48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = map.ground(x, z);
    pos.setY(i, h);
    const c = h > 1.4 ? [0.47, 0.66, 0.36] : h > -0.2 ? [0.88, 0.8, 0.58] : [0.3, 0.55, 0.55];
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
  const water = H.makeWater(320, 320, '#3e8f96', 0.85);
  group.add(water);
  map.animated.push(water);
  // portal home
  const portal = P.makePortal(true);
  portal.position.set(0, 2.2, 30);
  group.add(portal);
  map.animated.push(portal);
  map.interactables.push({ x: 0, z: 30, r: 4, label: 'Step through the portal home', action: { type: 'map', target: 'overworld', spawn: map.returnSpawn } });
  // palms + rocks
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const d = R * 0.72;
    const t = P.makeTree('palm', i + 30);
    t.position.set(Math.cos(a) * d, map.ground(Math.cos(a) * d, Math.sin(a) * d), Math.sin(a) * d);
    group.add(t);
  }
  // building plots (N, W, E, S-ish)
  const plots = [
    { key: 'farm', x: -20, z: -12 },
    { key: 'workshop', x: 20, z: -12 },
    { key: 'brewery', x: -20, z: 12 },
    { key: 'shrine', x: 22, z: 14 },
  ];
  for (const plot of plots) {
    const lvl = S.island.buildings[plot.key] || 0;
    const def = BUILDINGS[plot.key];
    const y = map.ground(plot.x, plot.z);
    if (lvl === 0) {
      // empty plot: pegs + sign
      const sign = P.makeSignpost();
      sign.position.set(plot.x, y, plot.z);
      group.add(sign);
      for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        group.add(box(0.3, 0.8, 0.3, '#8a6642', plot.x + px, y + 0.4, plot.z + pz));
      }
    } else {
      let b;
      if (plot.key === 'farm') {
        b = new THREE.Group();
        const plotsN = def.levels[lvl - 1].plots;
        for (let i = 0; i < plotsN; i++) {
          const row = box(2.4, 0.4, 1.6, '#6b4a2e', (i % 2) * 3 - 1.5, 0.2, Math.floor(i / 2) * 2.2 - 2);
          b.add(row);
          const farmSlot = S.island.farm[i];
          if (farmSlot) {
            const grown = farmSlot.ready <= Date.now();
            const sprout = new THREE.Mesh(new THREE.ConeGeometry(grown ? 0.5 : 0.22, grown ? 1.1 : 0.5, 5), P.mat(grown ? '#7fd46b' : '#4a8f3c'));
            sprout.position.set((i % 2) * 3 - 1.5, 0.7, Math.floor(i / 2) * 2.2 - 2);
            b.add(sprout);
          }
        }
        const shed = box(2.2, 2, 2, '#a87a4a', 4.4, 1, -1);
        b.add(shed);
      } else if (plot.key === 'workshop') {
        b = P.makeHouse({ w: 5.5, d: 4.5, h: 3, wall: '#c8b89a', roof: '#5a5f65' });
        const anvil = box(1, 0.8, 0.6, '#3a3f45', 3.6, 0.4, 1);
        b.add(anvil);
      } else if (plot.key === 'brewery') {
        b = P.makeHouse({ w: 5, d: 4.5, h: 3, wall: '#b8a8c8', roof: '#5f3a6b' });
        const cauldron = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.6), P.mat('#2e343a'));
        cauldron.position.set(3.6, 0.7, 1);
        cauldron.rotation.x = Math.PI;
        b.add(cauldron);
        const brew = new THREE.Mesh(new THREE.CircleGeometry(0.7, 10), P.emissiveMat('#8fd46b', 0.8));
        brew.rotation.x = -Math.PI / 2;
        brew.position.set(3.6, 0.85, 1);
        b.add(brew);
      } else {
        b = new THREE.Group();
        // shrine: torii-ish gate + basin
        b.add(box(0.5, 4, 0.5, '#c65b4e', -1.6, 2, 0));
        b.add(box(0.5, 4, 0.5, '#c65b4e', 1.6, 2, 0));
        b.add(box(4.6, 0.5, 0.7, '#c65b4e', 0, 4.1, 0));
        b.add(box(3.6, 0.4, 0.6, '#d97a5e', 0, 3.3, 0));
        const basin = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 0.7, 8), P.mat('#7b7d76'));
        basin.position.set(0, 0.35, 2);
        b.add(basin);
        const shineW = new THREE.Mesh(new THREE.CircleGeometry(0.8, 10), P.emissiveMat('#9fe8e0', 0.7));
        shineW.rotation.x = -Math.PI / 2;
        shineW.position.set(0, 0.72, 2);
        b.add(shineW);
      }
      b.position.set(plot.x, y, plot.z);
      group.add(b);
      map.blockers.push({ x: plot.x, z: plot.z, r: 3.4 });
    }
    map.interactables.push({
      x: plot.x, z: plot.z + 4.5, r: 4,
      label: lvl === 0 ? `Build ${def.name} (${def.icon})` : `Use ${def.name} ${'★'.repeat(lvl)}`,
      action: { type: 'building', key: plot.key },
    });
  }
  // cozy campfire
  const fire = P.makeCampfire();
  fire.position.set(0, map.ground(0, -22), -22);
  group.add(fire);
  map.animated.push(fire);
  map.hotspotAreas = [{ x: 0, z: 0, spread: 170 }];
  return map;
}

export const INTERIORS = {
  sewer: buildSewer,
  cave: buildCave,
  reef: buildReef,
  deepsea: buildDeepsea,
  rig: buildRig,
  abyss: buildAbyss,
  island: buildIsland,
};
