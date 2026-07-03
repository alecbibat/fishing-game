// Window manager + core windows: backpack, bank, dex, skills, achievements, rod, potions, map, settings.
import { $, el, fmtNum, fmtLen, fmtWt, RARITY_COLOR, RARITY_ORDER, rarityRank, clamp } from '../core/util.js';
import { emit, on } from '../core/events.js';
import {
  S, save, getLevel, levelFromXp, unlockedAbilities, getEffects, backpackSlots,
  bankDeposit, bankWithdraw, sellFish, fishValue, claimAchievement, usePotion,
  getRodDef, equippedAttachments, attachmentSlotCount, dexSpeciesCount, exportSave, importSave,
} from '../core/state.js';
import { ABILITIES, BACKPACK_TIERS, ACH_REWARD, BANK_SLOTS } from '../data/static.js';
import { FISH, FISH_BY_ID, TRANSCENDENT } from '../data/gen-fish.js';
import { ATTACHMENTS, BAITS, POTIONS, RODS } from '../data/gen-items.js';
import { ACHIEVEMENTS } from '../data/gen-achievements.js';
import { ZONE_LORE } from '../data/gen-zones.js';
import { mountFishViewer } from './fishviewer.js';
import { icon, iconHtml } from './icons.js';
import { overworldHeight, overworldWaterLevel, overworldZone, HALF } from '../world/world.js';
import { PORTAL_SPOTS } from '../data/static.js';

const root = () => $('#window-root');
const body = () => $('#window-body');
const titleEl = () => $('#window-title');

let current = null;
let dexViewer = null; // active 3D fish viewer in the dex detail
function disposeDexViewer() {
  if (dexViewer) { dexViewer.dispose(); dexViewer = null; }
}
export function currentWindow() { return current; }

export function closeWindow() {
  current = null;
  disposeDexViewer();
  root().classList.add('hidden');
}

export function openWindow(name, ctx = {}) {
  const builders = {
    backpack: buildBackpack, bank: buildBank, dex: buildDex, skills: buildSkills,
    achievements: buildAchievements, rod: buildRod, potions: buildPotions,
    map: buildMap, settings: buildSettings,
  };
  const builder = builders[name] || ctx.builder;
  if (!builder) return;
  current = name;
  disposeDexViewer();
  root().classList.remove('hidden');
  body().innerHTML = '';
  builder(body(), ctx);
}
let lastCustom = null;
export function openCustom(name, title, builderFn, ctx = {}) {
  current = name;
  lastCustom = { name, title, builderFn, ctx };
  root().classList.remove('hidden');
  titleEl().textContent = title;
  body().innerHTML = '';
  builderFn(body(), ctx);
}

$('#window-close')?.addEventListener('click', closeWindow);
$('#window-root')?.addEventListener('click', (e) => { if (e.target.id === 'window-root') closeWindow(); });
on('state', () => { // live refresh
  if (!current) return;
  if (lastCustom && current === lastCustom.name) openCustom(lastCustom.name, lastCustom.title, lastCustom.builderFn, lastCustom.ctx);
  else openWindow(current);
});

// ---------- helpers ----------
function rarPill(rarity) {
  return el('span', { class: 'pill', style: `background:${RARITY_COLOR[rarity]}` }, rarity);
}
function fishSlot(item, onClick) {
  const fish = FISH_BY_ID.get(item.fishId);
  const slot = el('div', { class: 'slot', title: fish ? `${fish.name} — ${fmtLen(item.len)}` : '?', onclick: onClick },
    el('div', { class: 'slot-rar', style: `background:${RARITY_COLOR[fish?.rarity || 'common']}` }),
    el('div', {}, fishIcon(fish)),
    el('div', { class: 'slot-label' }, fish?.name || '???'),
    el('div', { class: 'slot-count' }, fmtLen(item.len)));
  return slot;
}
function fishIcon(fish, size = 22) {
  if (!fish) return icon('fish', size);
  if (fish.rarity === 'transcendent') return icon('whale', size);
  if (rarityRank(fish.rarity) >= 3) return icon('fish_rare', size);
  return icon('fish', size);
}

