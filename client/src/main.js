// Driftwood Isles — boot, title screen, game loop, and glue (2D pixel edition).
import { $, el, clamp, dist2d, rarityRank } from './core/util.js';
import { on, emit } from './core/events.js';
import { S, save, hasSave, loadSave, newGame, getLevel, setFlag, visitZone } from './core/state.js';
import { World2D } from './render2d/world2d.js';
import { Renderer2D } from './render2d/renderer2d.js';
import { Player, Input, makeHumanoid, attachLabel, showBubble } from './player/player.js';
import { Fishing } from './fishing/fishing.js';
import { NPCManager, npcOptions } from './npc/npc.js';
import { HUD } from './ui/hud.js';
import { openWindow, closeWindow, currentWindow, openCustom } from './ui/windows.js';
import { openShop, openBroker, openFerry, openBuilding, openIslandWindow, openLobbyWindow } from './ui/shops.js';
import { Minimap } from './ui/minimap.js';
import { showContextMenu } from './ui/context.js';
import { maybeDismissCatchCard } from './ui/catchcard.js';
import { net } from './net/net.js';
import { iconHtml, iconDataUrl } from './ui/icons.js';
import { ZONE_LORE } from './data/gen-zones.js';
import { TRANSCENDENT } from './data/gen-fish.js';

// ---------------- canvas + renderer ----------------
const canvas = $('#game-canvas');
const renderer = new Renderer2D(canvas);

// inject pixel icons into all [data-icon] slots + swap the favicon
for (const slot of document.querySelectorAll('[data-icon]')) {
  slot.innerHTML = iconHtml(slot.dataset.icon, slot.classList.contains('hud-btn') ? 24 : 14);
}
document.querySelector('link[rel="icon"]')?.setAttribute('href', iconDataUrl('rod'));

// ---------------- tiny audio ----------------
let audioCtx = null;
function blip(freq = 660, dur = 0.09, type = 'sine', gain = 0.05) {
  if (!S.settings.sfx) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch { /* no audio */ }
}
on('catch', ({ fish }) => { blip(520, 0.1); setTimeout(() => blip(780, 0.12), 90); if (rarityRank(fish.rarity) >= 4) setTimeout(() => blip(1040, 0.25, 'triangle', 0.07), 200); });
on('achievement', () => { blip(660, 0.1, 'triangle'); setTimeout(() => blip(880, 0.18, 'triangle'), 110); });
on('levelup', () => { blip(440, 0.1); setTimeout(() => blip(550, 0.1), 100); setTimeout(() => blip(660, 0.2), 200); });
on('fishing', ({ phase }) => { if (phase === 'bite') blip(980, 0.08, 'square', 0.06); });

// ---------------- game objects ----------------
const actors = new Set();
const stage = { add: (a) => actors.add(a), remove: (a) => actors.delete(a) };
let world, player, fishing, npcs, hud, input, minimap;
let running = false;
let lastInteractable = null;
let dialogueNpc = null;
const remotes = new Map(); // id -> {rig, tx, tz, try, zone}
const seenZones = new Set();

function mapForZone(zone) {
  return ['sewer', 'cave', 'reef', 'deepsea', 'rig', 'abyss', 'island'].includes(zone) ? zone : 'overworld';
}

