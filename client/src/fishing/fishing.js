// Fishing: cast → wait → bite → reel minigame → catch. Loot rolls, records, events.
import * as THREE from '../../vendor/three.module.js';
import { $, clamp, lerp, randRange, rarityRank, RARITY_COLOR, fmtLen, fmtWt } from '../core/util.js';
import { emit } from '../core/events.js';
import {
  S, getEffects, addXp, addCoins, addToInventory, invFull, recordCatch,
  consumeBait, getBaitDef, setFlag, checkAchievements, fishValue,
} from '../core/state.js';
import { FISH_BY_BIOME, FISH_BY_ID, TRANSCENDENT } from '../data/gen-fish.js';
import { XP_BY_RARITY, JUNK, TREASURE } from '../data/static.js';
import { makeFishMesh, makeEffectParticles } from './fishmesh.js';
import { emissiveMat } from '../world/prims.js';

const RARITY_WEIGHTS = { common: 100, uncommon: 42, rare: 16, epic: 4.5, legendary: 1.3, mythic: 0.28 };

// ---------------- loot ----------------
export function rollLoot(biome, depthBucket, timeKey, fx, hotspot) {
  // junk / treasure
  const treasureChance = 0.02 + fx.treasure;
  const junkChance = 0.1;
  let r = Math.random();
  if (r < treasureChance) return { type: 'treasure', item: TREASURE[Math.floor(Math.pow(Math.random(), 1.8) * TREASURE.length)] };
  if (r < treasureChance + junkChance) {
    if (fx.magnet && Math.random() < 0.65) return { type: 'treasure', item: TREASURE[Math.floor(Math.pow(Math.random(), 1.5) * TREASURE.length)] };
    return { type: 'junk', item: JUNK[Math.floor(Math.random() * JUNK.length)] };
  }
  // transcendent event
  const trans = TRANSCENDENT.filter((f) => f.biome === biome);
  if (trans.length && Math.random() < 0.0022 * (1 + fx.rareLuck) * (hotspot ? 1.5 : 1)) {
    const fish = trans[Math.floor(Math.random() * trans.length)];
    return { type: 'fish', fish, transcendent: true };
  }
  // rarity roll
  const luck = (1 + fx.rareLuck) * (hotspot ? 1.35 : 1) * (timeKey === 'night' ? 1 + (fx.nightLuck || 0) : 1);
  const w = { ...RARITY_WEIGHTS };
  w.rare *= luck; w.epic *= luck;
  w.legendary *= luck * (1 + (fx.legendLuck || 0));
  w.mythic *= luck * (1 + (fx.mythicLuck || 0));
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total, rarity = 'common';
  for (const [k, v] of Object.entries(w)) { roll -= v; if (roll <= 0) { rarity = k; break; } }
  // candidates with progressive relaxation
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
  // weight by bait preference
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
  constructor(scene, world, player, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.onAnnounce = opts.onAnnounce || (() => {});
    this.phase = 'idle';
    this.t = 0;
    this.consecutiveHere = 0;
    this.lastSpot = null;

    // bobber + line
    this.bobber = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), emissiveMat('#ff5a4e', 0.3));
    ball.position.y = 0.1;
    const ringGeo = new THREE.RingGeometry(0.3, 0.5, 16);
    this.ripple = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#dff6f2', transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    this.ripple.rotation.x = -Math.PI / 2;
    this.bobber.add(ball, this.ripple);
    this.bobber.visible = false;
    scene.add(this.bobber);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: '#e8e4d8', transparent: true, opacity: 0.85 }));
    this.line.visible = false;
    scene.add(this.line);

    this.catchDisplay = null;

    // DOM refs
    this.ui = {
      root: $('#fishing-ui'), castMeter: $('#cast-meter'), castFill: $('#cast-fill'),
      bite: $('#bite-alert'), reel: $('#reel-panel'), fish: $('#reel-fish'), bar: $('#reel-bar'),
      progress: $('#reel-progress'), tension: $('#tension-fill'), qte: $('#qte-prompt'),
      sonar: $('#fish-info-sonar'), hint: $('#action-hint'), banner: $('#catch-banner'),
    };
  }

  get active() { return this.phase !== 'idle'; }

  canFishHere() {
    // find water in front of the player
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
    this.player.frozen = true;
    this.player.rig.userData.rod.visible = true;
    this.player.rig.userData.setAnim('fish');
    this.ui.root.classList.remove('hidden');
    this.ui.castMeter.classList.remove('hidden');
    this.ui.hint.textContent = mode === 'click' ? 'Click again to cast!' : '';
    emit('fishing', { phase: 'casting' });
    return true;
  }

  releaseCast() {
    if (this.phase !== 'casting') return;
    const power = this.castPower;
    const fx = getEffects();
    const maxDist = 6 + (fx.power || 1) * 2.2 + (fx.scope ? 9 : 0);
    let dist = 4 + power * maxDist;
    // walk back from target until water
    let target = null;
    for (let d = dist; d >= 3; d -= 1.2) {
      const p = this.player.facingPoint(d);
      if (this.world.isWaterAt(p.x, p.z)) { target = { ...p, d }; break; }
    }
    if (!target) { this.cancel('No water in reach.'); return; }
    this.ui.castMeter.classList.add('hidden');
    this.bobberPos = target;
    const wl = this.world.waterLevelAt(target.x, target.z);
    this.bobber.position.set(target.x, wl + 0.05, target.z);
    this.bobber.visible = true;
    this.line.visible = true;

    // pre-roll the loot
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

    // sonar hint
    if (fx.sonar && this.loot.type === 'fish') {
      const f = this.loot.fish;
      this.ui.hint.innerHTML = `📡 Sonar: a <b style="color:${RARITY_COLOR[f.rarity]}">${f.rarity.toUpperCase()}</b> ${f.sizeClass} shape circles your line…`;
    } else {
      this.ui.hint.textContent = this.hotspot ? '🫧 The water bubbles with activity…' : '';
    }
    emit('fishing', { phase: 'waiting' });
  }

  hook() {
    if (this.phase !== 'bite') return;
    this.ui.bite.classList.add('hidden');
    consumeBait();
    if (this.loot.type !== 'fish') { this.resolveNonFish(); return; }
    const f = this.loot.fish;
    this.phase = 'reeling';
    const diff = this.loot.transcendent ? 10 : f.difficulty;
    const fx = this.fx;
    this.game = {
      fishPos: 0.5, fishTarget: 0.5, fishVel: 0,
      barPos: 0.4, barVel: 0,
      barSize: clamp(0.24 * (1 + fx.barSize) - diff * 0.006, 0.1, 0.5),
      progress: 0.28, tension: 0,
      diff,
      behavior: f.behavior,
      retargetT: 0,
      qteT: randRange(4, 8),
      qte: null,
      escaped: false,
    };
    this.ui.reel.classList.remove('hidden');
    this.ui.fish.textContent = this.loot.transcendent ? '🐋' : rarityRank(f.rarity) >= 4 ? '🐠' : '🐟';
    if (fx.sonar) {
      this.ui.sonar.classList.remove('hidden');
      this.ui.sonar.textContent = `${f.rarity.toUpperCase()} · ${f.sizeClass}`;
      this.ui.sonar.style.color = RARITY_COLOR[f.rarity];
    } else this.ui.sonar.classList.add('hidden');
    this.ui.hint.textContent = 'Hold CLICK / SPACE to lift the bar — keep the fish inside!';
    emit('fishing', { phase: 'reeling' });
  }

  resolveNonFish() {
    const { type, item } = this.loot;
    if (type === 'treasure') {
      addCoins(item.value);
      S.stats.treasures++;
      emit('toast', { text: `${item.emoji} Treasure! ${item.name}`, sub: `+${item.value} coins`, kind: 'achieve' });
    } else {
      S.stats.junk++;
      emit('toast', { text: `${item.emoji} …just a ${item.name}.`, sub: 'The sea has moods.' });
    }
    emit('junk', { name: item.name });
    this.finish();
  }

  update(dt, t, input) {
    this.t = t;
    if (this.catchDisplay) this.updateCatchDisplay(dt, t);
    if (this.phase === 'idle') return;

    // line rendering
    if (this.line.visible) this.updateLine();
    const hold = input.pointerDown || input.keys['Space'];

    if (this.phase === 'casting') {
      this.castT += dt;
      this.castPower = Math.abs(Math.sin(this.castT * 2.4));
      this.ui.castFill.style.width = `${this.castPower * 100}%`;
      if (this.castMode === 'click') {
        // click-cast: a second click (or Space tap) releases
        if (input.consumeClick() || (this.castT > 0.2 && input.keys['Space'])) this.releaseCast();
      } else if (!hold) this.releaseCast();
      return;
    }

    if (this.phase === 'waiting') {
      this.waitT += dt;
      const wl = this.world.waterLevelAt(this.bobberPos.x, this.bobberPos.z);
      this.bobber.position.y = wl + 0.05 + Math.sin(t * 2.2) * 0.08;
      this.ripple.scale.setScalar(1 + Math.sin(t * 2) * 0.2);
      if (!this.nibbled && this.waitT > this.nibbleAt) {
        this.nibbled = true;
        this.bobber.position.y -= 0.25;
      }
      // cancel by moving
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => input.keys[k])) { this.cancel(); return; }
      if (this.waitT > this.biteAt) {
        this.phase = 'bite';
        this.biteT = 0;
        this.ui.bite.classList.remove('hidden');
        if (this.loot.transcendent) {
          this.ui.bite.textContent = '‼️';
          emit('toast', { text: '🌑 The water darkens…', sub: 'Something VAST has taken your hook.', kind: 'achieve' });
        } else this.ui.bite.textContent = '❗';
        emit('fishing', { phase: 'bite' });
      }
      return;
    }

    if (this.phase === 'bite') {
      this.biteT += dt;
      this.bobber.position.y = this.world.waterLevelAt(this.bobberPos.x, this.bobberPos.z) - 0.25 + Math.sin(t * 18) * 0.1;
      const windowLen = this.loot.transcendent ? 1.4 : 1.0;
      if (this.fx.autoReel && this.biteT > 0.4) { this.hook(); return; }
      if (hold || input.consumeClick()) { this.hook(); return; }
      if (this.biteT > windowLen) {
        this.ui.bite.classList.add('hidden');
        // fish got away — back to waiting
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

    if (this.phase === 'reeling') {
      const g = this.game;
      const fx = this.fx;
      // fish movement
      g.retargetT -= dt;
      if (g.retargetT <= 0) {
        const jump = { calm: 0.25, weave: 0.4, darter: 0.75, sinker: 0.5, burst: 0.9 }[g.behavior] || 0.4;
        g.fishTarget = clamp(g.fishPos + (Math.random() - 0.5) * 2 * jump, 0.03, 0.97);
        if (g.behavior === 'sinker' && Math.random() < 0.45) g.fishTarget = clamp(g.fishTarget - 0.3, 0.03, 0.9);
        g.retargetT = { calm: randRange(1.2, 2.4), weave: randRange(0.7, 1.4), darter: randRange(0.4, 1.1), sinker: randRange(0.8, 1.6), burst: randRange(0.3, 1.6) }[g.behavior] || 1;
      }
      const fishSpeed = (0.35 + g.diff * 0.075) * (1 - clamp(fx.stability, 0, 0.7) * 0.55) * (g.qte ? 2 : 1);
      g.fishPos = lerp(g.fishPos, g.fishTarget, clamp(dt * fishSpeed * 3, 0, 1));
      if (g.behavior === 'weave') g.fishPos = clamp(g.fishPos + Math.sin(t * 5) * dt * 0.25, 0, 1);

      // bar physics
      const lift = hold ? 2.6 : -3.1;
      g.barVel += lift * dt;
      g.barVel *= (1 - dt * 2.2);
      g.barPos += g.barVel * dt;
      if (g.barPos < 0) { g.barPos = 0; g.barVel *= -0.35; }
      if (g.barPos > 1 - g.barSize) { g.barPos = 1 - g.barSize; g.barVel *= -0.35; }

      const inside = g.fishPos > g.barPos - 0.02 && g.fishPos < g.barPos + g.barSize + 0.02;
      if (inside) {
        g.progress += dt * 0.13;
        g.tension = Math.max(0, g.tension - dt * 0.06);
      } else {
        g.progress -= dt * 0.085;
        g.tension += dt * (0.045 + g.diff * 0.012) * (1 - clamp(fx.tension, 0, 0.75));
      }
      g.progress = clamp(g.progress, 0, 1);

      // QTE events for tougher fish
      if (!g.qte && g.diff >= 5) {
        g.qteT -= dt;
        if (g.qteT <= 0 && Math.random() < 0.6) {
          const kind = Math.random() < 0.55 ? 'mash' : 'flick';
          g.qte = { kind, need: kind === 'mash' ? 4 : 1, got: 0, timer: kind === 'mash' ? 1.6 : 1.0, key: Math.random() < 0.5 ? 'KeyA' : 'KeyD' };
          this.ui.qte.classList.remove('hidden');
          this.ui.qte.textContent = kind === 'mash' ? '⚡ MASH SPACE! ⚡' : (g.qte.key === 'KeyA' ? '⬅️ PRESS A!' : 'PRESS D! ➡️');
          this._qteSpaceWas = true; // require re-press
        } else if (g.qteT <= 0) g.qteT = randRange(4, 8);
      }
      if (g.qte) {
        g.qte.timer -= dt;
        if (g.qte.kind === 'mash') {
          const spaceNow = !!input.keys['Space'];
          if (spaceNow && !this._qteSpaceWas) { g.qte.got++; this.ui.qte.textContent = `⚡ MASH SPACE! ${'●'.repeat(g.qte.got)}${'○'.repeat(Math.max(0, g.qte.need - g.qte.got))}`; }
          this._qteSpaceWas = spaceNow;
        } else if (input.keys[g.qte.key]) g.qte.got++;
        if (g.qte.got >= g.qte.need) {
          g.progress = clamp(g.progress + 0.13, 0, 1);
          g.tension = Math.max(0, g.tension - 0.18);
          this.endQte(true);
        } else if (g.qte.timer <= 0) {
          g.tension += 0.2;
          this.endQte(false);
        }
      }

      // outcomes
      if (g.tension >= 1) { this.escape(); return; }
      if (g.progress >= 1) { this.land(); return; }

      // render
      const trackH = 380, fishH = 34;
      this.ui.fish.style.bottom = `${g.fishPos * (trackH - fishH - 6)}px`;
      this.ui.bar.style.bottom = `${g.barPos * (trackH - 8) + 4}px`;
      this.ui.bar.style.height = `${g.barSize * (trackH - 8)}px`;
      this.ui.progress.style.height = `${g.progress * 100}%`;
      this.ui.tension.style.height = `${g.tension * 100}%`;
      // bobber thrash
      this.bobber.position.y = this.world.waterLevelAt(this.bobberPos.x, this.bobberPos.z) - 0.15 + Math.sin(t * 14) * 0.12;
    }
  }

  endQte(success) {
    this.game.qte = null;
    this.game.qteT = randRange(5, 9);
    this.ui.qte.classList.add('hidden');
    if (!success) emit('toast', { text: 'The line strains!', sub: 'tension surged' });
  }

  escape() {
    S.stats.linesBroken++;
    if (S.stats.linesBroken >= 10) setFlag('broke_line_10');
    this.ui.reel.classList.add('hidden');
    this.ui.qte.classList.add('hidden');
    emit('toast', { text: '💥 Snap! It got away…', sub: this.loot.transcendent ? 'The legend sinks back into the dark.' : 'Your line broke.' });
    this.finish();
  }

  land() {
    const f = this.loot.fish;
    const fx = this.fx;
    const { len, wt } = rollSize(f, fx);
    const record = recordCatch(f, len, wt);
    const zone = S.zone;

    // inventory (or overflow auto-sell)
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
      emit('toast', { text: '🪝🪝 Double hook!', sub: `Two ${f.name} on one line!`, kind: 'achieve' });
    }
    // xp
    let xp = (XP_BY_RARITY[f.rarity] || 10) * (0.8 + (len / f.maxLen) * 0.6) * (1 + fx.xpBonus);
    if (this.world.timeKey() === 'dawnDusk' && fx.goldenHour) xp *= 1 + fx.goldenHour;
    addXp(xp);

    // flags
    const tk = this.world.timeKey();
    if (tk === 'night') setFlag('caught_at_night');
    if (tk === 'dawnDusk') setFlag('caught_dawn');
    if (f.rarity === 'transcendent') {
      setFlag('caught_transcendent');
      if (f.isWhale) setFlag('legend_whale');
      if (f.rodReward && !S.heroRods.includes(f.rodReward.id)) {
        S.heroRods.push(f.rodReward.id);
        emit('toast', { text: `🎣 ${f.rodReward.name}!`, sub: 'A hero\'s rod surfaces with your catch! Equip it in the Rod window.', kind: 'achieve' });
      }
    }
    // cozy streak
    const spotKey = `${Math.round(this.player.x / 8)},${Math.round(this.player.z / 8)}`;
    this.consecutiveHere = spotKey === this.lastSpot ? this.consecutiveHere + 1 : 1;
    this.lastSpot = spotKey;
    if (this.consecutiveHere >= 10) setFlag('cozy_hour');

    checkAchievements();
    emit('catch', { fish: f, len, wt, record, zone, sold });
    this.showCatch(f, len, wt, record, sold);
    if (rarityRank(f.rarity) >= 2) {
      this.onAnnounce({ fishId: f.id, name: f.name, rarity: f.rarity, len });
    }
    this.finish();
  }

  showCatch(f, len, wt, record, sold) {
    const b = this.ui.banner;
    b.className = rarityRank(f.rarity) >= 3 ? 'rare-glow' : '';
    b.classList.remove('hidden');
    b.innerHTML = `
      <div class="cb-name rar-${f.rarity}">${f.name}</div>
      <div class="muted" style="text-transform:uppercase;font-size:.75rem;letter-spacing:2px;color:${RARITY_COLOR[f.rarity]}">${f.rarity}</div>
      <div class="cb-flavor">${f.flavor}</div>
      <div class="cb-stats"><span>📏 ${fmtLen(len)}</span><span>⚖️ ${fmtWt(wt)}</span></div>
      ${record ? '<div class="cb-record">🏅 New personal best!</div>' : ''}
      ${sold ? `<div class="muted">Backpack full — sold for ${sold} coins</div>` : ''}`;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.add('hidden'), rarityRank(f.rarity) >= 4 ? 6000 : 3400);

    // 3D fish presentation
    if (this.catchDisplay) this.scene.remove(this.catchDisplay.group);
    try {
      const mesh = makeFishMesh(f);
      const scale = clamp(len / 45, 0.5, 6);
      mesh.scale.setScalar(scale);
      const group = new THREE.Group();
      group.add(mesh);
      if (f.effect) {
        const part = makeEffectParticles(f.effect, scale * 0.9);
        group.add(part);
      }
      group.position.set(this.player.x, this.player.y + 3.2 + scale * 0.3, this.player.z);
      this.scene.add(group);
      this.catchDisplay = { group, t0: this.t, dur: rarityRank(f.rarity) >= 4 ? 6 : 3 };
    } catch (e) { console.warn('fish display failed', e); }
  }

  updateCatchDisplay(dt, t) {
    const d = this.catchDisplay;
    d.group.rotation.y += dt * 1.4;
    d.group.position.y += Math.sin(t * 2) * dt * 0.3;
    d.group.traverse((n) => n.userData?.animate?.(t, dt));
    if (t - d.t0 > d.dur) {
      this.scene.remove(d.group);
      this.catchDisplay = null;
    }
  }

  updateLine() {
    const rodTip = new THREE.Vector3(0, 2.4, 0.4);
    this.player.rig.userData.rod.localToWorld(rodTip);
    const end = this.bobber.position;
    const pts = this.lineGeo.attributes.position.array;
    for (let i = 0; i < 9; i++) {
      const tt = i / 8;
      const x = lerp(rodTip.x, end.x, tt);
      const y = lerp(rodTip.y, end.y, tt) - Math.sin(tt * Math.PI) * 0.8;
      const z = lerp(rodTip.z, end.z, tt);
      pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
    }
    this.lineGeo.attributes.position.needsUpdate = true;
  }

  cancel(msg) {
    if (msg) emit('toast', { text: msg });
    this.finish();
  }

  finish() {
    this.phase = 'idle';
    this.player.frozen = false;
    this.player.rig.userData.setAnim('idle');
    this.bobber.visible = false;
    this.line.visible = false;
    this.ui.castMeter.classList.add('hidden');
    this.ui.bite.classList.add('hidden');
    this.ui.reel.classList.add('hidden');
    this.ui.qte.classList.add('hidden');
    this.ui.sonar.classList.add('hidden');
    this.ui.root.classList.add('hidden');
    this.ui.hint.textContent = '';
    emit('fishing', { phase: 'idle' });
  }
}