// ---------- backpack ----------
function buildBackpack(bodyEl) {
  titleEl().textContent = `Backpack — ${S.inventory.length}/${backpackSlots()} (${BACKPACK_TIERS[S.backpackTier].name})`;
  const grid = el('div', { class: 'grid-slots' });
  S.inventory.forEach((item, i) => {
    grid.append(fishSlot(item, () => showFishActions(bodyEl, item, i, false)));
  });
  for (let i = S.inventory.length; i < backpackSlots(); i++) grid.append(el('div', { class: 'slot empty' }, '·'));
  bodyEl.append(grid);
  bodyEl.append(el('div', { class: 'muted', style: 'margin-top:10px' },
    'Click a fish to inspect, sell, or drop. Deposit fish at the Bank in Willowbrook. Upgrade your pack at the General Store.'));
}
function showFishActions(bodyEl, item, idx, fromBank) {
  const fish = FISH_BY_ID.get(item.fishId);
  if (!fish) return;
  const val = fishValue(item);
  const panel = el('div', { class: 'list-row', style: 'margin-top:10px' },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-name' }, `${fish.name} `, rarPill(fish.rarity)),
      el('div', { class: 'row-desc' }, `${fmtLen(item.len)} · ${fmtWt(item.wt)} — ${fish.flavor}`)),
    el('button', { class: 'btn btn-small btn-gold', onclick: () => { sellFish(idx, fromBank); } }, `Sell ${val} `, icon('coin', 13)));
  bodyEl.querySelector('.fish-actions')?.remove();
  panel.classList.add('fish-actions');
  bodyEl.append(panel);
}

// ---------- bank ----------
function buildBank(bodyEl) {
  titleEl().textContent = `Bank of Willowbrook — ${S.bank.length}/${BANK_SLOTS} stored`;
  bodyEl.append(el('div', { class: 'muted' }, 'Click backpack items to deposit · Click vault items to withdraw'));
  bodyEl.append(el('div', { class: 'win-section-title' }, `Backpack (${S.inventory.length}/${backpackSlots()})`));
  const inv = el('div', { class: 'grid-slots' });
  S.inventory.forEach((item, i) => inv.append(fishSlot(item, () => { bankDeposit(i); })));
  if (!S.inventory.length) inv.append(el('div', { class: 'muted' }, 'Empty backpack.'));
  bodyEl.append(inv);
  bodyEl.append(el('div', { class: 'win-section-title' }, `Vault (${S.bank.length})`));
  const vault = el('div', { class: 'grid-slots' });
  S.bank.forEach((item, i) => vault.append(fishSlot(item, () => { bankWithdraw(i); })));
  if (!S.bank.length) vault.append(el('div', { class: 'muted' }, 'The vault echoes emptily.'));
  bodyEl.append(vault);
}