function startGame() {
  $('#title-screen').classList.add('hidden');
  world = new World2D();
  player = new Player(stage, world, S.look);
  attachLabel(player.rig, S.name, S.title, '#bfffe8');
  input = new Input(canvas);
  hud = new HUD();
  npcs = new NPCManager(stage, world);
  fishing = new Fishing(world, player, {
    onAnnounce: (c) => { if (net.roomCode) net.sendCatch(c); },
  });

  input.onWheel = (dy) => { renderer.zoom = clamp(renderer.zoom - dy * 0.0015, 1.4, 3.6); };

  // keyboard
  input.onKey = (code, down, e) => {
    if (!down) return;
    if (hud.chatFocused) return;
    maybeDismissCatchCard();
    if (code === 'Space') e.preventDefault();
    const windowKeys = {
      KeyB: 'backpack', KeyF: 'dex', KeyK: 'skills', KeyJ: 'achievements',
      KeyR: 'rod', KeyP: 'potions', KeyM: 'map', KeyI: 'island',
    };
    if (code === 'Escape') {
      if (currentWindow()) return closeWindow();
      if (dialogueNpc) return closeDialogue();
      if (fishing.active) return fishing.cancel();
      return;
    }
    if (currentWindow()) {
      if (!windowKeys[code]) return;
      if (currentWindow() === windowKeys[code] || (code === 'KeyI' && currentWindow() === 'island')) { closeWindow(); return; }
      closeWindow();
    }
    if (windowKeys[code]) {
      closeDialogue();
      if (code === 'KeyI') return openIslandWindow();
      if (code === 'KeyM') return openWindow('map', { playerPos: { x: player.x, z: player.z }, mapId: world.mapId });
      return openWindow(windowKeys[code], { net });
    }
    if (code === 'Enter') { hud.focusChat(); e.preventDefault(); return; }
    if (code === 'KeyE') { tryInteract(); return; }
    if (code === 'Space' && fishing.phase === 'idle' && !dialogueNpc) fishing.tryStartCast();
  };

  // left-click: cast toward a clicked water spot (Stardew-style)
  input.onPointerUp = (wasDrag, cx, cy) => {
    if (wasDrag || !running || hud.chatFocused || currentWindow() || dialogueNpc) return;
    maybeDismissCatchCard();
    if (fishing.phase !== 'idle') return;
    const wx = renderer.wx(cx), wz = renderer.wz(cy);
    if (world.isWaterAt(wx, wz)) {
      if (fishing.castAt(wx, wz)) input.consumeClick();
    }
  };

  $('#bait-pill').addEventListener('click', () => openBaitSwitcher());
  $('#net-pill').addEventListener('click', () => openLobbyWindow(net));
  for (const btn of document.querySelectorAll('.hud-btn')) {
    btn.addEventListener('click', () => {
      const w = btn.dataset.window;
      closeDialogue();
      if (w === 'island') return openIslandWindow();
      if (w === 'map') return openWindow('map', { playerPos: { x: player.x, z: player.z }, mapId: world.mapId });
      if (w === 'settings') return openWindow('settings', { net });
      openWindow(w, { net });
    });
  }

  hud.onChatSend = (text) => {
    setFlag('chat_first');
    if (net.roomCode) net.sendChat(text);
    else {
      hud.chatLine(S.name, text);
      showBubble(player.rig, text);
    }
  };

  on('zone', ({ zone }) => {
    const lore = ZONE_LORE[zone];
    if (lore && !seenZones.has(zone)) {
      seenZones.add(zone);
      emit('toast', { text: lore.displayName, sub: lore.sign });
    }
  });
  on('game:portal-moved', () => { if (world.mapId === 'overworld') switchMap('overworld', { x: player.x, z: player.z }); });
  on('profile', () => {
    attachLabel(player.rig, S.name, S.title, '#bfffe8');
    if (net.roomCode) net.setProfile({ name: S.name, title: S.title, level: getLevel(), look: S.look });
  });
  on('levelup', () => { if (net.roomCode) net.setProfile({ name: S.name, title: S.title, level: getLevel(), look: S.look }); });

  wireNet();

  // enter world
  minimap = new Minimap();
  const spawn = world.loadMap(mapForZone(S.zone), S.pos.x || S.pos.z ? { x: S.pos.x, z: S.pos.z } : null);
  player.place(spawn.x, spawn.z);
  npcs.spawnForMap(world.mapId);
  minimap.rebuild(world);
  renderer.invalidate();
  hud.show();
  hud.refresh(world, net);
  running = true;
  $('#loading-screen').classList.add('fade');
  window.__DI = {
    get world() { return world; }, get player() { return player; },
    get fishing() { return fishing; }, get npcs() { return npcs; },
    get input() { return input; }, get renderer() { return renderer; },
    switchMap, S, net,
  };
}

