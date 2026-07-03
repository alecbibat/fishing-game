// Shops, brewing, rod crafting, island broker, ferry, island buildings, lobby manager.
import { $, el, fmtNum, RARITY_COLOR, rarityRank } from '../core/util.js';
import { emit } from '../core/events.js';
import { S, save, addCoins, canAfford, getLevel, getEffects, getRodDef, checkAchievements, setFlag } from '../core/state.js';
import { ATTACHMENTS, BAITS, POTIONS, RODS } from '../data/gen-items.js';
import { FISH_BY_ID } from '../data/gen-fish.js';
import { BACKPACK_TIERS, BUILDINGS, PORTAL_SPOTS } from '../data/static.js';
import { ZONE_LORE } from '../data/gen-zones.js';
import { openCustom, closeWindow } from './windows.js';
import { icon } from './icons.js';

const rarPill = (r) => el('span', { class: 'pill', style: `background:${RARITY_COLOR[r]}` }, r);

// ---------- generic shops ----------
export function openShop(shopId) {
  const builders = { bait: buildBaitShop, attachments: buildAttachShop, potions: (b) => buildBrewing(b, 1), general: buildGeneral, rods: (b) => buildWorkshop(b, 0) };
  const titles = { bait: 'Bait Shop', attachments: "Tinkerer's Attachments", potions: 'Potion Cauldron', general: 'General Store', rods: 'Rod Dealer' };
  if (!builders[shopId]) return;
  openCustom('shop:' + shopId, titles[shopId], builders[shopId]);
}

function coinsHeader(bodyEl) {
  bodyEl.append(el('div', { class: 'muted', style: 'margin-bottom:8px' }, `You have ${fmtNum(S.coins)} `, icon('coin', 13)));
}

function buildBaitShop(bodyEl) {
  coinsHeader(bodyEl);
  const list = el('div', { class: 'row-list' });
  for (const b of BAITS.filter((x) => !x.farmOnly).sort((a, b) => a.price - b.price)) {
    const buy = (n) => {
      const cost = b.price * n;
      if (!canAfford(cost)) return emit('toast', { text: 'Not enough coins!' });
      addCoins(-cost, false);
      S.baits[b.id] = (S.baits[b.id] || 0) + n;
      if (!S.activeBait) S.activeBait = b.id;
      emit('state');
    };
    list.append(el('div', { class: 'list-row' },
      el('div', {}, icon('bait', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `${b.name} `, el('span', { class: 'muted', style: 'font-size:.75rem' }, `tier ${b.tier} ${b.category}`)),
        el('div', { class: 'row-desc' }, `${b.flavor} — you own ×${S.baits[b.id] || 0}`)),
      el('button', { class: 'btn btn-small', onclick: () => buy(10) }, `×10 (${fmtNum(b.price * 10)}c)`),
      el('button', { class: 'btn btn-small btn-primary', onclick: () => buy(50) }, `×50 (${fmtNum(b.price * 50)}c)`)));
  }
  list.append(el('div', { class: 'muted' }, 'Rarer baits can only be grown on your island Bait Farm.'));
  bodyEl.append(list);
}

