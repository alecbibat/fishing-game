// Persistent catch card: shows the caught fish with a rotatable 3D model and
// stays up until the player does anything else (moves, clicks, opens a window).
import { $, el, fmtLen, fmtWt, RARITY_COLOR, rarityRank } from '../core/util.js';
import { mountFishViewer } from './fishviewer.js';

let viewer = null;
let visible = false;
let shownAt = 0;

const cardEl = () => $('#catch-banner');

export function showCatchCard(fish, len, wt, record, sold) {
  const b = cardEl();
  hideCatchCard();
  b.className = rarityRank(fish.rarity) >= 3 ? 'rare-glow' : '';
  b.classList.remove('hidden');
  b.innerHTML = '';
  const viewerBox = el('div', { style: 'display:flex;justify-content:center;' });
  const parts = [
    el('div', { class: 'cb-name', style: `color:${RARITY_COLOR[fish.rarity]}` }, fish.name),
    el('div', { class: 'muted', style: `text-transform:uppercase;font-size:.7rem;letter-spacing:2px;color:${RARITY_COLOR[fish.rarity]}` }, fish.rarity),
    viewerBox,
    el('div', { class: 'cb-flavor' }, fish.flavor),
    el('div', { class: 'cb-stats' }, el('span', {}, fmtLen(len)), el('span', {}, fmtWt(wt))),
    record ? el('div', { class: 'cb-record' }, 'New personal best!') : null,
    sold ? el('div', { class: 'muted' }, `Backpack full — sold for ${sold} coins`) : null,
    el('div', { class: 'muted', style: 'margin-top:6px;font-size:.72rem' }, 'drag the fish to admire it · move or click to continue'),
  ].filter(Boolean);
  b.append(...parts);
  viewer = mountFishViewer(viewerBox, fish, { width: 260, height: 150 });
  visible = true;
  shownAt = performance.now();
}

export function hideCatchCard() {
  if (viewer) { viewer.dispose(); viewer = null; }
  cardEl()?.classList.add('hidden');
  visible = false;
}

export function catchCardVisible() { return visible; }

// dismiss on the next player action (after a short grace so the catch keypress doesn't eat it)
export function maybeDismissCatchCard(reason = 'action') {
  if (!visible) return;
  if (performance.now() - shownAt < 450) return;
  hideCatchCard();
}