// ---------- dex ----------
let dexFilter = { q: '', biome: 'all', rarity: 'all', caught: false };
function buildDex(bodyEl) {
  const caughtN = dexSpeciesCount();
  titleEl().textContent = `Fish Dex — ${caughtN}/${FISH.length + TRANSCENDENT.length} discovered`;
  const header = el('div', { class: 'dex-header' });
  const search = el('input', { placeholder: 'Search fish…', value: dexFilter.q });
  search.addEventListener('input', () => { dexFilter.q = search.value.toLowerCase(); renderGrid(); });
  const biomes = ['all', ...new Set(FISH.map((f) => f.biome))];
  const bSel = el('select', {}, ...biomes.map((b) => el('option', { value: b, ...(dexFilter.biome === b ? { selected: '' } : {}) }, b === 'all' ? 'All biomes' : (ZONE_LORE[b]?.displayName || b))));
  bSel.addEventListener('change', () => { dexFilter.biome = bSel.value; renderGrid(); });
  const rSel = el('select', {}, ...['all', ...RARITY_ORDER].map((r) => el('option', { value: r, ...(dexFilter.rarity === r ? { selected: '' } : {}) }, r === 'all' ? 'All rarities' : r)));
  rSel.addEventListener('change', () => { dexFilter.rarity = rSel.value; renderGrid(); });
  const cBox = el('label', { class: 'check-label', style: 'font-weight:700;font-size:.85rem;display:flex;gap:6px;align-items:center' });
  const cInput = el('input', { type: 'checkbox' });
  cInput.checked = dexFilter.caught;
  cInput.addEventListener('change', () => { dexFilter.caught = cInput.checked; renderGrid(); });
  cBox.append(cInput, 'caught only');
  header.append(search, bSel, rSel, cBox);
  bodyEl.append(header);
  const gridWrap = el('div', {});
  bodyEl.append(gridWrap);

  function renderGrid() {
    gridWrap.innerHTML = '';
    const list = [...FISH, ...TRANSCENDENT].filter((f) => {
      if (dexFilter.q && !f.name.toLowerCase().includes(dexFilter.q)) return false;
      if (dexFilter.biome !== 'all' && f.biome !== dexFilter.biome) return false;
      if (dexFilter.rarity !== 'all' && f.rarity !== dexFilter.rarity) return false;
      if (dexFilter.caught && !S.dex[f.id]) return false;
      return true;
    }).sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || a.name.localeCompare(b.name));
    const grid = el('div', { class: 'dex-grid' });
    for (const f of list.slice(0, 400)) {
      const seen = !!S.dex[f.id];
      const card = el('div', { class: `dex-card ${seen ? '' : 'unseen'}`, onclick: () => { if (seen) renderDetail(f); } },
        el('div', { style: 'padding:2px' }, seen ? fishIcon(f, 24) : el('span', { style: 'font-weight:900;font-size:1.3rem' }, '?')),
        el('div', { class: 'dex-name', style: seen ? `color:${RARITY_COLOR[f.rarity]}` : '' }, seen ? f.name : '???'),
        el('div', { class: 'dex-sub' }, `${f.rarity}${seen ? ` · ×${S.dex[f.id].n}` : ''}`));
      grid.append(card);
    }
    if (list.length > 400) grid.append(el('div', { class: 'muted' }, `…and ${list.length - 400} more (narrow your search)`));
    if (!list.length) grid.append(el('div', { class: 'muted' }, 'No fish match. The waters keep their secrets.'));
    gridWrap.append(grid);
  }
  function renderDetail(f) {
    gridWrap.innerHTML = '';
    disposeDexViewer();
    const d = S.dex[f.id];
    const back = el('button', { class: 'btn btn-small', onclick: () => { disposeDexViewer(); renderGrid(); } }, '← Back to dex');
    const detail = el('div', { class: 'dex-detail', style: 'margin-top:10px' });
    const portrait = el('div', { class: 'fish-portrait', title: 'drag to rotate' });
    dexViewer = mountFishViewer(portrait, f, { width: 280, height: 190 });
    const info = el('div', { style: 'flex:1;min-width:240px' },
      el('h3', { style: `color:${RARITY_COLOR[f.rarity]}` }, `${f.name} `, rarPill(f.rarity)),
      f.title ? el('div', { class: 'muted', style: 'font-style:italic' }, `"${f.title}"`) : null,
      el('div', { class: 'dex-flavor' }, f.flavor),
      el('div', { class: 'stat-grid' },
        stat('Caught', `×${d.n}`), stat('Longest', fmtLen(d.maxLen)), stat('Heaviest', fmtWt(d.maxWt)),
        stat('Waters', ZONE_LORE[f.biome]?.displayName || f.biome), stat('Depth', f.depth), stat('Active', f.time === 'any' ? 'all day' : f.time),
        stat('Favors', f.baitPref === 'any' ? 'any bait' : f.baitPref + ' bait'), stat('Size class', f.sizeClass), stat('Base value', `${f.price} coins`)));
    detail.append(portrait, info);
    gridWrap.append(back, detail);
  }
  renderGrid();
}
function stat(k, v) {
  return el('div', { class: 'stat-tile' }, el('div', { class: 'stat-v' }, String(v)), el('div', { class: 'stat-k' }, k));
}