function buildAttachShop(bodyEl) {
  coinsHeader(bodyEl);
  const list = el('div', { class: 'row-list' });
  for (const a of [...ATTACHMENTS].sort((x, y) => x.price - y.price)) {
    const owned = S.attachmentsOwned.includes(a.id);
    list.append(el('div', { class: 'list-row' },
      el('div', {}, icon({ bobber: 'bobber', hook: 'hook', reel: 'reel', gadget: 'gadget' }[a.slot], 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name', style: `color:${RARITY_COLOR[a.rarity]}` }, a.name, ' ', rarPill(a.rarity)),
        el('div', { class: 'row-desc' }, a.flavor)),
      owned ? el('span', { class: 'muted' }, 'owned')
        : el('button', {
          class: 'btn btn-small btn-primary', onclick: () => {
            if (!canAfford(a.price)) return emit('toast', { text: 'Not enough coins!' });
            addCoins(-a.price, false);
            S.attachmentsOwned.push(a.id);
            if (S.attachmentsOwned.length >= 4) setFlag('all_attach_slots');
            emit('toast', { text: `Bought ${a.name}!`, sub: 'Equip it in the Rod window (R).' });
            emit('state');
          },
        }, `${fmtNum(a.price)}c`)));
  }
  bodyEl.append(list);
}

function buildGeneral(bodyEl) {
  coinsHeader(bodyEl);
  bodyEl.append(el('div', { class: 'win-section-title' }, 'Backpack upgrades'));
  const list = el('div', { class: 'row-list' });
  BACKPACK_TIERS.forEach((t, i) => {
    let btn;
    if (i <= S.backpackTier) btn = el('span', { class: 'muted' }, i === S.backpackTier ? 'current' : 'owned');
    else if (i === S.backpackTier + 1) btn = el('button', {
      class: 'btn btn-small btn-primary', onclick: () => {
        if (!canAfford(t.price)) return emit('toast', { text: 'Not enough coins!' });
        addCoins(-t.price, false);
        S.backpackTier = i;
        if (i === BACKPACK_TIERS.length - 1) setFlag('max_backpack');
        emit('toast', { text: `Upgraded to ${t.name}!`, sub: `${t.slots} slots` });
        emit('state');
      },
    }, `${fmtNum(t.price)}c`);
    else btn = el('span', { class: 'muted', style: 'font-weight:900' }, '—');
    list.append(el('div', { class: `list-row ${i > S.backpackTier + 1 ? 'locked' : ''}` },
      el('div', {}, icon('backpack', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, t.name),
        el('div', { class: 'row-desc' }, `${t.slots} slots`)),
      btn));
  });
  bodyEl.append(list);
}

// ---------- rod workshop (island building or rod dealer) ----------
export function buildWorkshop(bodyEl, discount = 0) {
  coinsHeader(bodyEl);
  const ownedTier = S.rodTierOwned || 1;
  bodyEl.append(el('div', { class: 'muted', style: 'margin-bottom:8px' },
    discount ? `Workshop discount: -${Math.round(discount * 100)}% coins` : 'The dealer charges full price — build an island Workshop for discounts.'));
  const list = el('div', { class: 'row-list' });
  for (const r of RODS) {
    const cost = Math.floor(r.cost.coins * (1 - discount));
    const isNext = r.tier === ownedTier + 1;
    const owned = r.tier <= ownedTier;
    const fishNeeds = (r.cost.fish || []).map((f) => ({ ...f, have: countFishMatching(f) }));
    const canFish = fishNeeds.every((f) => f.have >= f.n);
    const needsTxt = fishNeeds.map((f) => `${f.n}× ${f.value} fish (${f.have}/${f.n})`).join(', ');
    let btn;
    if (owned) btn = el('span', { class: 'muted' }, 'crafted');
    else if (isNext) {
      btn = el('button', {
        class: 'btn btn-small btn-primary',
        onclick: () => {
          if (!canAfford(cost)) return emit('toast', { text: 'Not enough coins!' });
          if (!canFish) return emit('toast', { text: 'Missing fish ingredients!', sub: needsTxt });
          addCoins(-cost, false);
          for (const f of fishNeeds) consumeFishMatching(f, f.n);
          S.rodTierOwned = r.tier;
          S.rod = { kind: 'tier', id: r.id };
          checkAchievements();
          emit('toast', { text: `Crafted the ${r.name}!`, sub: r.flavor, kind: 'achieve', icon: 'rod' });
          emit('state');
        },
      }, `Craft — ${fmtNum(cost)}c`);
    } else btn = el('span', { class: 'muted', style: 'font-weight:900' }, '—');
    list.append(el('div', { class: `list-row ${!owned && !isNext ? 'locked' : ''}` },
      el('div', {}, owned ? el('span', { style: 'font-weight:900' }, '✓') : icon('rod', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `T${r.tier} — ${r.name}`),
        el('div', { class: 'row-desc' }, `${r.flavor || ''}${(!owned && (r.cost.fish || []).length) ? ` · Needs: ${needsTxt}` : ''}`),
        el('div', { class: 'row-desc' }, `power ${r.stats.power} · slots ${r.stats.slots} · +${Math.round((r.stats.rareLuck || 0) * 100)}% luck · +${Math.round((r.stats.biteRate || 0) * 100)}% bite`)),
      btn));
  }
  bodyEl.append(list);
}

function matchesReq(fish, req) {
  if (!fish) return false;
  if (req.kind === 'rarity') return fish.rarity === req.value;
  if (req.kind === 'biome') return fish.biome === req.value;
  if (req.kind === 'sizeClass') return fish.sizeClass === req.value;
  return false;
}
export function countFishMatching(req) {
  let n = 0;
  for (const it of [...S.inventory, ...S.bank]) {
    if (it.kind === 'fish' && matchesReq(FISH_BY_ID.get(it.fishId), req)) n++;
  }
  return n;
}
export function consumeFishMatching(req, n) {
  for (const arr of [S.inventory, S.bank]) {
    for (let i = arr.length - 1; i >= 0 && n > 0; i--) {
      const it = arr[i];
      if (it.kind === 'fish' && matchesReq(FISH_BY_ID.get(it.fishId), req)) { arr.splice(i, 1); n--; }
    }
  }
}

// ---------- brewing ----------
export function buildBrewing(bodyEl, doses = 1) {
  bodyEl.append(el('div', { class: 'muted', style: 'margin-bottom:8px' },
    `Potions are brewed from fish in your backpack and bank. ${doses > 1 ? `Your brewery makes ×${doses} doses per brew!` : ''}`));
  const list = el('div', { class: 'row-list' });
  for (const p of POTIONS) {
    const needs = p.ingredients.map((ing) => ({ ...ing, have: countFishMatching(ing) }));
    const ok = needs.every((x) => x.have >= x.n);
    const needsTxt = needs.map((x) => `${x.n}× ${x.value}${x.kind === 'rarity' ? ' fish' : x.kind === 'biome' ? ' catch' : ''} (${x.have}/${x.n})`).join(' · ');
    list.append(el('div', { class: `list-row ${ok ? '' : 'locked'}` },
      el('div', { style: `filter:drop-shadow(0 0 4px ${p.color})` }, icon('brewery', 22)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name' }, `${p.name} `, el('span', { class: 'muted', style: 'font-size:.75rem' }, `${p.duration} min`)),
        el('div', { class: 'row-desc' }, p.flavor),
        el('div', { class: 'row-desc' }, `Ingredients: ${needsTxt}`)),
      el('button', {
        class: 'btn btn-small btn-primary', disabled: ok ? undefined : '',
        onclick: () => {
          if (!ok) return;
          for (const x of needs) consumeFishMatching(x, x.n);
          S.potions[p.id] = (S.potions[p.id] || 0) + doses;
          S.stats.potionsBrewed += doses;
          checkAchievements();
          emit('toast', { text: `Brewed ${p.name}${doses > 1 ? ` ×${doses}` : ''}!`, sub: 'Drink it from the Potions window (P).', kind: 'achieve', icon: 'brewery' });
          emit('state');
        },
      }, 'Brew')));
  }
  bodyEl.append(list);
}

// ---------- island broker ----------
export function openBroker() {
  openCustom('broker', 'The Island Broker', (bodyEl) => {
    const placed = !!S.island.spot;
    const cost = placed ? 250 : 500;
    bodyEl.append(el('div', { class: 'muted' },
      placed
        ? `Your island portal is anchored at ${PORTAL_SPOTS.find((p) => p.id === S.island.spot)?.name}. Relocating costs ${cost} coins. Your island's waters take after wherever it anchors!`
        : `Every angler deserves an island. First anchoring costs ${cost} coins — choose wisely, or don't; I do relocations.`));
    const list = el('div', { class: 'row-list', style: 'margin-top:10px' });
    for (const spot of PORTAL_SPOTS) {
      const active = S.island.spot === spot.id;
      list.append(el('div', { class: 'list-row' },
        el('div', {}, icon(active ? 'portal' : 'sign', 22)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, spot.name),
          el('div', { class: 'row-desc' }, `Island waters will fish as: ${islandBiomeFor(spot.id)}`)),
        active ? el('span', { class: 'muted' }, 'anchored here')
          : el('button', {
            class: 'btn btn-small btn-primary', onclick: () => {
              if (!canAfford(cost)) return emit('toast', { text: 'Not enough coins!' });
              addCoins(-cost, false);
              const wasPlaced = !!S.island.spot;
              S.island.spot = spot.id;
              setFlag(wasPlaced ? 'island_moved' : 'island_placed');
              emit('toast', { text: wasPlaced ? 'Island portal relocated!' : 'Your island awaits!', sub: `Anchored at ${spot.name}. Look for the glowing stone circle.`, kind: 'achieve', icon: 'portal' });
              emit('game:portal-moved');
              emit('state');
            },
          }, `${cost}c`)));
    }
    bodyEl.append(list);
  });
}
function islandBiomeFor(spotId) {
  return { town_square: 'harbor', pond_meadow: 'pond', river_bend: 'river', lake_shore: 'lake', coast_dunes: 'coast', docks_edge: 'harbor', swamp_hollow: 'swamp', glacier_foot: 'glacier' }[spotId] || 'lake';
}

