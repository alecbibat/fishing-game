// Fishing: cast → wait → bite → reel minigame → catch. Loot rolls, records, events.
// 2D presentation: the renderer draws the bobber/line from this.bobber state.
import { $, clamp, lerp, randRange, rarityRank, RARITY_COLOR } from '../core/util.js';
import { emit } from '../core/events.js';
import {
  S, getEffects, addXp, addCoins, addToInventory, recordCatch,
  consumeBait, getBaitDef, setFlag, checkAchievements, fishValue,
} from '../core/state.js';
import { FISH_BY_BIOME, TRANSCENDENT } from '../data/gen-fish.js';
import { XP_BY_RARITY, JUNK, TREASURE } from '../data/static.js';
import { showCatchCard } from '../ui/catchcard.js';

const RARITY_WEIGHTS = { common: 100, uncommon: 42, rare: 16, epic: 4.5, legendary: 1.3, mythic: 0.28 };

// ---------------- loot ----------------
export function rollLoot(biome, depthBucket, timeKey, fx, hotspot) {
  const treasureChance = 0.02 + fx.treasure;
  const junkChance = 0.1;
  let r = Math.random();
  if (r < treasureChance) return { type: 'treasure', item: TREASURE[Math.floor(Math.pow(Math.random(), 1.8) * TREASURE.length)] };
  if (r < treasureChance + junkChance) {
    if (fx.magnet && Math.random() < 0.65) return { type: 'treasure', item: TREASURE[Math.floor(Math.pow(Math.random(), 1.5) * TREASURE.length)] };
    return { type: 'junk', item: JUNK[Math.floor(Math.random() * JUNK.length)] };
  }
  const trans = TRANSCENDENT.filter((f) => f.biome === biome);
  if (trans.length && Math.random() < 0.0022 * (1 + fx.rareLuck) * (hotspot ? 1.5 : 1)) {
    const fish = trans[Math.floor(Math.random() * trans.length)];
    return { type: 'fish', fish, transcendent: true };
  }
  const luck = (1 + fx.rareLuck) * (hotspot ? 1.35 : 1) * (timeKey === 'night' ? 1 + (fx.nightLuck || 0) : 1);
  const w = { ...RARITY_WEIGHTS };
  w.rare *= luck; w.epic *= luck;
  w.legendary *= luck * (1 + (fx.legendLuck || 0));
  w.mythic *= luck * (1 + (fx.mythicLuck || 0));
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total, rarity = 'common';
  for (const [k, v] of Object.entries(w)) { roll -= v; if (roll <= 0) { rarity = k; break; } }
  const pool = FISH_BY_BIOME[biome] || [];
  const bait = getBaitDef();
  const filters = [
    (f) => f.rarity === rarity && (f.depth === depthBucket) && (f.time === 'any' || f.time === timeKey),
    (f) => f.rarity === rarity && (f.time === 'any' || f.time === timeKey),
    (f) => f.rarity === rarity,
    (f) => rarityRank(f.rarity) <= rarityRank(rarity),
  ];
  let candidates = [];
  for (const flt of filters) {
    candidates = pool.filter(flt);
    if (candidates.length) break;
  }
  if (!candidates.length) return { type: 'junk', item: JUNK[0] };
  const weights = candidates.map((f) => (bait && f.baitPref === bait.category ? 2.4 : f.baitPref === 'any' ? 1.15 : 1));
  const wTotal = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * wTotal;
  let fish = candidates[0];
  for (let i = 0; i < candidates.length; i++) { pick -= weights[i]; if (pick <= 0) { fish = candidates[i]; break; } }
  return { type: 'fish', fish };
}

export function rollSize(fish, fx) {
  const t = Math.pow(Math.random(), 2.1 / (1 + (fx.sizeBonus || 0)));
  const len = fish.minLen + (fish.maxLen - fish.minLen) * t;
  const wt = fish.wtFactor * Math.pow(len / 30, 2.6);
  return { len: Math.round(len * 10) / 10, wt: Math.round(wt * 100) / 100 };
}