// ---------- skills ----------
function buildSkills(bodyEl) {
  const { level, into, need } = levelFromXp(S.xp);
  titleEl().textContent = `Fishing — Level ${level}`;
  bodyEl.append(el('div', { class: 'stat-grid' },
    stat('Level', level + (level > 100 ? ' ★' : '')),
    stat('Total XP', fmtNum(S.xp)),
    stat('To next level', need === Infinity ? 'MAX' : fmtNum(need - into)),
    stat('Lifetime catches', fmtNum(S.stats.catches))));
  if (level > 100) {
    bodyEl.append(el('div', { class: 'list-row', style: 'border-color:var(--gold)' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `Beyond Mastery — Level ${level} / 1000`),
        el('div', { class: 'row-desc' }, `Every level past 100 grants +0.1% bite speed and +0.05% rare luck. Current bonus: +${((level - 100) * 0.1).toFixed(1)}% bite, +${((level - 100) * 0.05).toFixed(2)}% luck.`))));
  }
  const fx = getEffects();
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Current fishing power'));
  bodyEl.append(el('div', { class: 'stat-grid' },
    stat('Bite speed', `+${Math.round(fx.biteRate * 100)}%`), stat('Rare luck', `+${Math.round(fx.rareLuck * 100)}%`),
    stat('Bar size', `+${Math.round(fx.barSize * 100)}%`), stat('Stability', `+${Math.round(fx.stability * 100)}%`),
    stat('Cast power', fx.power.toFixed(0)), stat('XP bonus', `+${Math.round(fx.xpBonus * 100)}%`),
    stat('Gold bonus', `+${Math.round(fx.goldBonus * 100)}%`), stat('Double catch', `${Math.round(fx.multiCatch * 100)}%`)));
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Abilities'));
  const list = el('div', { class: 'row-list' });
  for (const a of ABILITIES) {
    const unlocked = a.lvl <= level;
    list.append(el('div', { class: `list-row ability-row ${unlocked ? '' : 'locked'}` },
      el('div', { class: 'ability-lvl' }, `Lv ${a.lvl}`),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, a.name),
        el('div', { class: 'row-desc' }, a.desc)),
      el('div', { style: 'font-weight:900' }, unlocked ? '✓' : '—')));
  }
  bodyEl.append(list);
}

// ---------- achievements ----------
let achTab = 'all';
function buildAchievements(bodyEl) {
  const doneN = Object.values(S.achievements).filter((a) => a.done).length;
  titleEl().textContent = `Achievements — ${doneN}/${ACHIEVEMENTS.length}`;
  // titles picker
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Your titles'));
  const tRow = el('div', { class: 'tab-row' });
  tRow.append(el('button', { class: `tab-btn ${!S.title ? 'active' : ''}`, onclick: () => { S.title = null; emit('state'); emit('profile'); } }, 'No title'));
  for (const t of S.titles) {
    const ach = ACHIEVEMENTS.find((a) => a.title?.name === t);
    tRow.append(el('button', {
      class: `tab-btn ${S.title === t ? 'active' : ''}`,
      style: ach ? `color:${ach.title.color}` : '',
      onclick: () => { S.title = t; emit('state'); emit('profile'); },
    }, t));
  }
  if (!S.titles.length) tRow.append(el('span', { class: 'muted' }, 'Claim achievements to earn titles.'));
  bodyEl.append(tRow);

  const cats = ['all', ...new Set(ACHIEVEMENTS.map((a) => a.category))];
  const tabs = el('div', { class: 'tab-row' });
  for (const c of cats) {
    tabs.append(el('button', { class: `tab-btn ${achTab === c ? 'active' : ''}`, onclick: () => { achTab = c; openWindow('achievements'); } }, c));
  }
  bodyEl.append(tabs);
  const list = el('div', { class: 'row-list' });
  const sorted = [...ACHIEVEMENTS].filter((a) => achTab === 'all' || a.category === achTab)
    .sort((a, b) => (state(b) - state(a)) || 0);
  function state(a) {
    const st = S.achievements[a.id];
    return st?.done ? (st.claimed ? 1 : 2) : 0;
  }
  for (const a of sorted) {
    const st = S.achievements[a.id];
    const isSecret = a.category === 'secret' && !st?.done;
    const row = el('div', { class: `list-row ${st?.done ? '' : 'locked'}` },
      el('div', {}, st?.done ? icon('trophy', 22) : isSecret ? icon('secret', 22) : el('span', { class: 'muted', style: 'font-weight:900;font-size:1.2rem' }, '—')),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, isSecret ? 'Secret achievement' : a.name, ' ',
          a.title ? el('span', { class: 'pill', style: `background:${a.title.color}` }, `title: ${a.title.name}`) : ''),
        el('div', { class: 'row-desc' }, isSecret ? 'Keep exploring…' : `${a.desc} · Reward: ${ACH_REWARD[a.tier] || 100} coins`)));
    if (st?.done && !st.claimed) {
      row.append(el('button', { class: 'btn btn-small btn-gold', onclick: () => { claimAchievement(a.id); } }, 'Turn in'));
    } else if (st?.claimed) row.append(el('span', { class: 'muted' }, 'claimed'));
    list.append(row);
  }
  bodyEl.append(list);
}