function switchMap(mapId, spawnHint = null) {
  closeDialogue();
  if (fishing.active) fishing.cancel();
  player.walkTarget = null;
  const spawn = world.loadMap(mapId, spawnHint);
  player.place(spawn.x, spawn.z);
  npcs.spawnForMap(mapId);
  minimap?.rebuild(world);
  renderer.invalidate();
  for (const [, r] of remotes) r.rig.visible = mapForZone(r.zone) === mapId && mapId !== 'island';
  save();
}

// ---------------- right-click Choose Option menu ----------------
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!running || currentWindow()) return;
  maybeDismissCatchCard();
  const options = [];
  const near = (x, z, r) => dist2d(player.x, player.z, x, z) < r;
  const tooFar = () => hud.chatLine(null, "I can't reach that!", 'system');
  const screenDist = (x, z, off = 0) => Math.hypot(renderer.sx(x) - e.clientX, renderer.sz(z) - off - e.clientY);
  for (const n of npcs.npcs) {
    if (screenDist(n.x, n.z, 20 * renderer.zoom) > 55) continue;
    options.push({ verb: 'Talk-to', target: n.def.name, fn: () => (near(n.x, n.z, 6.5) ? openDialogue(n) : tooFar()) });
    if (n.def.shop) options.push({ verb: 'Trade', target: n.def.name, fn: () => (near(n.x, n.z, 6.5) ? openShop(n.def.shop) : tooFar()) });
    if (n.def.banker) options.push({ verb: 'Bank', target: n.def.name, fn: () => (near(n.x, n.z, 6.5) ? openWindow('bank') : tooFar()) });
    options.push({ verb: 'Examine', target: n.def.name, fn: () => hud.chatLine(null, n.def.personality || 'A fellow islander.', 'system') });
  }
  for (const it of world.interactables()) {
    if (screenDist(it.x, it.z, 8 * renderer.zoom) > 60) continue;
    options.push({ verb: it.label, object: true, fn: () => (near(it.x, it.z, it.r + 2) ? runAction(it.action) : tooFar()) });
  }
  for (const [, r] of remotes) {
    if (!r.rig.visible) continue;
    if (screenDist(r.rig.position.x, r.rig.position.z, 20 * renderer.zoom) > 50) continue;
    const p = [...net.players.values()].find((pp) => remotes.get(pp.id) === r);
    if (p) options.push({ verb: 'Wave at', target: p.name, fn: () => { if (net.roomCode) net.sendChat('*waves*'); } });
  }
  const wxp = renderer.wx(e.clientX), wzp = renderer.wz(e.clientY);
  if (world.isWaterAt(wxp, wzp)) {
    options.push({ verb: 'Cast here', object: true, fn: () => { if (fishing.phase === 'idle') fishing.castAt(wxp, wzp); } });
  }
  options.push({ verb: 'Walk here', fn: () => { player.walkTarget = { x: wxp, z: wzp }; } });
  options.push({ verb: 'Cancel', fn: () => {} });
  showContextMenu(e.clientX, e.clientY, options);
});

// ---------------- interactions ----------------
function tryInteract() {
  const npc = npcs.nearest(player.x, player.z);
  if (npc) return openDialogue(npc);
  const it = nearestInteractable();
  if (it) return runAction(it.action);
}
function nearestInteractable() {
  let best = null, bd = 1e9;
  for (const it of world.interactables()) {
    const d = dist2d(player.x, player.z, it.x, it.z);
    if (d < it.r && d < bd) { bd = d; best = it; }
  }
  return best;
}
function runAction(action) {
  switch (action.type) {
    case 'map': return switchMap(action.target, action.spawn || null);
    case 'ferry': return openFerry((dest) => {
      if (dest === 'overworld') switchMap('overworld', { x: 474, z: 440 });
      else switchMap(dest);
    });
    case 'bank': return openWindow('bank');
    case 'shop': return openShop(action.shop);
    case 'broker': return openBroker();
    case 'building': return openBuilding(action.key, () => switchMap('island'));
    case 'window': return openWindow(action.window, { net });
    case 'info': return emit('toast', { text: action.text });
  }
}

