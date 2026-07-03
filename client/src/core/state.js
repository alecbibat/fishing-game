// Global game state + persistence + derived stats.
import { emit } from './events.js';
import { clamp } from './util.js';
import { ABILITIES, BACKPACK_TIERS, BANK_SLOTS, XP_BY_RARITY, ACH_REWARD } from '../data/static.js';
import { RODS, ATTACHMENTS, BAITS, POTIONS } from '../data/gen-items.js';
import { FISH_BY_ID, TRANSCENDENT } from '../data/gen-fish.js';
import { ACHIEVEMENTS } from '../data/gen-achievements.js';

const SAVE_KEY = 'driftwood-isles-save-v1';

export function defaultState(name = 'Angler') {
  return {
    version: 1,
    name,
    title: null,
    look: { shirt: '#d9663f', pants: '#3f5d8a', hat: '#7a5230', skin: '#f0c49a', hair: '#5d4430' },
    coins: 50,
    xp: 0,
    zone: 'town',
    pos: { x: 35, z: 94 },
    backpackTier: 0,
    rod: { kind: 'tier', id: 'rod_t1' },
    rodTierOwned: 1,
    heroRods: [],
    attachmentsOwned: [],
    attachmentsEquipped: { bobber: null, hook: null, reel: null, gadget: [null, null] },
    baits: { worm_basic: 20 },
    activeBait: 'worm_basic',
    inventory: [],
    bank: [],
    bankCoins: 0,
    dex: {},                       // fishId -> {n, maxLen, maxWt, first}
    achievements: {},              // achId -> {done:ts, claimed:bool}
    titles: [],
    flags: {},
    potions: {},                   // potionId -> count
    activePotions: [],             // {id, until}
    island: {
      spot: null,                  // portal spot id
      buildings: {},               // key -> level (1-based)
      farm: [],                    // [{baitId, ready}]
      lastShrine: 0,
      shrineBuff: null,            // {name, fx, until}
    },
    stats: {
      catches: 0, coinsEarned: 0, potionsBrewed: 0, linesBroken: 0,
      rarities: {}, zones: ['town'], playSeconds: 0, junk: 0, treasures: 0,
      transcendents: [],
    },
    settings: { cozyMode: false, music: true, sfx: true, quality: 'high', announceRares: true },
    createdAt: Date.now(),
  };
}

export let S = defaultState();

// ---------- persistence ----------
export function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { console.warn('save failed', e); }
}
export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    S = Object.assign(defaultState(), data);
    // deep-merge a few nested defaults for forward-compat
    S.island = Object.assign(defaultState().island, data.island || {});
    S.stats = Object.assign(defaultState().stats, data.stats || {});
    S.settings = Object.assign(defaultState().settings, data.settings || {});
    S.attachmentsEquipped = Object.assign({ bobber: null, hook: null, reel: null, gadget: [null, null] }, data.attachmentsEquipped || {});
    return true;
  } catch (e) { console.warn('load failed', e); return false; }
}
export function newGame(name) {
  S = defaultState(name);
  save();
}
export function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
export function importSave(str) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
    if (!data.version) return false;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return loadSave();
  } catch { return false; }
}
if (typeof window !== 'undefined') {
  setInterval(save, 15000);
  window.addEventListener('beforeunload', save);
}

// ---------- XP / levels ----------
export function xpToNext(level) {
  if (level < 100) return Math.floor(30 * Math.pow(level, 1.6) + 20);
  return Math.floor(30 * Math.pow(100, 1.6) + 20 + (level - 100) * 220);
}
export function levelFromXp(xp) {
  let level = 1, rem = xp;
  while (level < 1000) {
    const need = xpToNext(level);
    if (rem < need) break;
    rem -= need; level++;
  }
  return { level, into: rem, need: level >= 1000 ? Infinity : xpToNext(level) };
}
export function getLevel() { return levelFromXp(S.xp).level; }

export function addXp(amount) {
  const before = getLevel();
  S.xp += Math.floor(amount);
  const after = getLevel();
  emit('xp', { amount, total: S.xp });
  if (after > before) {
    const abilities = ABILITIES.filter((a) => a.lvl > before && a.lvl <= after);
    emit('levelup', { level: after, abilities });
    checkAchievements();
  }
}

export function unlockedAbilities() {
  const lvl = getLevel();
  return ABILITIES.filter((a) => a.lvl <= lvl);
}

// ---------- coins ----------
export function addCoins(delta, countEarned = true) {
  S.coins = Math.max(0, S.coins + delta);
  if (delta > 0 && countEarned) S.stats.coinsEarned += delta;
  emit('coins', { delta, total: S.coins });
  if (delta > 0) checkAchievements();
}
export function canAfford(n) { return S.coins >= n; }

