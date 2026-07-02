// OSRS-style right-click "Choose Option" menu.
import { $, el } from '../core/util.js';

const menu = () => $('#context-menu');
const optsEl = () => $('#context-options');

export function showContextMenu(x, y, options) {
  const m = menu();
  const box = optsEl();
  box.innerHTML = '';
  for (const opt of options) {
    const row = el('div', {
      class: 'context-row',
      onclick: () => { hideContextMenu(); opt.fn?.(); },
    });
    row.append(document.createTextNode(opt.verb + (opt.target ? ' ' : '')));
    if (opt.target) row.append(el('span', { class: opt.object ? 'ctx-object' : 'ctx-target' }, opt.target));
    box.append(row);
  }
  m.classList.remove('hidden');
  // clamp to viewport, OSRS-style: menu header centered under cursor
  const rect = m.getBoundingClientRect();
  const mx = Math.min(Math.max(4, x - rect.width / 2), innerWidth - rect.width - 4);
  const my = Math.min(Math.max(4, y - 8), innerHeight - rect.height - 4);
  m.style.left = mx + 'px';
  m.style.top = my + 'px';
}

export function hideContextMenu() {
  menu()?.classList.add('hidden');
}

// close on any click elsewhere / escape
window.addEventListener('pointerdown', (e) => {
  if (!menu()?.contains(e.target)) hideContextMenu();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