// ---------------- NPC dialogue ----------------
function openDialogue(npc) {
  dialogueNpc = npc;
  const def = npc.def;
  const opts = npcOptions(def);
  hud.showDialogue(`${def.name} — ${def.role}`, def.greeting || '...', opts, (opt) => {
    const act = opt.act;
    if (act.type === 'close') return closeDialogue();
    if (act.type === 'chat') {
      const line = def.lines[Math.floor(Math.random() * def.lines.length)];
      hud.setDialogueText(line);
      npcs.say(npc, line);
      return;
    }
    if (act.type === 'legends') {
      const t = TRANSCENDENT[Math.floor(Math.random() * TRANSCENDENT.length)];
      hud.setDialogueText(t ? `They say ${t.name}, ${t.title}, still haunts the ${ZONE_LORE[t.biome]?.displayName || t.biome}. ${t.flavor}` : 'The legends sleep today.');
      return;
    }
    closeDialogue();
    runAction(act);
  });
}
function closeDialogue() {
  dialogueNpc = null;
  hud?.hideDialogue();
}

function openBaitSwitcher() {
  openCustom('baits', 'Choose bait', (bodyEl) => {
    const ids = Object.keys(S.baits);
    if (!ids.length) {
      bodyEl.append(el('div', { class: 'muted' }, 'No bait! Buy some at the Bait Shop in Willowbrook.'));
      return;
    }
    const list = el('div', { class: 'row-list' });
    for (const id of ids) {
      const b = (S.baits[id] || 0);
      const def = window.__baitDefs?.[id] || { name: id };
      list.append(el('div', { class: 'list-row' },
        el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, `${def.name || id} ×${b}`)),
        S.activeBait === id ? el('span', { class: 'muted' }, 'active')
          : el('button', { class: 'btn btn-small btn-primary', onclick: () => { S.activeBait = id; emit('state'); closeWindow(); } }, 'Use')));
    }
    bodyEl.append(list);
  });
}
import(new URL('./data/gen-items.js', import.meta.url)).then((m) => {
  window.__baitDefs = Object.fromEntries(m.BAITS.map((b) => [b.id, b]));
});

// ---------------- multiplayer ----------------
function wireNet() {
  net.on('chat', ({ id, name, text }) => {
    hud.chatLine(name, text);
    if (id === net.selfId) showBubble(player.rig, text);
    else {
      const r = remotes.get(id);
      if (r) showBubble(r.rig, text);
    }
  });
  net.on('system', (text) => hud.chatLine(null, text, 'system'));
  net.on('catch', ({ name, fishName, rarity, len }) => {
    hud.chatLine(null, `${name} caught ${fishName} (${rarity.toUpperCase()}, ${len} cm)!`, 'rare');
  });
  net.on('players', () => refreshRemotes());
  net.on('pos', ({ id, x, z, ry, zone, anim }) => {
    const r = remotes.get(id);
    if (r) {
      r.tx = x; r.tz = z; r.try = ry; r.zone = zone;
      r.rig.userData.setAnim(anim || 'idle');
      r.rig.visible = mapForZone(zone) === world.mapId && world.mapId !== 'island';
    }
  });
  net.on('kicked', (reason) => {
    emit('toast', { text: reason, sub: 'You are back in single-player.' });
    refreshRemotes();
  });
  net.on('muted', ({ self, muted }) => {
    if (self) emit('toast', { text: muted ? 'You were muted by the host.' : 'You were unmuted.' });
  });
  net.on('disconnect', () => {
    emit('toast', { text: 'Lost connection to the lobby.', sub: 'Continuing in single-player.' });
    refreshRemotes();
  });
}
function refreshRemotes() {
  const ids = new Set(net.players.keys());
  for (const [id, r] of remotes) {
    if (!ids.has(id)) { stage.remove(r.rig); remotes.delete(id); }
  }
  for (const [id, p] of net.players) {
    if (!remotes.has(id)) {
      const rig = makeHumanoid(p.look || {});
      attachLabel(rig, p.name, p.title, '#ffd9a8');
      stage.add(rig);
      remotes.set(id, { rig, tx: p.x || 0, tz: p.z || 0, try: 0, zone: p.zone || 'town' });
      rig.position.set(p.x || 0, 0, p.z || 0);
      rig.visible = mapForZone(p.zone || 'town') === world.mapId && world.mapId !== 'island';
    } else {
      const r = remotes.get(id);
      attachLabel(r.rig, p.name, p.title, '#ffd9a8');
    }
  }
  hud.refresh(world, net);
}

