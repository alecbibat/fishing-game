#!/usr/bin/env node
// Merge content/*.json (agent-authored) into client/src/data/gen-*.js modules,
// deriving balanced numeric stats deterministically.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONTENT = path.join(ROOT, 'content');
const OUT = path.join(ROOT, 'client', 'src', 'data');

const problems = [];
const warn = (msg) => problems.push(msg);

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const SIZE_CLASS = { tiny: [3, 12], small: [10, 30], medium: [25, 70], large: [60, 140], huge: [120, 300], colossal: [250, 900] };
const PRICE_BY_RARITY = { common: 8, uncommon: 22, rare: 65, epic: 210, legendary: 700, mythic: 2400, transcendent: 15000 };
const SIZE_PRICE_MULT = { tiny: 0.7, small: 0.85, medium: 1, large: 1.3, huge: 1.8, colossal: 2.6 };
const WT_FACTOR = { slender: 0.5, standard: 0.85, deep: 1.1, eel: 0.35, flat: 0.7, blob: 1.3, ray: 1.0, shark: 1.05 };
const DIFF_BASE = { common: 2, uncommon: 3, rare: 4.5, epic: 6, legendary: 7.5, mythic: 9, transcendent: 10 };
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const BIOMES = ['pond', 'river', 'lake', 'coast', 'reef', 'deepsea', 'abyss', 'cave', 'sewer', 'swamp', 'glacier', 'harbor', 'rig', 'volcanic'];
const BIOME_ADJ = {
  pond: 'Meadow', river: 'Silverstream', lake: 'Umber', coast: 'Saltwind', reef: 'Coral',
  deepsea: 'Pelagic', abyss: 'Abyssal', cave: 'Hollow', sewer: 'Gutter', swamp: 'Murkfen',
  glacier: 'Frostpeak', harbor: 'Harbor', rig: 'Rustpump', volcanic: 'Ember',
};
const BODIES = Object.keys(WT_FACTOR);
const DEPTHS = ['shallow', 'mid', 'deep'];
const TIMES = ['any', 'day', 'night', 'dawnDusk'];
const BAIT_CATS = ['any', 'worm', 'insect', 'minnow', 'shrimp', 'squid', 'dough', 'grub', 'spinner', 'magic'];

function behaviorFor(fish) {
  const map = { slender: 'darter', standard: 'calm', deep: 'weave', eel: 'weave', flat: 'sinker', blob: 'sinker', ray: 'calm', shark: 'burst' };
  let b = map[fish.body] || 'calm';
  const rank = RARITIES.indexOf(fish.rarity);
  if (rank >= 2 && b === 'calm') b = 'weave';
  if (rank >= 4 && b === 'weave') b = hashStr(fish.name) > 0.5 ? 'darter' : 'burst';
  return b;
}

function deriveFish(raw, biome, usedNames, usedIds) {
  const f = { ...raw };
  f.biome = biome;
  // sanitize enums
  if (!SIZE_CLASS[f.sizeClass]) { warn(`bad sizeClass ${f.sizeClass} on ${f.name}`); f.sizeClass = 'medium'; }
  if (!BODIES.includes(f.body)) { warn(`bad body ${f.body} on ${f.name}`); f.body = 'standard'; }
  if (!DEPTHS.includes(f.depth)) f.depth = 'mid';
  if (!TIMES.includes(f.time)) f.time = 'any';
  if (!BAIT_CATS.includes(f.baitPref)) f.baitPref = 'any';
  if (!Array.isArray(f.features)) f.features = [];
  if (!f.colors || !f.colors.body) f.colors = { body: '#7a9a8a', belly: '#d8d0b8', fin: '#5a7a6a', accent: '#e8c86a' };
  // dedupe names
  let name = String(f.name).trim();
  if (usedNames.has(name.toLowerCase())) {
    const pref = `${BIOME_ADJ[biome] || 'Wild'} ${name}`;
    name = usedNames.has(pref.toLowerCase()) ? `${pref} II` : pref;
    warn(`renamed duplicate "${f.name}" -> "${name}"`);
  }
  usedNames.add(name.toLowerCase());
  f.name = name;
  let id = slug(name);
  while (usedIds.has(id)) id += '_x';
  usedIds.add(id);
  f.id = id;
  // derived numbers (deterministic per name)
  const h = hashStr(name);
  const [lo, hi] = SIZE_CLASS[f.sizeClass];
  f.minLen = Math.round(lo * (0.8 + h * 0.4) * 10) / 10;
  f.maxLen = Math.round(hi * (0.7 + hashStr(name + 'x') * 0.5) * 10) / 10;
  if (f.maxLen < f.minLen * 1.6) f.maxLen = Math.round(f.minLen * 1.6 * 10) / 10;
  f.wtFactor = WT_FACTOR[f.body];
  f.price = Math.max(2, Math.round((PRICE_BY_RARITY[f.rarity] || 8) * (SIZE_PRICE_MULT[f.sizeClass] || 1) * (0.85 + h * 0.3)));
  f.difficulty = clamp(Math.round(((DIFF_BASE[f.rarity] || 3) + (f.depth === 'deep' ? 0.5 : f.depth === 'shallow' ? -0.5 : 0)) * 10) / 10, 1, 10);
  f.behavior = behaviorFor(f);
  if (f.rarity === 'mythic' && !f.effect) f.effect = { type: 'sparkle', color: f.colors.accent };
  return f;
}