// ---------------- fishing controller ----------------
export class Fishing {
  constructor(world, player, opts = {}) {
    this.world = world;
    this.player = player;
    this.onAnnounce = opts.onAnnounce || (() => {});
    this.phase = 'idle';
    this.t = 0;
    this.consecutiveHere = 0;
    this.lastSpot = null;

    // bobber state (drawn by renderer2d)
    this.bobber = { visible: false, x: 0, z: 0, dip: 0 };

    this.ui = {
      root: $('#fishing-ui'), castMeter: $('#cast-meter'), castFill: $('#cast-fill'),
      bite: $('#bite-alert'), reel: $('#timing-panel'),
      tBar: $('#timing-bar'), tZone: $('#timing-zone'), tMarker: $('#timing-marker'),
      tPips: $('#timing-pips'), tName: $('#timing-name'),
      sonar: $('#fish-info-sonar'), hint: $('#action-hint'),
    };
  }

  get active() { return this.phase !== 'idle'; }

  canFishHere() {
    for (let d = 4; d < 14; d += 2) {
      const p = this.player.facingPoint(d);
      if (this.world.isWaterAt(p.x, p.z)) return true;
    }
    return false;
  }

  tryStartCast(mode = 'hold') {
    if (this.active) return false;
    if (!S.activeBait) { emit('toast', { text: 'You need bait!', sub: 'Buy some at the Bait Shop in Willowbrook.' }); return false; }
    if (!this.canFishHere()) return false;
    this.phase = 'casting';
    this.castMode = mode;
    this.castT = 0;
    this.castPower = 0;
    this.player.frozen = true;
    this.player.rig.userData.rod.visible = true;
    this.player.rig.userData.setAnim('fish');
    this.ui.root.classList.remove('hidden');
    this.ui.castMeter.classList.remove('hidden');
    this.ui.hint.textContent = mode === 'click' ? 'Click again to cast!' : '';
    emit('fishing', { phase: 'casting' });
    return true;
  }

  // Stardew-style: click a water spot to cast straight at it (range-capped)
  castAt(tx, tz) {
    if (this.active) return false;
    if (!S.activeBait) { emit('toast', { text: 'You need bait!', sub: 'Buy some at the Bait Shop in Willowbrook.' }); return false; }
    const fx = getEffects();
    const maxDist = 6 + (fx.power || 1) * 2.2 + (fx.scope ? 9 : 0) + 4;
    const dx = tx - this.player.x, dz = tz - this.player.z;
    const d = Math.hypot(dx, dz);
    if (d < 2) return false;
    const ang = Math.atan2(dx, dz);
    this.player.ry = ang;
    this.player.rig.rotation.y = ang;
    const dist = Math.min(d, maxDist);
    // find water along the ray up to dist
    let target = null;
    for (let dd = dist; dd >= 3; dd -= 1.2) {
      const p = { x: this.player.x + Math.sin(ang) * dd, z: this.player.z + Math.cos(ang) * dd };
      if (this.world.isWaterAt(p.x, p.z)) { target = p; break; }
    }
    if (!target) return false;
    this.player.frozen = true;
    this.player.rig.userData.rod.visible = true;
    this.player.rig.userData.setAnim('fish');
    this.ui.root.classList.remove('hidden');
    this.phase = 'casting'; // so beginWait can transition cleanly
    this.beginWait(target, fx);
    return true;
  }

  releaseCast() {
    if (this.phase !== 'casting') return;
    const power = this.castPower;
    const fx = getEffects();
    const maxDist = 6 + (fx.power || 1) * 2.2 + (fx.scope ? 9 : 0);
    const dist = 4 + power * maxDist;
    let target = null;
    for (let d = dist; d >= 3; d -= 1.2) {
      const p = this.player.facingPoint(d);
      if (this.world.isWaterAt(p.x, p.z)) { target = p; break; }
    }
    if (!target) { this.cancel('No water in reach.'); return; }
    this.ui.castMeter.classList.add('hidden');
    this.beginWait(target, fx);
  }