// ---------- rod & attachments ----------
function buildRod(bodyEl) {
  const rod = getRodDef();
  titleEl().textContent = `Rod: ${rod.name}`;
  bodyEl.append(el('div', { class: 'muted', style: 'font-style:italic' }, rod.flavor || ''));
  bodyEl.append(el('div', { class: 'stat-grid' },
    stat('Tier', rod.hero ? '★ HERO' : rod.tier), stat('Cast power', rod.stats.power || 1),
    stat('Bite speed', `+${Math.round((rod.stats.biteRate || 0) * 100)}%`), stat('Rare luck', `+${Math.round((rod.stats.rareLuck || 0) * 100)}%`),
    stat('Bar size', `+${Math.round((rod.stats.barSize || 0) * 100)}%`), stat('Attachment slots', rod.stats.slots || 1)));

  // rod choices
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Your rods'));
  const rodList = el('div', { class: 'row-list' });
  const ownedTiers = RODS.filter((r) => r.tier <= highestOwnedTier());
  function highestOwnedTier() { return S.rodTierOwned || Math.max(1, RODS.findIndex((r) => r.id === (S.rod.kind === 'tier' ? S.rod.id : 'rod_t1')) + 1); }
  for (const r of ownedTiers) {
    rodList.append(el('div', { class: 'list-row' },
      el('div', {}, icon('rod', 22)),
      el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, `${r.name} (Tier ${r.tier})`), el('div', { class: 'row-desc' }, r.flavor || '')),
      S.rod.kind === 'tier' && S.rod.id === r.id
        ? el('span', { class: 'muted' }, 'equipped')
        : el('button', { class: 'btn btn-small', onclick: () => { S.rod = { kind: 'tier', id: r.id }; emit('state'); } }, 'Equip')));
  }
  for (const heroId of S.heroRods) {
    const t = TRANSCENDENT.find((f) => f.rodReward?.id === heroId);
    if (!t) continue;
    rodList.append(el('div', { class: 'list-row', style: 'border-color:var(--r-transcendent)' },
      el('div', {}, icon('claim', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name rar-transcendent' }, t.rodReward.name),
        el('div', { class: 'row-desc' }, t.rodReward.flavor)),
      S.rod.kind === 'hero' && S.rod.id === heroId
        ? el('span', { class: 'muted' }, 'equipped')
        : el('button', { class: 'btn btn-small btn-gold', onclick: () => { S.rod = { kind: 'hero', id: heroId }; emit('state'); } }, 'Equip')));
  }
  bodyEl.append(rodList);
  bodyEl.append(el('div', { class: 'muted', style: 'margin-top:6px' }, 'Craft higher tiers at your island Workshop or the Rod Dealer in town. Hero rods surface with transcendent legends…'));

  // attachments
  const slots = attachmentSlotCount();
  const equipped = equippedAttachments();
  bodyEl.append(el('div', { class: 'win-section-title' }, `Attachments — ${equipped.length}/${slots} slots`));
  const eq = S.attachmentsEquipped;
  const slotRow = el('div', { class: 'row-list' });
  const slotDefs = [['bobber', eq.bobber], ['hook', eq.hook], ['reel', eq.reel], ['gadget A', eq.gadget[0]], ['gadget B', eq.gadget[1]]];
  for (const [label, id] of slotDefs) {
    const a = ATTACHMENTS.find((x) => x.id === id);
    slotRow.append(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `${label}: `, a ? el('span', { style: `color:${RARITY_COLOR[a.rarity]}` }, a.name) : el('span', { class: 'muted' }, 'empty')),
        a ? el('div', { class: 'row-desc' }, fxDesc(a.effects)) : null),
      a ? el('button', { class: 'btn btn-small', onclick: () => { unequip(label); } }, 'Remove') : null));
  }
  bodyEl.append(slotRow);
  function unequip(label) {
    if (label === 'bobber') eq.bobber = null;
    else if (label === 'hook') eq.hook = null;
    else if (label === 'reel') eq.reel = null;
    else if (label === 'gadget A') eq.gadget[0] = null;
    else eq.gadget[1] = null;
    emit('state');
  }
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Owned attachments'));
  const owned = el('div', { class: 'row-list' });
  for (const id of S.attachmentsOwned) {
    const a = ATTACHMENTS.find((x) => x.id === id);
    if (!a) continue;
    const isEquipped = [eq.bobber, eq.hook, eq.reel, ...eq.gadget].includes(id);
    owned.append(el('div', { class: 'list-row' },
      el('div', {}, slotIcon(a.slot)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name', style: `color:${RARITY_COLOR[a.rarity]}` }, a.name, ' ', el('span', { class: 'muted', style: 'font-size:.75rem' }, `(${a.slot})`)),
        el('div', { class: 'row-desc' }, `${a.flavor} — ${fxDesc(a.effects)}`)),
      isEquipped ? el('span', { class: 'muted' }, 'equipped')
        : el('button', { class: 'btn btn-small', onclick: () => equip(a) }, 'Equip')));
  }
  if (!S.attachmentsOwned.length) owned.append(el('div', { class: 'muted' }, "None yet — visit the Tinkerer's shop in Willowbrook."));
  bodyEl.append(owned);
  function equip(a) {
    if (equippedAttachments().length >= slots && !wouldReplace(a)) {
      emit('toast', { text: 'No free attachment slots!', sub: `Your rod has ${slots} slot${slots > 1 ? 's' : ''}. Upgrade it for more.` });
      return;
    }
    if (a.slot === 'gadget') {
      if (!eq.gadget[0]) eq.gadget[0] = a.id;
      else if (!eq.gadget[1] && slots >= 4) eq.gadget[1] = a.id;
      else eq.gadget[0] = a.id;
    } else eq[a.slot] = a.id;
    emit('state');
  }
  function wouldReplace(a) {
    if (a.slot === 'gadget') return eq.gadget[0] && (eq.gadget[1] || slots < 4);
    return !!eq[a.slot];
  }
}
function slotIcon(slot, size = 20) { return icon({ bobber: 'bobber', hook: 'hook', reel: 'reel', gadget: 'gadget' }[slot] || 'gadget', size); }
function fxDesc(effects) {
  const names = {
    biteRate: 'bite speed', rareLuck: 'rare luck', barSize: 'bar size', stability: 'stability',
    tension: 'tension resist', xpBonus: 'XP', goldBonus: 'gold', sizeBonus: 'fish size',
    multiCatch: 'double catch', treasure: 'treasure', sonar: 'SONAR', scope: 'SCOPE', magnet: 'MAGNET', autoReel: 'AUTO-HOOK',
  };
  return Object.entries(effects || {}).map(([k, v]) =>
    ['sonar', 'scope', 'magnet', 'autoReel'].includes(k) ? `[${names[k]}]` : `+${Math.round(v * 100)}% ${names[k] || k}`).join(', ');
}

