// World2D: same query interface as the old 3D World, but data-only —
// tiles + sprite entities consumed by renderer2d. Reuses the overworld's
// pure terrain math from world/world.js.
import {
  overworldHeight, overworldWaterLevel, overworldBiome, overworldZone,
  distToPaths, HALF, SQUARE,
} from '../world/world.js';
import { hash2, dist2d, clamp } from '../core/util.js';
import { PORTAL_SPOTS, BUILDINGS } from '../data/static.js';
import { S, setFlag, visitZone } from '../core/state.js';

// ---------------- overworld layout (sprites, blockers, interactables) ----------------
function buildOverworld() {
  const sprites = [];
  const blockers = [];
  const add = (name, x, z, seed = 0, solidR = 0) => {
    sprites.push({ name, x, z, seed });
    if (solidR) blockers.push({ x, z, r: solidR });
  };

  // town buildings (positions match the classic layout)
  add('bank', 30, 52, 0, 5.2);
  add('house', -38, 48, 1, 5.2);            // general store
  add('shop_bait', -66, 128, 0, 5);
  add('shop_attach', 66, 132, 0, 5);
  add('shop_potion', -24, 186, 0, 5);
  add('hall', 44, 12, 0, 5.4);
  add('bakery', 96, 88, 0, 5);
  add('house', -90, 80, 2, 5);
  add('house_blue', 110, 40, 3, 5);
  add('house', -70, 220, 4, 5);
  add('house_blue', 60, 226, 5, 5);
  // town square
  const sq = SQUARE;
  add('fountain', sq.x, sq.z, 0, 3.8);
  add('bench', sq.x - 8, sq.z - 6);
  add('bench', sq.x + 9, sq.z - 5);
  add('bench', sq.x + 7, sq.z + 9);
  add('stall_red', sq.x - 14, sq.z - 10, 0, 2);
  add('stall_blue', sq.x + 16, sq.z - 8, 0, 2);
  add('noticeboard', sq.x - 16, sq.z + 16, 0, 1.6);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    add('flowers', sq.x + Math.cos(a) * 20, sq.z + Math.sin(a) * 20, i);
  }
  for (const [lx, lz] of [[sq.x - 12, sq.z + 8], [sq.x + 13, sq.z + 10], [sq.x - 10, sq.z - 12], [sq.x + 12, sq.z - 12], [10, 70], [-14, 96], [16, 130], [-40, 160], [84, 110]]) {
    add('lamp', lx, lz);
  }
  for (const [cx, cz] of [[458, 428], [462, 431], [500, 415], [24, 44], [98, 96]]) {
    add(hash2(cx, cz) > 0.5 ? 'crate' : 'barrel', cx, cz, 0);
  }
  add('lighthouse', 150, 555, 0, 4);
  add('windmill', -150, 218, 0, 3);
  add('tent', -128, -52, 0);
  add('tent', -134, -46, 1);
  add('campfire', -130, -58, 0);
  add('campfire', 300, -240, 0);
  add('ruin_tower', 185, -140, 0, 3);
  add('hut', 236, -334, 0, 3.6);
  add('grate', 112, 104, 0);
  add('cave_mouth', -322, -458, 0);
  add('ferry', 475, 478, 0);
  for (const [sx, sz] of [[-150, 210], [180, -160], [-330, 40], [-260, -370], [420, -140], [120, 380], [390, 390]]) {
    add('signpost', sx, sz, 0);
  }
  // portal circles
  for (const spot of PORTAL_SPOTS) {
    add(S.island.spot === spot.id ? 'portal' : 'portal_off', spot.x, spot.z, 0, 3.4);
  }

  // scattered nature (same hash rules as the 3D world)
  for (let gx = -HALF + 12; gx < HALF; gx += 22) {
    for (let gz = -HALF + 12; gz < HALF; gz += 22) {
      const r = hash2(gx, gz, 20260702 + 21);
      const x = gx + (hash2(gx, gz, 1) - 0.5) * 18;
      const z = gz + (hash2(gx, gz, 2) - 0.5) * 18;
      const h = overworldHeight(x, z);
      const wl = overworldWaterLevel(x, z);
      const zone = overworldZone(x, z);
      const nearTown = dist2d(x, z, 0, 100) < 180 || dist2d(x, z, 480, 420) < 120;
      if (h > wl - 0.4 && h < wl + 0.6 && (zone === 'pond' || zone === 'swamp') && r > 0.45) { add('cattail', x, z, gx); continue; }
      if (h < wl - 0.2 && h > wl - 2 && (zone === 'pond' || zone === 'swamp') && r > 0.7) { add('lilypad', x, z, gz); continue; }
      if (h < wl + 0.8 || nearTown) continue;
      if (h > 42) { if (r > 0.82) add(r > 0.92 ? 'rock_big' : 'rock', x, z, gx); continue; }
      const forest = hash2(Math.round(x / 64), Math.round(z / 64), 31) * 0.5 + 0.3;
      if (r < (forest > 0.55 ? 0.4 : 0.72)) continue;
      if (distToPaths(x, z) < 4) continue;
      let name;
      if (zone === 'glacier' || z < -420) name = 'tree_pine';
      else if (zone === 'swamp') name = r > 0.75 ? 'tree_willow' : 'tree_dead';
      else if (zone === 'volcanic') { if (r < 0.9) continue; name = 'tree_dead'; }
      else if (z > 440) name = 'tree_palm';
      else if (zone === 'pond') name = r > 0.8 ? 'tree_willow' : 'tree_oak';
      else name = r > 0.88 ? 'tree_pine' : 'tree_oak';
      add(name, x, z, Math.round(r * 97), 0.9);
      if (r > 0.93) add('rock', x + 6, z, gz);
    }
  }
  // ground cover
  for (let gx = -HALF + 8; gx < HALF; gx += 15) {
    for (let gz = -HALF + 8; gz < HALF; gz += 15) {
      const r = hash2(gx, gz, 20260702 + 99);
      if (r < 0.7) continue;
      const x = gx + (hash2(gx, gz, 7) - 0.5) * 10;
      const z = gz + (hash2(gx, gz, 8) - 0.5) * 10;
      const h = overworldHeight(x, z);
      const wl = overworldWaterLevel(x, z);
      if (h < wl + 1 || h > 26) continue;
      if (dist2d(x, z, sq.x, sq.z) < 26 || distToPaths(x, z) < 3.4) continue;
      const zone = overworldZone(x, z);
      if (zone === 'volcanic' || zone === 'glacier') continue;
      if (r > 0.965) add('bush', x, z, gx);
      else if (r > 0.9 && (zone === 'pond' || zone === 'town')) add('flowers', x, z, gz);
      else add('grass_tuft', x, z, gx + gz);
    }
  }

  // bridges + piers as plank strips (platforms make them walkable)
  const platforms = [
    { x1: 468.5, x2: 471.5, z1: 452, z2: 472, y: 0.95, deck: 'wood' },
    { x1: 498.5, x2: 501.5, z1: 448, z2: 468, y: 0.95, deck: 'wood' },
  ];
  for (const b of [{ x: 6, z: 58 }, { x: -8, z: 150 }, { x: -20, z: -110 }, { x: -18, z: 224 }]) {
    platforms.push({ x1: b.x - 24, x2: b.x + 24, z1: b.z - 2.6, z2: b.z + 2.6, y: 1.7, deck: 'bridge' });
  }
  // piers found by shore scan (same as 3D)
  const addPier = (zLine, xFrom, xTo) => {
    const step = xTo > xFrom ? 2 : -2;
    for (let x = xFrom; Math.abs(x - xTo) > 2; x += step) {
      if (overworldHeight(x, zLine) >= overworldWaterLevel(x, zLine) - 0.15) continue;
      const startX = x - step * 2;
      const len = 16, dir = Math.sign(step);
      const x1 = dir > 0 ? startX - 1 : startX - len, x2 = dir > 0 ? startX + len : startX + 1;
      platforms.push({ x1, x2, z1: zLine - 1.6, z2: zLine + 1.6, y: 0.95, deck: 'pier' });
      return;
    }
  };
  addPier(262, -240, -320);
  addPier(-320, 230, 380);

  const interactables = [
    { x: 112, z: 104, r: 3.5, label: 'Climb into the Old Sewers', action: { type: 'map', target: 'sewer' } },
    { x: -322, z: -458, r: 4.5, label: 'Enter the Glowworm Cavern', action: { type: 'map', target: 'cave' } },
    { x: 470, z: 468, r: 5.5, label: 'Ferry to distant waters', action: { type: 'ferry' } },
    { x: 30, z: 57, r: 4, label: 'Open the Bank', action: { type: 'bank' } },
    { x: -38, z: 53, r: 4, label: 'General Store', action: { type: 'shop', shop: 'general' } },
    { x: -63, z: 124, r: 4, label: 'Bait Shop', action: { type: 'shop', shop: 'bait' } },
    { x: 63, z: 128, r: 4, label: "Tinkerer's Attachments", action: { type: 'shop', shop: 'attachments' } },
    { x: -24, z: 181, r: 4, label: 'Potion Cauldron', action: { type: 'shop', shop: 'potions' } },
    { x: SQUARE.x - 16, z: SQUARE.z + 16, r: 3, label: 'Read the notice board', action: { type: 'window', window: 'achievements' } },
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
    spawn: { x: 35, z: 94 },
    sprites, blockers, platforms, interactables,
    hotspotAreas: [
      { x: -320, z: 260, spread: 120 }, { x: 380, z: -320, spread: 220 },
      { x: -40, z: -120, spread: 160 }, { x: 200, z: 540, spread: 260 },
      { x: -520, z: 80, spread: 200 }, { x: 0, z: 100, spread: 160 },
    ],
    tile: overworldTileKind,
  };
}