  beginWait(target, fx) {
    this.bobberPos = target;
    this.bobber.visible = true;
    this.bobber.x = target.x;
    this.bobber.z = target.z;
    this.bobber.dip = 0;

    const depth = this.world.waterLevelAt(target.x, target.z) - this.world.heightAt(target.x, target.z);
    this.depthBucket = depth < 3.5 ? 'shallow' : depth < 9 ? 'mid' : 'deep';
    this.biome = this.world.biomeAt(target.x, target.z);
    this.hotspot = this.world.hotspotAt(target.x, target.z);
    this.fx = fx;
    this.loot = rollLoot(this.biome, this.depthBucket, this.world.timeKey(), fx, this.hotspot);

    this.phase = 'waiting';
    this.waitT = 0;
    const base = randRange(4, 12) / (1 + fx.biteRate);
    this.biteAt = this.hotspot ? base * 0.55 : base;
    if (this.loot.transcendent) this.biteAt += 3;
    this.nibbleAt = this.biteAt * randRange(0.3, 0.7);
    this.nibbled = false;

    if (fx.sonar && this.loot.type === 'fish') {
      const f = this.loot.fish;
      this.ui.hint.innerHTML = `Sonar: a <b style="color:${RARITY_COLOR[f.rarity]}">${f.rarity.toUpperCase()}</b> ${f.sizeClass} shape circles your line…`;
    } else {
      this.ui.hint.textContent = this.hotspot ? 'The water bubbles with activity…' : '';
    }
    emit('fishing', { phase: 'waiting' });
  }

  hook() {
    if (this.phase !== 'bite') return;
    this.ui.bite.classList.add('hidden');
    consumeBait();
    if (this.loot.type !== 'fish') { this.resolveNonFish(); return; }
    const f = this.loot.fish;
    this.phase = 'timing';
    const diff = this.loot.transcendent ? 10 : f.difficulty;
    const fx = this.fx;
    const rank = rarityRank(f.rarity);
    const rounds = this.loot.transcendent ? 4 : rank >= 4 ? 3 : rank >= 2 ? 2 : 1;
    this.game = {
      pos: 0, dir: 1,
      speed: (0.85 + diff * 0.13) * (1 - clamp(fx.stability, 0, 0.6) * 0.5),
      zoneC: randRange(0.2, 0.8),
      zoneW: clamp(0.34 * (1 + fx.barSize) - diff * 0.014, 0.1, 0.55),
      round: 1, rounds,
      grace: fx.tension >= 0.2 ? 1 : 0,
      roundT: 0,
      flash: 0,
      prevPress: true, // require a fresh press after hooking
      diff,
    };
    this.ui.reel.classList.remove('hidden');
    this.renderTiming(f);
    if (fx.sonar) {
      this.ui.sonar.classList.remove('hidden');
      this.ui.sonar.textContent = `${f.rarity.toUpperCase()} · ${f.sizeClass}`;
      this.ui.sonar.style.color = RARITY_COLOR[f.rarity];
    } else this.ui.sonar.classList.add('hidden');
    this.ui.hint.textContent = 'Tap when the marker crosses the golden zone!';
    emit('fishing', { phase: 'timing' });
  }

  renderTiming(f) {
    const g = this.game;
    this.ui.tName.textContent = this.fx.sonar || g.round > 1 ? f.name : 'Something on the line…';
    this.ui.tName.style.color = this.fx.sonar || g.round > 1 ? RARITY_COLOR[f.rarity] : '#f2ead4';
    this.ui.tZone.style.left = `${(g.zoneC - g.zoneW / 2) * 100}%`;
    this.ui.tZone.style.width = `${g.zoneW * 100}%`;
    this.ui.tPips.innerHTML = '';
    for (let i = 0; i < g.rounds; i++) {
      const pip = document.createElement('span');
      pip.className = 'timing-pip' + (i < g.round - 1 ? ' filled' : '');
      this.ui.tPips.append(pip);
    }
  }