// ---------- ferry ----------
export function openFerry(onTravel) {
  const fx = getEffects();
  openCustom('ferry', 'Driftwood Ferry', (bodyEl) => {
    bodyEl.append(el('div', { class: 'muted' }, '"Where to, angler? Mind the spray."'));
    const list = el('div', { class: 'row-list', style: 'margin-top:10px' });
    const dests = [
      { id: 'reef', icon: 'fish_rare', need: null },
      { id: 'deepsea', icon: 'ferry', need: null },
      { id: 'rig', icon: 'workshop', need: null },
      { id: 'abyss', icon: 'moon', need: fx.abyss ? null : 'Requires fishing level 70 (Abyss License)' },
      { id: 'overworld', icon: 'sign', label: 'Back to Driftwood Docks', need: null },
    ];
    for (const d of dests) {
      const lore = ZONE_LORE[d.id];
      list.append(el('div', { class: `list-row ${d.need ? 'locked' : ''}` },
        el('div', {}, icon(d.icon, 22)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, d.label || lore?.displayName || d.id),
          el('div', { class: 'row-desc' }, d.need || lore?.tagline || '')),
        d.need ? el('span', { class: 'muted', style: 'font-weight:900' }, '—') : el('button', {
          class: 'btn btn-small btn-primary',
          onclick: () => { closeWindow(); onTravel(d.id); },
        }, 'Sail')));
    }
    bodyEl.append(list);
  });
}