// ---------------- main loop ----------------
let lastT = performance.now();
let hudT = 0, saveT = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (!running) return;
  const t = now / 1000;

  input.typing = hud.chatFocused;
  world.update(dt, t);
  const wasMoving = player.speed > 1;
  player.update(dt, input);
  fishing.update(dt, t, input);
  npcs.update(dt, t, player);
  input.consumeClick();

  // dialogue auto-dismiss: walking away or doing anything else closes it
  if (dialogueNpc) {
    const d = dist2d(player.x, player.z, dialogueNpc.x, dialogueNpc.z);
    if (d > 7.5 || player.speed > 2 || fishing.active) closeDialogue();
  }
  if (player.speed > 2) maybeDismissCatchCard();

  // remote players interpolation
  for (const [, r] of remotes) {
    if (!r.rig.visible) continue;
    r.rig.position.x += (r.tx - r.rig.position.x) * Math.min(1, dt * 8);
    r.rig.position.z += (r.tz - r.rig.position.z) * Math.min(1, dt * 8);
    r.rig.rotation.y = r.try || 0;
    r.rig.userData.animate(t, dt);
  }
  if (net.roomCode) {
    net.sendPos(player.x, player.z, player.ry, S.zone,
      fishing.active ? 'fish' : player.rig.userData.getAnim());
  }

  // interact prompt
  const npc = npcs.nearest(player.x, player.z);
  const it = npc ? null : nearestInteractable();
  const promptText = npc ? `[E] Talk to ${npc.def.name}` : it ? `[E] ${it.label}` : null;
  if (promptText !== lastInteractable) {
    lastInteractable = promptText;
    if (promptText) hud.showPrompt(promptText);
    else hud.hidePrompt();
  }
  const zone = world.zoneAt(player.x, player.z);
  if (zone !== S.zone) visitZone(zone);
  S.pos = { x: player.x, z: player.z };

  if (!fishing.active && !npc && !it && !currentWindow()) {
    const canFish = fishing.canFishHere();
    const hint = $('#action-hint');
    if (canFish && !hint.textContent) hint.textContent = 'Click the water (or hold SPACE) to cast';
    else if (!canFish && hint.textContent === 'Click the water (or hold SPACE) to cast') hint.textContent = '';
  }

  // camera follows player; render
  renderer.camX = player.x;
  renderer.camZ = player.z;
  renderer.render(world, actors, {
    bobber: fishing.bobber,
    lineFrom: { x: player.x, z: player.z },
    t,
  });
  minimap?.update(world, player, npcs, remotes);

  hudT += dt;
  if (hudT > 0.5) { hudT = 0; hud.refresh(world, net); }
  saveT += dt;
  if (saveT > 5) { saveT = 0; S.stats.playSeconds += 5; }
}
loop();