// ---------- potions ----------
function buildPotions(bodyEl) {
  titleEl().textContent = 'Potions';
  const active = S.activePotions.filter((p) => p.until > Date.now());
  if (active.length) {
    bodyEl.append(el('div', { class: 'win-section-title' }, 'Active brews'));
    const list = el('div', { class: 'row-list' });
    for (const p of active) {
      const def = POTIONS.find((d) => d.id === p.id);
      if (!def) continue;
      list.append(el('div', { class: 'list-row' },
        el('div', {}, icon('potion', 22)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, def.name),
          el('div', { class: 'row-desc' }, `${fxDesc(def.effects)} — ${Math.ceil((p.until - Date.now()) / 60000)} min left`))));
    }
    bodyEl.append(list);
  }
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Your satchel'));
  const list = el('div', { class: 'row-list' });
  const ownedIds = Object.keys(S.potions);
  for (const id of ownedIds) {
    const def = POTIONS.find((d) => d.id === id);
    if (!def) continue;
    list.append(el('div', { class: 'list-row' },
      el('div', {}, icon('potion', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `${def.name} ×${S.potions[id]}`),
        el('div', { class: 'row-desc' }, `${def.flavor} — ${fxDesc(def.effects)}, ${def.duration} min`)),
      el('button', { class: 'btn btn-small btn-primary', onclick: () => { usePotion(id); } }, 'Drink')));
  }
  if (!ownedIds.length) list.append(el('div', { class: 'muted' }, 'No potions yet. Brew some at the Potion Cauldron in town or your island Brewery — fish are the ingredients!'));
  bodyEl.append(list);
}