// ---------- island buildings ----------
export function openBuilding(key, onRebuild) {
  const def = BUILDINGS[key];
  const lvl = S.island.buildings[key] || 0;
  openCustom('building:' + key, `${def.name}${lvl ? ' ' + '★'.repeat(lvl) : ''}`, (bodyEl) => {
    bodyEl.append(el('div', { class: 'muted' }, def.desc));
    // build / upgrade
    if (lvl < def.levels.length) {
      const next = def.levels[lvl];
      bodyEl.append(el('div', { class: 'list-row', style: 'margin-top:10px' },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, lvl === 0 ? `Build ${def.name}` : `Upgrade to ${'★'.repeat(lvl + 1)}`),
          el('div', { class: 'row-desc' }, `Cost: ${fmtNum(next.cost)} coins`)),
        el('button', {
          class: 'btn btn-small btn-gold', onclick: () => {
            if (!canAfford(next.cost)) return emit('toast', { text: 'Not enough coins!' });
            addCoins(-next.cost, false);
            S.island.buildings[key] = lvl + 1;
            setFlag('built_' + key);
            emit('toast', { text: `${def.name} ${lvl === 0 ? 'built' : 'upgraded'}!`, kind: 'achieve', icon: key });
            onRebuild?.();
            emit('state');
            closeWindow();
          },
        }, lvl === 0 ? 'Build' : 'Upgrade')));
    }
    if (lvl === 0) return;
    bodyEl.append(el('div', { class: 'win-section-title' }, 'Use'));
    if (key === 'workshop') buildWorkshop(bodyEl, def.levels[lvl - 1].discount);
    if (key === 'brewery') buildBrewing(bodyEl, def.levels[lvl - 1].doses);
    if (key === 'farm') buildFarm(bodyEl, def.levels[lvl - 1], onRebuild);
    if (key === 'shrine') buildShrine(bodyEl, def.levels[lvl - 1]);
  });
}