function overworldTileKind(x, z) {
  const h = overworldHeight(x, z);
  const wl = overworldWaterLevel(x, z);
  const biome = overworldBiome(x, z);
  const inTown = dist2d(x, z, 0, 100) < 150;
  if (h < wl - 6) return 'water_deep';
  if (h < wl - 0.15) return biome === 'swamp' ? 'water_swamp' : 'water';
  if (h < wl + 0.35) {
    if (inTown) return 'cobble';
    return biome === 'swamp' ? 'mud' : biome === 'volcanic' ? 'redrock' : 'sand';
  }
  if (h < wl + 0.9 && !inTown) return biome === 'swamp' ? 'mud' : biome === 'volcanic' ? 'redrock' : 'sand';
  if (h > 46) return 'snow';
  if (h > 27) return 'stone';
  if (dist2d(x, z, SQUARE.x, SQUARE.z) < 26) return 'cobble';
  const pd = distToPaths(x, z);
  if (pd < 3.2) return inTown ? 'cobble' : 'path';
  switch (biome) {
    case 'swamp': return 'swamp';
    case 'volcanic': return hash2(Math.round(x / 2), Math.round(z / 2), 3) > 0.5 ? 'redrock' : 'ash';
    case 'glacier': return h < wl + 2.2 ? 'ice' : 'grass_cold';
    default: return 'grass';
  }
}