// ---------- map ----------
function buildMap(bodyEl, ctx) {
  titleEl().textContent = 'The Driftwood Isles';
  const canvas = el('canvas', { id: 'world-map-canvas', width: 480, height: 480 });
  bodyEl.append(canvas);
  const g = canvas.getContext('2d');
  const N = 120;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = -HALF + (i / N) * HALF * 2;
      const z = -HALF + (j / N) * HALF * 2;
      const h = overworldHeight(x, z);
      const wl = overworldWaterLevel(x, z);
      let c;
      if (h < wl - 4) c = '#256b7a';
      else if (h < wl) c = '#4f9aa8';
      else if (h < wl + 1.5) c = '#e0cf9a';
      else if (h > 45) c = '#eef2f4';
      else if (h > 26) c = '#8d8d85';
      else {
        const zone = overworldZone(x, z);
        c = zone === 'swamp' ? '#5d7048' : zone === 'volcanic' ? '#8a5a42' : zone === 'town' ? '#b0a890' : '#6fa050';
      }
      g.fillStyle = c;
      g.fillRect(i * 4, j * 4, 4, 4);
    }
  }
  // labels
  g.font = 'bold 13px Trebuchet MS';
  g.textAlign = 'center';
  const label = (name, x, z) => {
    const px = ((x + HALF) / (HALF * 2)) * 480, pz = ((z + HALF) / (HALF * 2)) * 480;
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3;
    g.strokeText(name, px, pz);
    g.fillStyle = '#fff';
    g.fillText(name, px, pz);
  };
  label(ZONE_LORE.town?.displayName || 'Town', 0, 100);
  label(ZONE_LORE.pond?.displayName || 'Ponds', -320, 260);
  label(ZONE_LORE.lake?.displayName || 'Lake', 380, -320);
  label(ZONE_LORE.swamp?.displayName || 'Swamp', -520, 60);
  label(ZONE_LORE.glacier?.displayName || 'Glacier', -420, -500);
  label(ZONE_LORE.volcanic?.displayName || 'Springs', 590, -110);
  label(ZONE_LORE.coast?.displayName || 'Coast', 40, 560);
  label(ZONE_LORE.docks?.displayName || 'Docks', 480, 400);
  label(ZONE_LORE.river?.displayName || 'River', -140, -230);
  // portal spots
  for (const spot of PORTAL_SPOTS) {
    const px = ((spot.x + HALF) / (HALF * 2)) * 480, pz = ((spot.z + HALF) / (HALF * 2)) * 480;
    g.fillStyle = S.island.spot === spot.id ? '#46e0d0' : 'rgba(255,255,255,.5)';
    g.beginPath(); g.arc(px, pz, 4, 0, 7); g.fill();
  }
  // player
  if (ctx.playerPos && ctx.mapId === 'overworld') {
    const px = ((ctx.playerPos.x + HALF) / (HALF * 2)) * 480, pz = ((ctx.playerPos.z + HALF) / (HALF * 2)) * 480;
    g.fillStyle = '#ff5a4e';
    g.beginPath(); g.arc(px, pz, 6, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }
  bodyEl.append(el('div', { class: 'muted', style: 'margin-top:8px' },
    ctx.mapId === 'overworld' ? 'You are the red dot. Teal dots are island portal anchors.' : 'You are off the map — in ' + (ZONE_LORE[S.zone]?.displayName || S.zone) + '.'));
  const lore = ZONE_LORE[S.zone];
  if (lore) bodyEl.append(el('div', { class: 'list-row', style: 'margin-top:8px' },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-name' }, lore.displayName),
      el('div', { class: 'row-desc' }, `${lore.description} `),
      el('div', { class: 'row-desc', style: 'font-style:italic;color:#5a3c7a' }, `Rumour: ${lore.secretHint}`))));
}