function buildFarm(bodyEl, lvlDef, onRebuild) {
  const farmBaits = BAITS.filter((b) => b.farmOnly);
  const list = el('div', { class: 'row-list' });
  for (let i = 0; i < lvlDef.plots; i++) {
    const plot = S.island.farm[i];
    if (!plot) {
      const row = el('div', { class: 'list-row' },
        el('div', {}, icon('seed', 22)),
        el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, `Plot ${i + 1} — empty`)));
      for (const b of farmBaits) {
        row.append(el('button', {
          class: 'btn btn-small', onclick: () => {
            const mins = (b.tier * 6) / lvlDef.speed;
            S.island.farm[i] = { baitId: b.id, ready: Date.now() + mins * 60000 };
            emit('state');
          },
        }, `Plant ${b.name}`));
      }
      list.append(row);
    } else {
      const b = BAITS.find((x) => x.id === plot.baitId);
      const ready = plot.ready <= Date.now();
      list.append(el('div', { class: 'list-row' },
        el('div', {}, icon(ready ? 'harvest' : 'farm', 22)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, `Plot ${i + 1} — ${b?.name || plot.baitId}`),
          el('div', { class: 'row-desc' }, ready ? 'Ready to harvest!' : `Ready in ${Math.ceil((plot.ready - Date.now()) / 60000)} min`)),
        ready ? el('button', {
          class: 'btn btn-small btn-gold', onclick: () => {
            const qty = 4 + Math.floor(Math.random() * 5);
            S.baits[plot.baitId] = (S.baits[plot.baitId] || 0) + qty;
            S.island.farm[i] = null;
            emit('toast', { text: `Harvested ${qty}× ${b?.name}!`, icon: 'harvest' });
            onRebuild?.();
            emit('state');
          },
        }, 'Harvest') : null));
    }
  }
  bodyEl.append(list);
}

function buildShrine(bodyEl, lvlDef) {
  const CD = 4 * 3600 * 1000;
  const readyAt = (S.island.lastShrine || 0) + CD;
  const ready = Date.now() >= readyAt;
  const blessings = [
    { name: 'Tide\'s Favor', fx: { rareLuck: lvlDef.power } },
    { name: 'Old Current', fx: { biteRate: lvlDef.power * 1.5 } },
    { name: 'Moon\'s Patience', fx: { stability: lvlDef.power, barSize: lvlDef.power * 0.7 } },
    { name: 'Gilded Scales', fx: { goldBonus: lvlDef.power * 2 } },
    { name: 'Deep Knowledge', fx: { xpBonus: lvlDef.power * 2 } },
  ];
  bodyEl.append(el('div', { class: 'list-row' },
    el('div', {}, icon('shrine', 22)),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-name' }, 'Pray at the Tide Shrine'),
      el('div', { class: 'row-desc' }, ready ? 'The water in the basin trembles, waiting.' : `The shrine rests. Return in ${Math.ceil((readyAt - Date.now()) / 60000)} min.`)),
    ready ? el('button', {
      class: 'btn btn-small btn-gold', onclick: () => {
        const b = blessings[Math.floor(Math.random() * blessings.length)];
        S.island.lastShrine = Date.now();
        S.island.shrineBuff = { name: b.name, fx: b.fx, until: Date.now() + 30 * 60000 };
        emit('toast', { text: `Blessing: ${b.name}`, sub: '30 minutes of favor from the tide.', kind: 'achieve', icon: 'shrine' });
        emit('state');
        closeWindow();
      },
    }, 'Pray') : el('span', { class: 'muted' }, 'resting')));
}

// ---------- island overview ----------
export function openIslandWindow() {
  openCustom('island', 'Your Island', (bodyEl) => {
    if (!S.island.spot) {
      bodyEl.append(el('div', { class: 'list-row' },
        el('div', {}, icon('island', 26)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, 'You don\'t have an island yet!'),
          el('div', { class: 'row-desc' }, 'Talk to the Island Broker in Willowbrook (near the square) to anchor your very own island for 500 coins. You can move it anytime — your island\'s waters take after wherever it anchors.'))));
      return;
    }
    const spot = PORTAL_SPOTS.find((p) => p.id === S.island.spot);
    bodyEl.append(el('div', { class: 'muted' }, `Anchored at ${spot?.name}. Its waters fish as ${islandBiomeFor(S.island.spot)}. Step through the glowing portal circle to visit.`));
    bodyEl.append(el('div', { class: 'win-section-title' }, 'Buildings'));
    const list = el('div', { class: 'row-list' });
    for (const [key, def] of Object.entries(BUILDINGS)) {
      const lvl = S.island.buildings[key] || 0;
      list.append(el('div', { class: `list-row ${lvl ? '' : 'locked'}` },
        el('div', {}, icon(key, 22)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, `${def.name} ${lvl ? '★'.repeat(lvl) : '(not built)'}`),
          el('div', { class: 'row-desc' }, def.desc)),
        el('span', { class: 'muted' }, lvl ? '' : `${fmtNum(def.levels[0].cost)}c on-site`)));
    }
    bodyEl.append(list);
    // farm status glance
    const growing = S.island.farm.filter(Boolean);
    if (growing.length) {
      bodyEl.append(el('div', { class: 'win-section-title' }, 'Farm'));
      for (const plot of growing) {
        const b = BAITS.find((x) => x.id === plot.baitId);
        const ready = plot.ready <= Date.now();
        bodyEl.append(el('div', { class: 'muted' }, icon(ready ? 'harvest' : 'farm', 13), ` ${b?.name}: ${ready ? 'ready!' : Math.ceil((plot.ready - Date.now()) / 60000) + ' min'}`));
      }
    }
  });
}