// ---------------- fish ----------------
const usedNames = new Set(), usedIds = new Set();
const fish = [];
const fishDir = path.join(CONTENT, 'fish');
const rarityCount = {};
for (const file of fs.readdirSync(fishDir).sort()) {
  if (!file.endsWith('.json') || file === 'transcendent.json') continue;
  const biome = file.replace(/-[ab]\.json$/, '');
  if (!BIOMES.includes(biome)) { warn(`unknown biome file ${file}`); continue; }
  const data = readJson(path.join(fishDir, file));
  for (const raw of data.fish) {
    if (!RARITIES.includes(raw.rarity)) { warn(`bad rarity ${raw.rarity} on ${raw.name}`); raw.rarity = 'common'; }
    const f = deriveFish(raw, biome, usedNames, usedIds);
    rarityCount[f.rarity] = (rarityCount[f.rarity] || 0) + 1;
    fish.push(f);
  }
}

// transcendent legends
const trans = [];
{
  const data = readJson(path.join(fishDir, 'transcendent.json'));
  let whaleFound = false;
  for (const raw of data.fish) {
    raw.rarity = 'transcendent';
    if (!BIOMES.includes(raw.biome)) { warn(`transcendent ${raw.name} bad biome ${raw.biome}`); raw.biome = 'deepsea'; }
    const f = deriveFish(raw, raw.biome, usedNames, usedIds);
    f.rarity = 'transcendent';
    f.title = raw.title || '';
    f.rodReward = raw.rodReward || null;
    f.difficulty = 10;
    f.behavior = 'burst';
    if (!whaleFound && /whale/i.test(f.name + ' ' + (f.title || ''))) { f.isWhale = true; whaleFound = true; }
    trans.push(f);
  }
  if (!whaleFound && trans.length) { trans[0].isWhale = true; warn('no whale found; flagged first transcendent as the whale'); }
}