  resolveNonFish() {
    const { type, item } = this.loot;
    if (type === 'treasure') {
      addCoins(item.value);
      S.stats.treasures++;
      emit('toast', { text: `Treasure! ${item.name}`, sub: `+${item.value} coins`, kind: 'achieve', icon: 'treasure' });
    } else {
      S.stats.junk++;
      emit('toast', { text: `…just a ${item.name}.`, sub: 'The sea has moods.', icon: 'junk' });
    }
    emit('junk', { name: item.name });
    this.finish();
  }

  update(dt, t, input) {
    this.t = t;
    if (this.phase === 'idle') return;
    const hold = input.pointerDown || input.keys['Space'];

    if (this.phase === 'casting') {
      this.castT += dt;
      this.castPower = Math.abs(Math.sin(this.castT * 2.4));
      this.ui.castFill.style.width = `${this.castPower * 100}%`;
      if (this.castMode === 'click') {
        if (input.consumeClick() || (this.castT > 0.2 && input.keys['Space'])) this.releaseCast();
      } else if (!hold) this.releaseCast();
      return;
    }

    if (this.phase === 'waiting') {
      this.waitT += dt;
      this.bobber.dip = Math.sin(t * 2.2) * 0.5;
      if (!this.nibbled && this.waitT > this.nibbleAt) {
        this.nibbled = true;
        this.bobber.dip = -1.4;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.keys[k])) { this.cancel(); return; }
      if (this.waitT > this.biteAt) {
        this.phase = 'bite';
        this.biteT = 0;
        this.ui.bite.classList.remove('hidden');
        if (this.loot.transcendent) {
          this.ui.bite.textContent = '!!';
          emit('toast', { text: 'The water darkens…', sub: 'Something VAST has taken your hook.', kind: 'achieve' });
        } else this.ui.bite.textContent = '!';
        emit('fishing', { phase: 'bite' });
      }
      return;
    }

    if (this.phase === 'bite') {
      this.biteT += dt;
      this.bobber.dip = -2 + Math.sin(t * 18) * 0.8;
      const windowLen = this.loot.transcendent ? 1.4 : 1.0;
      if (this.fx.autoReel && this.biteT > 0.4) { this.hook(); return; }
      if (hold || input.consumeClick()) { this.hook(); return; }
      if (this.biteT > windowLen) {
        this.ui.bite.classList.add('hidden');
        this.phase = 'waiting';
        this.waitT = 0;
        this.loot = rollLoot(this.biome, this.depthBucket, this.world.timeKey(), this.fx, this.hotspot);
        this.biteAt = randRange(4, 12) / (1 + this.fx.biteRate);
        this.nibbleAt = this.biteAt * 0.5;
        this.nibbled = false;
        this.ui.hint.textContent = 'It slipped away…';
      }
      return;
    }