// ---------- multiplayer lobby manager ----------
export function openLobbyWindow(net) {
  openCustom('lobby', `Lobby ${net.roomCode || ''}`, (bodyEl) => {
    if (!net.roomCode) {
      bodyEl.append(el('div', { class: 'muted' }, 'Not in a lobby. Return to the title screen to join one.'));
      return;
    }
    const st = net.settings || {};
    bodyEl.append(el('div', { class: 'muted' }, `"${st.name || 'Lobby'}" · code ${net.roomCode} · ${st.motd || ''}`));
    bodyEl.append(el('div', { class: 'win-section-title' }, `Anglers (${net.players.size + 1}/${st.maxPlayers || '?'})`));
    const list = el('div', { class: 'row-list' });
    list.append(el('div', { class: 'list-row' },
      el('div', {}, icon('lobby', 20)),
      el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, `${S.name} (you)${net.isHost ? ' [host]' : ''}`))));
    for (const [id, p] of net.players) {
      const row = el('div', { class: 'list-row' },
        el('div', {}, icon('lobby', 20)),
        el('div', { class: 'row-main' },
          el('div', { class: 'row-name' }, `${p.name}${p.muted ? ' [muted]' : ''}`),
          el('div', { class: 'row-desc' }, `Lv ${p.level || '?'}${p.title ? ' · ' + p.title : ''} · ${ZONE_LORE[p.zone]?.displayName || p.zone || ''}`)));
      if (net.isHost) {
        row.append(
          el('button', { class: 'btn btn-small', onclick: () => { net.mod(p.muted ? 'unmute' : 'mute', id); setTimeout(() => openLobbyWindow(net), 300); } }, p.muted ? 'Unmute' : 'Mute'),
          el('button', { class: 'btn btn-small', onclick: () => { net.mod('kick', id); setTimeout(() => openLobbyWindow(net), 300); } }, 'Kick'),
          el('button', { class: 'btn btn-small btn-danger', onclick: () => { net.mod('ban', id); setTimeout(() => openLobbyWindow(net), 300); } }, 'Ban'));
      }
      list.append(row);
    }
    bodyEl.append(list);
    if (net.isHost) {
      bodyEl.append(el('div', { class: 'win-section-title' }, 'Lobby settings (host)'));
      const motdIn = el('input', { value: st.motd || '', maxlength: 80, style: 'flex:1;padding:.4em;border:2px solid var(--wood);border-radius:8px' });
      bodyEl.append(el('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px' },
        el('span', { style: 'font-weight:700' }, 'MOTD'), motdIn,
        el('button', { class: 'btn btn-small', onclick: () => net.updateSettings({ motd: motdIn.value }) }, 'Set')));
      const mkToggle = (label, key) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!st[key];
        cb.addEventListener('change', () => net.updateSettings({ [key]: cb.checked }));
        return el('label', { class: 'check-label', style: 'display:flex;gap:8px;font-weight:700' }, cb, label);
      };
      bodyEl.append(mkToggle('Chat enabled', 'chatEnabled'), mkToggle('Announce rare catches', 'announceRares'));
    }
    bodyEl.append(el('div', { style: 'margin-top:12px' },
      el('button', { class: 'btn btn-danger btn-small', onclick: () => { net.leave(); closeWindow(); } }, 'Leave lobby')));
  });
}