// ---------------- interior layouts ----------------
function flat2d({ id, groundY = 2, waterY = 0, biome, spawn, size = 90, tile }) {
  return {
    id,
    ground: () => groundY,
    water: () => waterY,
    biome: (x, z) => (typeof biome === 'function' ? biome(x, z) : biome),
    inBounds: (x, z) => Math.abs(x) < size && Math.abs(z) < size,
    spawn, sprites: [], blockers: [], platforms: [], interactables: [],
    tile: tile || (() => 'grass'),
    void: false, // set true on enclosed maps: outside bounds renders black
  };
}
const exitBack = (m, x, z, label = 'Head back outside') =>
  m.interactables.push({ x, z, r: 3.5, label, action: { type: 'map', target: 'overworld', spawn: m.returnSpawn } });

function buildSewer() {
  const m = flat2d({ id: 'sewer', biome: 'sewer', spawn: { x: 0, z: -15 }, size: 60 });
  m.returnSpawn = { x: 112, z: 108 };
  m.flag = 'found_sewer';
  m.void = true;
  m.ground = (x, z) => (Math.abs(z) < 4 ? -1.6 : 2);
  m.water = () => 0.6;
  m.inBounds = (x, z) => Math.abs(x) < 58 && Math.abs(z) < 19;
  m.tile = (x, z) => (Math.abs(z) < 4 ? 'water_sewer' : 'brick');
  for (let i = 0; i < 10; i++) m.sprites.push({ name: 'mushroom_glow', x: -55 + i * 12, z: (i % 2 ? 8 : -8) + hash2(i, 3) * 4, seed: i });
  for (const [bx, bz] of [[-40, 14], [-36, 15], [30, -14], [52, 13]]) m.sprites.push({ name: 'barrel', x: bx, z: bz, seed: 0 });
  exitBack(m, 0, -17, 'Climb the ladder out');
  m.hotspotAreas = [{ x: 0, z: 0, spread: 90 }];
  m.mood = { tint: 'rgba(30,50,20,0.3)' };
  return m;
}
function buildCave() {
  const R = 70;
  const m = flat2d({ id: 'cave', biome: 'cave', spawn: { x: 0, z: 52 }, size: R });
  m.returnSpawn = { x: -316, z: -452 };
  m.flag = 'found_cave';
  m.void = true;
  m.ground = (x, z) => {
    const d = dist2d(x, z, 0, 0);
    return d < 34 ? -4 + (d / 34) * 5.2 : 1.2;
  };
  m.water = () => 0;
  m.inBounds = (x, z) => dist2d(x, z, 0, 0) < R - 4;
  m.tile = (x, z) => (m.ground(x, z) < -0.15 ? 'water_deep' : 'cave_floor');
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const d = 38 + hash2(i, 9) * 22;
    m.sprites.push({ name: 'crystal', x: Math.cos(a) * d, z: Math.sin(a) * d, seed: i });
  }
  for (let i = 0; i < 8; i++) m.sprites.push({ name: 'mushroom_glow', x: -30 + i * 9, z: 40, seed: i });
  exitBack(m, 0, 56, 'Squeeze back through the cave mouth');
  m.hotspotAreas = [{ x: 0, z: 0, spread: 50 }];
  m.mood = { tint: 'rgba(10,20,40,0.42)' };
  return m;
}
function buildReef() {
  const m = flat2d({ id: 'reef', biome: 'reef', spawn: { x: 0, z: 30 }, size: 80 });
  m.returnSpawn = { x: 470, z: 462 };
  m.ground = (x, z) => {
    const d = dist2d(x, z, 0, 34);
    return d < 26 ? 1.8 - (d / 26) * 2.6 : -3.5 - Math.min(8, (d - 26) * 0.25);
  };
  m.water = () => 0;
  m.inBounds = (x, z) => dist2d(x, z, 0, 20) < 70;
  m.tile = (x, z) => {
    const g = m.ground(x, z);
    return g > -0.15 ? 'sand' : g > -4 ? 'water' : 'water_deep';
  };
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const d = 30 + hash2(i, 5) * 24;
    m.sprites.push({ name: 'coral', x: Math.cos(a) * d, z: 20 + Math.sin(a) * d, seed: i });
  }
  m.sprites.push({ name: 'tree_palm', x: 4, z: 38, seed: 3 }, { name: 'boat', x: -2, z: 14, seed: 0 });
  m.interactables.push({ x: -2, z: 14, r: 4.5, label: 'Sail back to Driftwood Docks', action: { type: 'ferry' } });
  m.hotspotAreas = [{ x: 0, z: 0, spread: 90 }];
  return m;
}
function buildDeepsea() {
  const m = flat2d({ id: 'deepsea', biome: 'deepsea', spawn: { x: 0, z: 2 }, size: 60 });
  m.returnSpawn = { x: 470, z: 462 };
  m.ground = () => -30;
  m.water = () => 0;
  m.platforms = [{ x1: -5, x2: 5, z1: -9, z2: 9, y: 1.3, deck: 'wood' }];
  m.inBounds = (x, z) => x > -5 && x < 5 && z > -9 && z < 9;
  m.tile = () => 'water_deep';
  m.sprites.push({ name: 'crate', x: -3.4, z: 6.5, seed: 0 }, { name: 'crate', x: 3.4, z: -6, seed: 1 });
  m.interactables.push({ x: 0, z: 8, r: 3.5, label: 'Take the helm — sail home', action: { type: 'ferry' } });
  m.hotspotAreas = [{ x: 0, z: 0, spread: 70 }];
  return m;
}
function buildRig() {
  const m = flat2d({ id: 'rig', biome: 'rig', spawn: { x: 0, z: 10 }, size: 60 });
  m.returnSpawn = { x: 470, z: 462 };
  m.flag = 'visited_rig';
  m.ground = () => -40;
  m.water = () => 0;
  m.platforms = [
    { x1: -16, x2: 16, z1: -14, z2: 14, y: 3, deck: 'metal' },
    { x1: -6, x2: 16, z1: 14, z2: 26, y: 3, deck: 'metal' },
  ];
  m.inBounds = (x, z) => (x > -16 && x < 16 && z > -14 && z < 14) || (x > -6 && x < 16 && z > 14 && z < 26);
  m.tile = () => 'water_deep';
  m.sprites.push(
    { name: 'derrick', x: -8, z: -4, seed: 0 }, { name: 'container_red', x: 6, z: -8, seed: 0 },
    { name: 'container_blue', x: 9.2, z: -5, seed: 0 }, { name: 'beacon', x: 12, z: -12, seed: 0 },
    { name: 'barrel', x: -13, z: 11.5, seed: 0 }, { name: 'barrel', x: -11.5, z: 11.5, seed: 1 },
  );
  m.blockers.push({ x: -8, z: -4, r: 2.5 });
  m.interactables.push({ x: 10, z: 22, r: 4, label: 'Climb down to the ferry', action: { type: 'ferry' } });
  m.hotspotAreas = [{ x: 0, z: 0, spread: 60 }];
  m.mood = { tint: 'rgba(40,50,60,0.18)' };
  return m;
}
function buildAbyss() {
  const m = flat2d({ id: 'abyss', biome: 'abyss', spawn: { x: 0, z: 4 }, size: 40 });
  m.returnSpawn = { x: 470, z: 462 };
  m.flag = 'visited_abyss';
  m.ground = () => -120;
  m.water = () => 0;
  m.platforms = [{ x1: -7, x2: 7, z1: -7, z2: 7, y: 1.1, deck: 'metal' }];
  m.inBounds = (x, z) => Math.abs(x) < 7 && Math.abs(z) < 7;
  m.tile = () => 'water_deep';
  m.sprites.push({ name: 'beacon', x: -5.6, z: -5.6, seed: 0 }, { name: 'beacon', x: 5.6, z: -5.6, seed: 1 }, { name: 'beacon', x: -5.6, z: 5.6, seed: 2 }, { name: 'beacon', x: 5.6, z: 5.6, seed: 3 });
  m.interactables.push({ x: 0, z: 6, r: 3, label: 'Winch up — return to the light', action: { type: 'ferry' } });
  m.hotspotAreas = [{ x: 0, z: 0, spread: 40 }];
  m.mood = { tint: 'rgba(2,6,20,0.55)', motes: true };
  return m;
}
function buildIsland() {
  const anchor = PORTAL_SPOTS.find((p) => p.id === S.island.spot);
  const inherit = anchor
    ? { town_square: 'harbor', pond_meadow: 'pond', river_bend: 'river', lake_shore: 'lake', coast_dunes: 'coast', docks_edge: 'harbor', swamp_hollow: 'swamp', glacier_foot: 'glacier' }[anchor.id] || 'lake'
    : 'lake';
  const R = 55;
  const m = flat2d({ id: 'island', biome: inherit, spawn: { x: 0, z: 24 }, size: R + 40 });
  m.returnSpawn = anchor ? { x: anchor.x + 6, z: anchor.z + 6 } : { x: 35, z: 94 };
  m.ground = (x, z) => {
    const d = dist2d(x, z, 0, 0);
    if (d < R * 0.62) return 2.2;
    if (d < R) return 2.2 - ((d - R * 0.62) / (R * 0.38)) * 3.6;
    return -1.4 - Math.min(10, (d - R) * 0.2);
  };
  m.water = () => 0;
  m.inBounds = (x, z) => dist2d(x, z, 0, 0) < R + 30;
  m.tile = (x, z) => {
    const g = m.ground(x, z);
    if (g < -3) return 'water_deep';
    if (g < -0.15) return 'water';
    if (g < 1.2) return 'sand';
    return 'grass';
  };
  m.sprites.push({ name: 'portal', x: 0, z: 30, seed: 0 });
  m.interactables.push({ x: 0, z: 30, r: 4, label: 'Step through the portal home', action: { type: 'map', target: 'overworld', spawn: m.returnSpawn } });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    m.sprites.push({ name: 'tree_palm', x: Math.cos(a) * R * 0.72, z: Math.sin(a) * R * 0.72, seed: i });
  }
  const plots = [
    { key: 'farm', x: -20, z: -12 }, { key: 'workshop', x: 20, z: -12 },
    { key: 'brewery', x: -20, z: 12 }, { key: 'shrine', x: 22, z: 14 },
  ];
  for (const plot of plots) {
    const lvl = S.island.buildings[plot.key] || 0;
    const def = BUILDINGS[plot.key];
    m.sprites.push({ name: lvl === 0 ? 'plot_pegs' : 'building_' + plot.key, x: plot.x, z: plot.z, seed: lvl });
    if (lvl > 0) m.blockers.push({ x: plot.x, z: plot.z, r: 3 });
    m.interactables.push({
      x: plot.x, z: plot.z + 4.5, r: 4,
      label: lvl === 0 ? `Build ${def.name}` : `Use ${def.name} ${'★'.repeat(lvl)}`,
      action: { type: 'building', key: plot.key },
    });
  }
  m.sprites.push({ name: 'campfire', x: 0, z: -22, seed: 0 });
  m.hotspotAreas = [{ x: 0, z: 0, spread: 170 }];
  return m;
}

