// HUD: badges, pills, toasts, chat log, dialogue box, interact prompt.
import { $, el, escapeHtml, fmtNum, RARITY_COLOR, rarityRank } from '../core/util.js';
import { on, emit } from '../core/events.js';
import { S, levelFromXp, getBaitDef, activePotionDefs } from '../core/state.js';
import { ZONE_LORE } from '../data/gen-zones.js';

export class HUD {
  constructor() {
    this.els = {
      hud: $('#hud'), levelNum: $('#level-num'), levelOrb: $('#level-orb'),
      name: $('#badge-name'), title: $('#badge-title'), xpFill: $('#xp-fill'),
      coins: $('#coins-amt'), clock: $('#clock-time'), zone: $('#zone-name'),
      zoneTag: $('#zone-tagline'), bait: $('#bait-name'), baitCount: $('#bait-count'),
      buffs: $('#active-buffs'), toasts: $('#toast-stack'),
      chatLog: $('#chat-log'), chatInput: $('#chat-input'),
      netPill: $('#net-pill'), netCount: $('#net-count'), netCode: $('#net-code'),
      dlg: $('#dialogue-box'), dlgName: $('#dialogue-name'), dlgText: $('#dialogue-text'),
      dlgOpts: $('#dialogue-options'), prompt: $('#interact-prompt'),
    };
    this.onChatSend = null;

    on('toast', (d) => this.toast(d.text, d.sub, d.kind));
    on('achievement', ({ ach }) => {
      this.toast(`🏆 Achievement: ${ach.name}`, ach.title ? `Claim it to earn the title "${ach.title.name}"` : 'Claim your reward in the Achievements window', 'achieve');
      this.chatLine(null, `You completed "${ach.name}"!`, 'system');
    });
    on('levelup', ({ level, abilities }) => {
      this.toast(`⬆️ Fishing level ${level}!`, abilities.map((a) => `Unlocked: ${a.name}`).join(' · ') || (level > 100 ? 'Your legend grows beyond mastery.' : ''), 'level');
      this.chatLine(null, 'Congratulations, you just advanced a Fishing level.', 'system');
      this.chatLine(null, `Your Fishing level is now ${level}.`, 'system');
    });
    on('xp', ({ amount }) => this.xpDrop(amount));
    on('catch', ({ fish, len, record }) => {
      if (rarityRank(fish.rarity) >= 2) {
        this.chatLine(null, `You caught ${aOrAn(fish.name)} ${fish.name}! (${len} cm${record ? ' — new record!' : ''})`, 'rare');
      }
    });

    this.els.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.els.chatInput.value.trim();
        this.els.chatInput.value = '';
        this.els.chatInput.blur();
        if (text) this.onChatSend?.(text);
      } else if (e.key === 'Escape') this.els.chatInput.blur();
    });
  }

  show() { this.els.hud.classList.remove('hidden'); }

  refresh(world, net) {
    const { level, into, need } = levelFromXp(S.xp);
    this.els.levelNum.textContent = level;
    this.els.levelOrb.classList.toggle('prestige', level > 100);
    this.els.name.textContent = S.name;
    this.els.title.textContent = S.title || '';
    this.els.xpFill.style.width = `${Math.min(100, (into / need) * 100)}%`;
    this.els.coins.textContent = fmtNum(S.coins);
    if (world) this.els.clock.textContent = world.clockLabel();
    const lore = ZONE_LORE[S.zone];
    this.els.zone.textContent = lore?.displayName || S.zone;
    this.els.zoneTag.textContent = lore?.tagline || '';
    const bait = getBaitDef();
    this.els.bait.textContent = bait ? bait.name : 'No bait';
    this.els.baitCount.textContent = bait ? (S.baits[bait.id] || 0) : 0;
    // buffs
    this.els.buffs.innerHTML = '';
    const now = Date.now();
    for (const p of activePotionDefs()) {
      const mins = Math.ceil((p.until - now) / 60000);
      this.els.buffs.append(el('div', { class: 'buff-chip', title: p.flavor || '' }, `🧪 ${p.name} ${mins}m`));
    }
    if (S.island.shrineBuff && S.island.shrineBuff.until > now) {
      const mins = Math.ceil((S.island.shrineBuff.until - now) / 60000);
      this.els.buffs.append(el('div', { class: 'buff-chip', style: 'background:rgba(63,143,139,.85)' }, `⛩️ ${S.island.shrineBuff.name} ${mins}m`));
    }
    // net pill
    if (net?.roomCode) {
      this.els.netPill.classList.remove('hidden');
      this.els.netCount.textContent = net.players.size + 1;
      this.els.netCode.textContent = net.roomCode;
    } else this.els.netPill.classList.add('hidden');
  }

  xpDrop(amount) {
    const box = $('#xp-drops');
    if (!box) return;
    const d = el('div', { class: 'xp-drop' }, `🎣 +${Math.floor(amount)} xp`);
    box.append(d);
    setTimeout(() => d.remove(), 1650);
    while (box.children.length > 5) box.firstChild.remove();
  }

  toast(text, sub = '', kind = '') {
    const t = el('div', { class: `toast toast-${kind}` }, el('div', {}, text));
    if (sub) t.append(el('div', { class: 'toast-sub' }, sub));
    this.els.toasts.append(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 3400);
    setTimeout(() => t.remove(), 3900);
    while (this.els.toasts.children.length > 4) this.els.toasts.firstChild.remove();
  }

  chatLine(from, text, kind = '') {
    const line = el('div', { class: `chat-line ${kind ? 'chat-' + kind : ''}` });
    if (from) {
      line.append(el('span', { class: 'chat-from' }, from + ': '));
      line.append(document.createTextNode(text));
    } else line.textContent = text;
    this.els.chatLog.append(line);
    while (this.els.chatLog.children.length > 60) this.els.chatLog.firstChild.remove();
    this.els.chatLog.scrollTop = this.els.chatLog.scrollHeight;
  }

  focusChat() { this.els.chatInput.focus(); }
  get chatFocused() { return document.activeElement === this.els.chatInput; }

  // ---------- dialogue ----------
  showDialogue(name, text, options, onPick) {
    this.els.dlg.classList.remove('hidden');
    this.els.dlgName.textContent = name;
    this.els.dlgText.textContent = text;
    this.els.dlgOpts.innerHTML = '';
    for (const opt of options) {
      this.els.dlgOpts.append(el('button', { class: 'btn btn-small', onclick: () => onPick(opt) }, opt.label));
    }
  }
  setDialogueText(text) { this.els.dlgText.textContent = text; }
  hideDialogue() { this.els.dlg.classList.add('hidden'); }
  get dialogueOpen() { return !this.els.dlg.classList.contains('hidden'); }

  showPrompt(text) {
    this.els.prompt.textContent = text;
    this.els.prompt.classList.remove('hidden');
  }
  hidePrompt() { this.els.prompt.classList.add('hidden'); }
}

function aOrAn(w) { return /^[aeiou]/i.test(w) ? 'an' : 'a'; }