// ---------- inventory / bank ----------
export function backpackSlots() { return BACKPACK_TIERS[S.backpackTier].slots; }
export function invFull() { return S.inventory.length >= backpackSlots(); }
export function addToInventory(item) {
  if (invFull()) return false;
  S.inventory.push(item);
  emit('state');
  return true;
}
export function bankDeposit(idx) {
  if (idx < 0 || idx >= S.inventory.length || S.bank.length >= BANK_SLOTS) return false;
  S.bank.push(S.inventory.splice(idx, 1)[0]);
  emit('state');
  return true;
}
export function bankWithdraw(idx) {
  if (idx < 0 || idx >= S.bank.length || invFull()) return false;
  S.inventory.push(S.bank.splice(idx, 1)[0]);
  emit('state');
  return true;
}
export function sellFish(idx, fromBank = false) {
  const arr = fromBank ? S.bank : S.inventory;
  const item = arr[idx];
  if (!item || item.kind !== 'fish') return 0;
  const value = fishValue(item);
  arr.splice(idx, 1);
  addCoins(value);
  emit('state');
  return value;
}
export function fishValue(item) {
  const fish = FISH_BY_ID.get(item.fishId);
  if (!fish) return 1;
  const sizeFactor = 0.6 + 0.8 * ((item.len - fish.minLen) / Math.max(1, fish.maxLen - fish.minLen));
  const fx = getEffects();
  return Math.max(1, Math.floor(fish.price * sizeFactor * (1 + fx.goldBonus)));
}

// ---------- rods / attachments / baits ----------
export function getRodDef() {
  if (S.rod.kind === 'hero') {
    const t = TRANSCENDENT.find((f) => f.rodReward?.id === S.rod.id);
    if (t) {
      // Hero rods: near-top stats plus a signature boost
      const stats = { power: 8, biteRate: 0.35, rareLuck: 0.25, barSize: 0.3, stability: 0.3, slots: 4 };
      stats[t.rodReward.bonus] = (stats[t.rodReward.bonus] || 0) + 0.5;
      return { id: t.rodReward.id, name: t.rodReward.name, flavor: t.rodReward.flavor, tier: 13, stats, hero: true };
    }
  }
  return RODS.find((r) => r.id === S.rod.id) || RODS[0] || { id: 'rod_t1', name: 'Willow Switch', tier: 1, stats: { power: 1, slots: 1 } };
}
export function equippedAttachments() {
  const ids = [S.attachmentsEquipped.bobber, S.attachmentsEquipped.hook, S.attachmentsEquipped.reel, ...S.attachmentsEquipped.gadget];
  return ids.filter(Boolean).map((id) => ATTACHMENTS.find((a) => a.id === id)).filter(Boolean);
}
export function attachmentSlotCount() { return getRodDef().stats.slots || 1; }
export function getBaitDef() { return BAITS.find((b) => b.id === S.activeBait) || null; }
export function consumeBait() {
  const fx = getEffects();
  if (!S.activeBait || !S.baits[S.activeBait]) return;
  if (Math.random() < (fx.baitSaver || 0)) return; // bait saved!
  S.baits[S.activeBait]--;
  if (S.baits[S.activeBait] <= 0) {
    delete S.baits[S.activeBait];
    S.activeBait = Object.keys(S.baits)[0] || null;
  }
  emit('state');
}

// ---------- potions ----------
export function usePotion(id) {
  if (!S.potions[id]) return false;
  const def = POTIONS.find((p) => p.id === id);
  if (!def) return false;
  S.potions[id]--;
  if (S.potions[id] <= 0) delete S.potions[id];
  S.activePotions = S.activePotions.filter((p) => p.id !== id);
  S.activePotions.push({ id, until: Date.now() + def.duration * 60000 });
  if (!S.flags.first_potion_used) setFlag('first_potion_used');
  emit('state');
  return true;
}
export function activePotionDefs() {
  const now = Date.now();
  S.activePotions = S.activePotions.filter((p) => p.until > now);
  return S.activePotions.map((p) => ({ ...POTIONS.find((d) => d.id === p.id), until: p.until })).filter((p) => p.id);
}