const MAPS2D = { sewer: buildSewer, cave: buildCave, reef: buildReef, deepsea: buildDeepsea, rig: buildRig, abyss: buildAbyss, island: buildIsland };

// ---------------- World2D ----------------
export class World2D {
  constructor() {
    this.map = null;
    this.mapId = null;
    this.hotspots = [];
    this.hotspotTimer = 0;
    this.dayLength = 1200;
    this.gameTime = 0.3;
    this.animT = 0;
  }

  timeKey() {
    const t = this.gameTime % 1;
    if (t > 0.27 && t < 0.72) return 'day';
    if ((t > 0.2 && t <= 0.27) || (t >= 0.72 && t < 0.8)) return 'dawnDusk';
    return 'night';
  }
  clockLabel() {
    const t = this.timeKey();
    return t === 'day' ? 'Day' : t === 'night' ? 'Night' : 'Dusk';
  }

  loadMap(id, spawnHint = null) {
    this.mapId = id;
    this.hotspots = [];
    this.hotspotTimer = 0;
    this.map = id === 'overworld' ? buildOverworld() : MAPS2D[id]();
    // spatial bucket for sprite culling
    this.buckets = new Map();
    for (const s of this.map.sprites) {
      const key = `${Math.floor(s.x / 64)},${Math.floor(s.z / 64)}`;
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key).push(s);
    }
    let sp = spawnHint || this.map.spawn;
    if (!this.walkableAt(sp.x, sp.z)) sp = this.map.spawn;
    visitZone(this.map.zone ? this.map.zone(sp.x, sp.z) : id);
    if (this.map.flag) setFlag(this.map.flag);
    return sp;
  }

  spritesNear(x, z, range = 200) {
    const out = [];
    const c0 = Math.floor((x - range) / 64), c1 = Math.floor((x + range) / 64);
    const r0 = Math.floor((z - range) / 64), r1 = Math.floor((z + range) / 64);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cz = r0; cz <= r1; cz++) {
        const b = this.buckets.get(`${cx},${cz}`);
        if (b) out.push(...b);
      }
    }
    return out;
  }

  // ---- queries (same interface as the 3D World) ----
  heightAt(x, z) { return this.map.ground(x, z); }
  waterLevelAt(x, z) { return this.map.water(x, z); }
  isWaterAt(x, z) { return this.map.ground(x, z) < this.map.water(x, z) - 0.15 && !this.onPlatform(x, z); }
  biomeAt(x, z) { return this.map.biome(x, z); }
  zoneAt(x, z) { return this.map.zone ? this.map.zone(x, z) : this.mapId; }
  walkableAt(x, z) {
    if (!this.map.inBounds(x, z)) return false;
    if (this.onPlatform(x, z)) return true;
    if (this.map.ground(x, z) < this.map.water(x, z) - 0.45) return false;
    for (const b of this.map.blockers) if (dist2d(x, z, b.x, b.z) < b.r) return false;
    return true;
  }
  surfaceYAt() { return 0; }
  onPlatform(x, z) {
    for (const p of this.map.platforms) if (x > p.x1 && x < p.x2 && z > p.z1 && z < p.z2) return true;
    return false;
  }
  hotspotAt(x, z) { return this.hotspots.some((h) => dist2d(x, z, h.x, h.z) < h.r); }
  interactables() { return this.map.interactables || []; }
  tileKindAt(x, z) {
    for (const p of this.map.platforms) {
      if (x > p.x1 && x < p.x2 && z > p.z1 && z < p.z2) return p.deck === 'metal' ? 'metal' : 'wood';
    }
    return this.map.tile(x, z);
  }

  update(dt) {
    this.gameTime = (this.gameTime + dt / this.dayLength) % 1;
    this.animT += dt;
    this.hotspotTimer -= dt;
    if (this.hotspotTimer <= 0) {
      this.hotspotTimer = 45;
      this.refreshHotspots();
    }
  }

  refreshHotspots() {
    if (!this.map.hotspotAreas) return;
    while (this.hotspots.length > 3) this.hotspots.shift();
    const area = this.map.hotspotAreas[Math.floor(Math.random() * this.map.hotspotAreas.length)];
    for (let tries = 0; tries < 24; tries++) {
      const x = area.x + (Math.random() - 0.5) * area.spread;
      const z = area.z + (Math.random() - 0.5) * area.spread;
      if (this.map.ground(x, z) < this.map.water(x, z) - 0.5) {
        this.hotspots.push({ x, z, r: 7 });
        break;
      }
    }
  }

  // day tint color for the renderer overlay
  dayTint() {
    const k = this.timeKey();
    if (this.map?.mood?.tint) return this.map.mood.tint;
    if (this.mapId !== 'overworld') return null;
    if (k === 'night') return 'rgba(14,22,54,0.42)';
    if (k === 'dawnDusk') return 'rgba(255,140,50,0.16)';
    return null;
  }
}