// ---------------- title screen ----------------
function initTitle() {
  const nameIn = $('#title-name');
  const status = $('#lobby-status');
  if (hasSave()) {
    loadSave();
    $('#title-continue-row').classList.remove('hidden');
    $('#continue-name').textContent = S.name;
    nameIn.value = S.name;
  }
  $('#loading-screen').classList.add('fade');

  const getName = () => (nameIn.value.trim() || 'Angler').slice(0, 16);

  $('#btn-continue')?.addEventListener('click', () => { loadSave(); startGame(); });
  $('#btn-singleplayer').addEventListener('click', () => {
    if (hasSave() && S.name === getName()) loadSave();
    else if (!hasSave()) newGame(getName());
    else { loadSave(); S.name = getName(); }
    startGame();
  });

  $('#btn-multiplayer').addEventListener('click', async () => {
    $('#lobby-panel').classList.remove('hidden');
    status.textContent = '';
    try {
      if (!net.connected) {
        net.setProfile({ name: getName(), title: S.title, level: getLevel(), look: S.look });
        await net.connect();
      }
      refreshLobbyList();
    } catch {
      status.textContent = 'Could not reach the lobby server. Multiplayer needs the game served by "npm start" (not a static host).';
    }
  });
  $('#btn-lobby-back').addEventListener('click', () => $('#lobby-panel').classList.add('hidden'));
  for (const tab of document.querySelectorAll('.lobby-tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lobby-tab').forEach((tt) => tt.classList.remove('active'));
      tab.classList.add('active');
      for (const page of document.querySelectorAll('.lobby-tabpage')) page.classList.add('hidden');
      $('#lobby-' + tab.dataset.tab).classList.remove('hidden');
    });
  }
  $('#btn-lobby-refresh').addEventListener('click', refreshLobbyList);
  async function refreshLobbyList() {
    const listEl = $('#lobby-list');
    try {
      const list = await net.listLobbies();
      listEl.innerHTML = '';
      if (!list.length) listEl.append(el('div', { class: 'lobby-empty' }, 'No public lobbies yet — create one!'));
      for (const l of list) {
        listEl.append(el('div', { class: 'lobby-row' },
          el('div', {},
            el('div', { style: 'font-weight:800' }, l.name),
            el('div', { class: 'lobby-meta' }, `${l.players}/${l.maxPlayers} anglers · ${l.motd || ''}`)),
          el('button', { class: 'btn btn-small btn-primary', onclick: () => joinLobby(l.code) }, 'Join')));
      }
    } catch {
      listEl.innerHTML = '<div class="lobby-empty">Lobby list unavailable.</div>';
    }
  }
  async function joinLobby(code) {
    try {
      prepareState();
      net.setProfile({ name: S.name, title: S.title, level: getLevel(), look: S.look });
      await net.joinLobby(code);
      startGame();
      hud.chatLine(null, `Joined lobby ${net.roomCode}. Say hi!`, 'system');
      if (net.settings?.motd) hud.chatLine(null, `MOTD: ${net.settings.motd}`, 'system');
    } catch (err) {
      status.textContent = err.message || 'Could not join.';
    }
  }
  function prepareState() {
    if (hasSave()) { loadSave(); S.name = getName(); }
    else newGame(getName());
  }
  $('#btn-lobby-join').addEventListener('click', () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length >= 4) joinLobby(code);
  });
  $('#btn-lobby-create').addEventListener('click', async () => {
    try {
      prepareState();
      net.setProfile({ name: S.name, title: S.title, level: getLevel(), look: S.look });
      await net.createLobby({
        name: $('#lobby-name').value.trim() || `${S.name}'s waters`,
        visibility: $('#lobby-visibility').value,
        maxPlayers: parseInt($('#lobby-max').value, 10),
        motd: $('#lobby-motd').value.trim(),
        announceRares: $('#lobby-announce').checked,
        chatEnabled: $('#lobby-chat').checked,
      });
      startGame();
      hud.chatLine(null, `Lobby created! Code: ${net.roomCode} — share it with friends.`, 'system');
    } catch (err) {
      status.textContent = err.message || 'Could not create lobby.';
    }
  });
}
initTitle();