// ---------- combined effect totals ----------
// Effect keys: biteRate, rareLuck, barSize, stability, tension, xpBonus, goldBonus,
// sizeBonus, multiCatch, treasure, power, sonar, scope, magnet, autoReel,
// baitSaver, nightLuck, legendLuck, mythicLuck, goldenHour, keenEyes, hotspot, cozyMode, abyss
export function getEffects() {
  const fx = {
    biteRate: 0, rareLuck: 0, barSize: 0, stability: 0, tension: 0, xpBonus: 0,
    goldBonus: 0, sizeBonus: 0, multiCatch: 0, treasure: 0, power: 0,
    sonar: 0, scope: 0, magnet: 0, autoReel: 0, baitSaver: 0,
    nightLuck: 0, legendLuck: 0, mythicLuck: 0, goldenHour: 0, keenEyes: 0, hotspot: 0, cozyMode: 0, abyss: 0,
  };
  const add = (obj, mult = 1) => { if (obj) for (const [k, v] of Object.entries(obj)) fx[k] = (fx[k] || 0) + v * mult; };

  add(getRodDef().stats);
  for (const a of equippedAttachments()) add(a.effects);
  add(getBaitDef()?.effects);
  for (const p of activePotionDefs()) add(p.effects);
  for (const a of unlockedAbilities()) add(a.fx);
  if (S.island.shrineBuff && S.island.shrineBuff.until > Date.now()) add(S.island.shrineBuff.fx);

  const lvl = getLevel();
  if (lvl > 100) { fx.biteRate += (lvl - 100) * 0.001; fx.rareLuck += (lvl - 100) * 0.0005; }
  if (fx.masterAura) { fx.biteRate += 0.05; fx.rareLuck += 0.05; fx.barSize += 0.05; fx.stability += 0.05; }
  if (S.settings.cozyMode && fx.cozyMode) fx.autoReel = 1;
  return fx;
}

// ---------- dex ----------
export function recordCatch(fish, len, wt) {
  const d = S.dex[fish.id] || (S.dex[fish.id] = { n: 0, maxLen: 0, maxWt: 0, first: Date.now() });
  d.n++;
  const record = len > d.maxLen;
  d.maxLen = Math.max(d.maxLen, len);
  d.maxWt = Math.max(d.maxWt, wt);
  S.stats.catches++;
  S.stats.rarities[fish.rarity] = (S.stats.rarities[fish.rarity] || 0) + 1;
  if (fish.rarity === 'transcendent' && !S.stats.transcendents.includes(fish.id)) S.stats.transcendents.push(fish.id);
  return record;
}
export function dexSpeciesCount() { return Object.keys(S.dex).length; }
export function dexBiomeSpecies(biome) {
  let n = 0;
  for (const id of Object.keys(S.dex)) if (FISH_BY_ID.get(id)?.biome === biome) n++;
  return n;
}

// ---------- flags / zones ----------
export function setFlag(flag) {
  if (S.flags[flag]) return;
  S.flags[flag] = true;
  emit('flag', { flag });
  checkAchievements();
}
export function visitZone(zone) {
  S.zone = zone;
  if (!S.stats.zones.includes(zone)) {
    S.stats.zones.push(zone);
    checkAchievements();
  }
  emit('zone', { zone });
}

// ---------- achievements ----------
export function checkAchievements() {
  const lvl = getLevel();
  const rodTier = getRodDef().tier;
  for (const ach of ACHIEVEMENTS) {
    if (S.achievements[ach.id]?.done) continue;
    const c = ach.condition;
    let done = false;
    switch (c.type) {
      case 'catch_count': done = S.stats.catches >= c.n; break;
      case 'unique_species': done = dexSpeciesCount() >= c.n; break;
      case 'rarity_count': done = (S.stats.rarities[c.rarity] || 0) >= c.n; break;
      case 'biome_species': done = dexBiomeSpecies(c.biome) >= c.n; break;
      case 'level': done = lvl >= c.n; break;
      case 'coins_earned': done = S.stats.coinsEarned >= c.n; break;
      case 'potions_brewed': done = S.stats.potionsBrewed >= c.n; break;
      case 'rod_tier': done = rodTier >= c.n; break;
      case 'zones_visited': done = S.stats.zones.length >= c.n; break;
      case 'flag': done = !!S.flags[c.flag]; break;
    }
    if (done) {
      S.achievements[ach.id] = { done: Date.now(), claimed: false };
      emit('achievement', { ach });
    }
  }
}
export function claimAchievement(achId) {
  const ach = ACHIEVEMENTS.find((a) => a.id === achId);
  const st = S.achievements[achId];
  if (!ach || !st?.done || st.claimed) return false;
  st.claimed = true;
  addCoins(ACH_REWARD[ach.tier] || 100, false);
  if (ach.title && !S.titles.includes(ach.title.name)) S.titles.push(ach.title.name);
  emit('state');
  return true;
}