// ---------- settings ----------
function buildSettings(bodyEl, ctx) {
  titleEl().textContent = 'Settings';
  const fx = getEffects();
  const rows = el('div', { class: 'row-list' });
  const toggle = (label, desc, key, disabled = false) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!S.settings[key];
    cb.disabled = disabled;
    cb.addEventListener('change', () => { S.settings[key] = cb.checked; save(); });
    rows.append(el('div', { class: 'list-row' },
      el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, label), el('div', { class: 'row-desc' }, desc)),
      cb));
  };
  toggle('Cozy Mode', fx.cozyMode ? 'Bites hook themselves. Fewer rares, zero stress.' : 'Unlocks at fishing level 60 (Drowsy Reel).', 'cozyMode', !fx.cozyMode);
  toggle('Announce rare catches', 'Celebrate rare+ catches in chat.', 'announceRares');
  toggle('Sound effects', 'Chimes and splashes.', 'sfx');
  bodyEl.append(rows);

  bodyEl.append(el('div', { class: 'win-section-title' }, 'Save data'));
  const exp = el('button', {
    class: 'btn btn-small', onclick: async () => {
      const code = exportSave();
      try { await navigator.clipboard.writeText(code); emit('toast', { text: 'Save copied to clipboard!' }); }
      catch { prompt('Copy your save code:', code); }
    },
  }, 'Export save');
  const impIn = el('input', { placeholder: 'paste save code…', style: 'flex:1;padding:.4em;border:2px solid var(--wood);border-radius:8px' });
  const imp = el('button', {
    class: 'btn btn-small', onclick: () => {
      if (importSave(impIn.value)) { emit('toast', { text: 'Save imported!' }); location.reload(); }
      else emit('toast', { text: 'Invalid save code.' });
    },
  }, 'Import');
  bodyEl.append(el('div', { style: 'display:flex;gap:8px;align-items:center' }, exp, impIn, imp));

  bodyEl.append(el('div', { class: 'win-section-title' }, 'How to play'));
  bodyEl.append(el('div', { class: 'muted', html: `
    <b>WASD</b> walk · <b>Shift</b> run · scroll to zoom · right-click for options<br>
    <b>Click the water</b> to cast at that spot (or hold SPACE to charge a cast)<br>
    When the <b>!</b> appears — click or SPACE to hook! Then hold to keep the fish in the green bar.<br>
    <b>E</b> talk / interact · <b>Enter</b> chat · <b>B</b> backpack · <b>F</b> dex · <b>K</b> skill · <b>J</b> achievements · <b>R</b> rod · <b>P</b> potions · <b>M</b> map · <b>I</b> island<br><br>
    Find the sewer grate behind the bakery. Ride the ferry. Anchor your island. Catch all 1000.` }));

  if (ctx.net?.roomCode) {
    bodyEl.append(el('div', { class: 'win-section-title' }, 'Multiplayer'));
    bodyEl.append(el('button', { class: 'btn btn-danger btn-small', onclick: () => { ctx.net.leave(); closeWindow(); } }, 'Leave lobby'));
  }
}