// ---------------- achievements ----------------
function tierFor(a) {
  const c = a.condition, n = c.n || 1;
  const t = (i) => ['bronze', 'silver', 'gold', 'platinum', 'mythic'][clamp(i, 0, 4)];
  switch (c.type) {
    case 'catch_count': return t(n <= 10 ? 0 : n <= 100 ? 1 : n <= 1000 ? 2 : n <= 5000 ? 3 : 4);
    case 'unique_species': return t(n <= 10 ? 0 : n <= 50 ? 1 : n <= 250 ? 2 : n <= 600 ? 3 : 4);
    case 'rarity_count': {
      const base = { rare: 0, epic: 1, legendary: 2, mythic: 3, transcendent: 4 }[c.rarity] ?? 1;
      return t(base + (n >= 10 ? 1 : 0));
    }
    case 'biome_species': return t(n <= 5 ? 0 : n <= 15 ? 1 : n <= 30 ? 2 : 3);
    case 'level': return t(n <= 10 ? 0 : n <= 50 ? 1 : n <= 100 ? 2 : n <= 500 ? 3 : 4);
    case 'coins_earned': return t(n <= 1000 ? 0 : n <= 25000 ? 1 : n <= 250000 ? 2 : n <= 1000000 ? 3 : 4);
    case 'potions_brewed': return t(n <= 1 ? 0 : n <= 10 ? 1 : n <= 50 ? 2 : 3);
    case 'rod_tier': return t(n <= 3 ? 0 : n <= 6 ? 1 : n <= 9 ? 2 : 3);
    case 'zones_visited': return t(n <= 4 ? 0 : n <= 8 ? 1 : n <= 12 ? 2 : 3);
    case 'flag': return ['caught_transcendent', 'legend_whale'].includes(c.flag) ? 'mythic' : 'gold';
    default: return 'bronze';
  }
}
const achData = readJson(path.join(CONTENT, 'achievements.json')).achievements;
const CONDS = ['catch_count', 'unique_species', 'rarity_count', 'biome_species', 'level', 'coins_earned', 'potions_brewed', 'rod_tier', 'zones_visited', 'flag'];
const achievements = [];
const achIds = new Set();
for (const a of achData) {
  if (!CONDS.includes(a.condition?.type)) { warn(`bad achievement condition on ${a.id}`); continue; }
  if (achIds.has(a.id)) { warn(`dup achievement id ${a.id}`); continue; }
  achIds.add(a.id);
  a.tier = tierFor(a);
  achievements.push(a);
}

// ---------------- npcs ----------------
const npcs = readJson(path.join(CONTENT, 'npcs.json')).npcs.map((n) => ({
  appearance: { shirt: '#d9663f', pants: '#3f5d8a', hat: null, skin: '#f0c49a', hair: '#5d4430', ...(n.appearance || {}) },
  lines: [], greeting: 'Hello there.', zone: 'town',
  ...n,
}));

// ---------------- items ----------------
const FX_RANGES = {
  biteRate: [0, 0.6], rareLuck: [0, 0.5], barSize: [0, 0.4], stability: [0, 0.5], tension: [0, 0.5],
  xpBonus: [0, 0.6], goldBonus: [0, 0.6], sizeBonus: [0, 0.5], multiCatch: [0, 0.25], treasure: [0, 0.3],
  sonar: [0, 1], scope: [0, 1], magnet: [0, 1], autoReel: [0, 1],
};
function clampFx(effects, owner) {
  const out = {};
  for (const [k, v] of Object.entries(effects || {})) {
    if (!FX_RANGES[k]) { warn(`unknown effect ${k} on ${owner}`); continue; }
    out[k] = clamp(Number(v) || 0, FX_RANGES[k][0], FX_RANGES[k][1]);
  }
  return out;
}
const attachments = readJson(path.join(CONTENT, 'attachments.json')).attachments.map((a) => ({
  ...a, effects: clampFx(a.effects, a.id),
}));
const potions = readJson(path.join(CONTENT, 'potions.json')).potions.map((p) => ({
  ...p,
  duration: clamp(p.duration || 10, 3, 45),
  effects: clampFx(p.effects, p.id),
  ingredients: (p.ingredients || []).filter((ing) => {
    const ok = (ing.kind === 'rarity' && RARITIES.includes(ing.value))
      || (ing.kind === 'biome' && BIOMES.includes(ing.value))
      || (ing.kind === 'sizeClass' && SIZE_CLASS[ing.value]);
    if (!ok) warn(`bad ingredient ${JSON.stringify(ing)} on ${p.id}`);
    return ok;
  }).map((ing) => ({ ...ing, n: clamp(ing.n || 1, 1, 10) })),
}));
let baits = readJson(path.join(CONTENT, 'baits.json')).baits.map((b) => ({
  ...b, effects: clampFx(b.effects, b.id),
}));
// guarantee the starter bait id exists
const starter = baits.find((b) => b.category === 'worm' && b.tier === 1 && !b.farmOnly)
  || baits.find((b) => b.tier === 1 && !b.farmOnly);