    if (this.phase === 'timing') {
      const g = this.game;
      const f = this.loot.fish;
      // sweep the marker (triangle wave)
      g.pos += g.dir * g.speed * dt;
      if (g.pos > 1) { g.pos = 1; g.dir = -1; }
      if (g.pos < 0) { g.pos = 0; g.dir = 1; }
      g.roundT += dt;
      g.flash = Math.max(0, g.flash - dt * 3);

      // fresh press detection (tap / click / space)
      const pressNow = hold;
      const clicked = input.consumeClick();
      const press = (pressNow && !g.prevPress) || clicked;
      g.prevPress = pressNow;

      const inZone = Math.abs(g.pos - g.zoneC) < g.zoneW / 2;
      const auto = this.fx.autoReel && inZone && Math.abs(g.pos - g.zoneC) < g.zoneW * 0.3;

      if (press || auto) {
        if (inZone) {
          g.round++;
          if (g.round > g.rounds) { this.land(); return; }
          // next round: new zone, tighter and faster
          g.zoneC = randRange(0.15, 0.85);
          g.zoneW = Math.max(0.07, g.zoneW * 0.85);
          g.speed *= 1.18;
          g.roundT = 0;
          g.flash = 1;
          this.renderTiming(f);
          emit('toast', { text: `Hooked! ${g.rounds - g.round + 1} more…`, sub: 'keep your rhythm' });
        } else if (g.grace > 0) {
          g.grace--;
          this.ui.hint.textContent = 'The line holds! One more chance…';
        } else {
          this.escape();
          return;
        }
      }
      // a fish won't wait forever
      if (g.roundT > 14) { this.escape(); return; }

      this.ui.tMarker.style.left = `${g.pos * 100}%`;
      this.ui.tBar.classList.toggle('zone-hot', inZone);
      this.ui.tBar.style.boxShadow = g.flash > 0 ? `0 0 ${18 * g.flash}px rgba(255,220,90,.8)` : '';
      this.bobber.dip = -1 + Math.sin(t * 14) * 0.8;
    }
  }

  escape() {
    S.stats.linesBroken++;
    if (S.stats.linesBroken >= 10) setFlag('broke_line_10');
    this.ui.reel.classList.add('hidden');
    emit('toast', { text: 'Snap! It got away…', sub: this.loot.transcendent ? 'The legend sinks back into the dark.' : 'Your line broke.' });
    this.finish();
  }

  land() {
    const f = this.loot.fish;
    const fx = this.fx;
    const { len, wt } = rollSize(f, fx);
    const record = recordCatch(f, len, wt);
    const zone = S.zone;

    const item = { kind: 'fish', fishId: f.id, len, wt };
    let sold = 0;
    if (!addToInventory(item)) {
      sold = Math.floor(fishValue(item) * 0.6);
      addCoins(sold);
    }
    // double hook!
    if (f.rarity !== 'transcendent' && Math.random() < (fx.multiCatch || 0)) {
      const twin = rollSize(f, fx);
      recordCatch(f, twin.len, twin.wt);
      const twinItem = { kind: 'fish', fishId: f.id, len: twin.len, wt: twin.wt };
      if (!addToInventory(twinItem)) addCoins(Math.floor(fishValue(twinItem) * 0.6));
      emit('toast', { text: 'Double hook!', sub: `Two ${f.name} on one line!`, kind: 'achieve' });
    }
    let xp = (XP_BY_RARITY[f.rarity] || 10) * (0.8 + (len / f.maxLen) * 0.6) * (1 + fx.xpBonus);
    if (this.world.timeKey() === 'dawnDusk' && fx.goldenHour) xp *= 1 + fx.goldenHour;
    addXp(xp);

    const tk = this.world.timeKey();
    if (tk === 'night') setFlag('caught_at_night');
    if (tk === 'dawnDusk') setFlag('caught_dawn');
    if (f.rarity === 'transcendent') {
      setFlag('caught_transcendent');
      if (f.isWhale) setFlag('legend_whale');
      if (f.rodReward && !S.heroRods.includes(f.rodReward.id)) {
        S.heroRods.push(f.rodReward.id);
        emit('toast', { text: `${f.rodReward.name}!`, sub: 'A hero\'s rod surfaces with your catch! Equip it in the Rod window.', kind: 'achieve' });
      }
    }
    const spotKey = `${Math.round(this.player.x / 8)},${Math.round(this.player.z / 8)}`;
    this.consecutiveHere = spotKey === this.lastSpot ? this.consecutiveHere + 1 : 1;
    this.lastSpot = spotKey;
    if (this.consecutiveHere >= 10) setFlag('cozy_hour');

    checkAchievements();
    emit('catch', { fish: f, len, wt, record, zone, sold });
    showCatchCard(f, len, wt, record, sold);
    if (rarityRank(f.rarity) >= 2) {
      this.onAnnounce({ fishId: f.id, name: f.name, rarity: f.rarity, len });
    }
    this.finish();
  }

  cancel(msg) {
    if (msg) emit('toast', { text: msg });
    this.finish();
  }

  finish() {
    this.phase = 'idle';
    this.player.frozen = false;
    this.player.rig.userData.rod.visible = false;
    this.player.rig.userData.setAnim('idle');
    this.bobber.visible = false;
    this.ui.castMeter.classList.add('hidden');
    this.ui.bite.classList.add('hidden');
    this.ui.reel.classList.add('hidden');
    this.ui.sonar.classList.add('hidden');
    this.ui.root.classList.add('hidden');
    this.ui.hint.textContent = '';
    emit('fishing', { phase: 'idle' });
  }
}