if (starter) {
  warn(`starter bait: "${starter.name}" -> id worm_basic`);
  starter.id = 'worm_basic';
} else {
  baits.unshift({ id: 'worm_basic', name: 'Garden Worm', category: 'worm', tier: 1, price: 5, flavor: 'Wiggly. Dependable. A classic.', effects: { biteRate: 0.05 } });
}
const rods = readJson(path.join(CONTENT, 'rods.json')).rods
  .sort((a, b) => a.tier - b.tier)
  .map((r, i) => {
    if (r.tier !== i + 1) warn(`rod tier gap at ${r.id}`);
    r.id = `rod_t${r.tier}`;
    r.stats = { power: clamp(r.stats.power || 1, 1, 10), biteRate: clamp(r.stats.biteRate || 0, 0, 0.6), rareLuck: clamp(r.stats.rareLuck || 0, 0, 0.5), barSize: clamp(r.stats.barSize || 0, 0, 0.5), stability: clamp(r.stats.stability || 0, 0, 0.5), slots: clamp(r.stats.slots || 1, 1, 4) };
    r.cost = { coins: Math.max(0, r.cost?.coins || 0), fish: (r.cost?.fish || []).filter((f) => (f.kind === 'rarity' && RARITIES.includes(f.value)) || (f.kind === 'biome' && BIOMES.includes(f.value))).map((f) => ({ ...f, n: clamp(f.n || 1, 1, 10) })) };
    return r;
  });

// ---------------- zones ----------------
const ZONE_KEYS = ['town', 'pond', 'river', 'lake', 'coast', 'docks', 'swamp', 'glacier', 'volcanic', 'sewer', 'cave', 'reef', 'deepsea', 'rig', 'abyss', 'island'];
const zonesRaw = readJson(path.join(CONTENT, 'zones.json')).zones;
const zones = {};
for (const k of ZONE_KEYS) {
  zones[k] = zonesRaw[k] || { displayName: k, tagline: '', sign: '', description: '', secretHint: '' };
  if (!zonesRaw[k]) warn(`missing zone lore for ${k}`);
}

// ---------------- write modules ----------------
const banner = '// GENERATED by scripts/merge-content.js — do not edit by hand.\n';
function write(name, content) {
  fs.writeFileSync(path.join(OUT, name), banner + content);
  console.log(`wrote ${name} (${(content.length / 1024).toFixed(0)} kB)`);
}
write('gen-fish.js', `export const FISH = ${JSON.stringify(fish)};
export const TRANSCENDENT = ${JSON.stringify(trans)};
export const FISH_BY_ID = new Map([...FISH, ...TRANSCENDENT].map((f) => [f.id, f]));
export const FISH_BY_BIOME = {};
for (const f of FISH) (FISH_BY_BIOME[f.biome] = FISH_BY_BIOME[f.biome] || []).push(f);
`);
write('gen-items.js', `export const ATTACHMENTS = ${JSON.stringify(attachments)};
export const BAITS = ${JSON.stringify(baits)};
export const POTIONS = ${JSON.stringify(potions)};
export const RODS = ${JSON.stringify(rods)};
`);
write('gen-achievements.js', `export const ACHIEVEMENTS = ${JSON.stringify(achievements)};\n`);
write('gen-npcs.js', `export const NPCS = ${JSON.stringify(npcs)};\n`);
write('gen-zones.js', `export const ZONE_LORE = ${JSON.stringify(zones)};\n`);

console.log(`\n=== SUMMARY ===`);
console.log(`fish: ${fish.length} + ${trans.length} transcendent = ${fish.length + trans.length}`);
console.log(`rarities:`, rarityCount);
console.log(`achievements: ${achievements.length}, npcs: ${npcs.length}, attachments: ${attachments.length}, baits: ${baits.length}, potions: ${potions.length}, rods: ${rods.length}`);
if (problems.length) {
  console.log(`\n${problems.length} warnings:`);
  for (const p of problems.slice(0, 40)) console.log('  -', p);
  if (problems.length > 40) console.log(`  …and ${problems.length - 40} more`);
}
