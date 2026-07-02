/*
 * Driftwood Isles — client networking module.
 * Plain browser ES module. Talks the lobby JSON protocol over a WebSocket at /ws.
 *
 * Usage:
 *   import { net } from './src/net/net.js';
 *   await net.connect();
 *   const lobbies = await net.listLobbies();
 *   await net.joinLobby('ABC234');
 */

const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;
const POS_THROTTLE_MS = 100;
const POS_EPSILON = 1e-3;

export class Net {
  constructor() {
    /** @type {WebSocket|null} */
    this._ws = null;
    this.connected = false;
    this.selfId = null;

    // Room state
    this.roomCode = null;
    this.isHost = false;
    this.settings = null;
    /** @type {Map<string, object>} id -> playerObj, EXCLUDING self */
    this.players = new Map();

    // Profile used for create/join and hello
    this.profile = { name: 'Angler', title: '', level: 1, look: {} };

    // Event handlers: event name -> Set<fn>
    this._handlers = new Map();

    // Pending request bookkeeping
    this._welcomeWaiter = null;          // {resolve}
    this._listWaiters = [];              // [{resolve, reject, timer}]
    this._joinWaiter = null;             // {resolve, reject, timer}
    this._intentionalClose = false;

    // Pos throttle
    this._lastPosTime = 0;
    this._lastPos = null;
  }

  // ---- events -------------------------------------------------------------

  /**
   * Register a handler. Events: 'players', 'pos', 'chat', 'system', 'catch',
   * 'kicked', 'muted', 'settings', 'host', 'disconnect'.
   * @returns {() => void} unsubscribe function
   */
  on(event, fn) {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  _emit(event, payload) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error('[net] handler error for', event, e); }
    }
  }

  // ---- connection ---------------------------------------------------------

  /**
   * Connect and say hello. Resolves after the server's 'welcome'.
   */
  connect(url) {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const target = url ||
        (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '/ws';

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._welcomeWaiter = null;
        reject(err);
      };
      const timer = setTimeout(() => {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        fail(new Error('Connection timed out'));
      }, CONNECT_TIMEOUT_MS);

      let ws;
      try {
        ws = new WebSocket(target);
      } catch (e) {
        return fail(e);
      }
      this._ws = ws;
      this._intentionalClose = false;

      this._welcomeWaiter = {
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this._welcomeWaiter = null;
          resolve();
        },
      };

      ws.onopen = () => {
        this._send({ t: 'hello', name: this.profile.name });
      };
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onerror = () => { /* onclose follows */ };
      ws.onclose = () => {
        fail(new Error('Connection failed'));
        this._handleClose();
      };
    });
  }

  disconnect() {
    this._intentionalClose = true;
    const ws = this._ws;
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
    }
    this._clearRoomState();
    this.connected = false;
    this._ws = null;
  }

  _handleClose() {
    const wasInRoom = this.roomCode !== null;
    const wasIntentional = this._intentionalClose;
    this.connected = false;
    this._ws = null;
    this._clearRoomState();
    // Flush pending requests so callers don't hang.
    if (this._joinWaiter) {
      const w = this._joinWaiter;
      this._joinWaiter = null;
      clearTimeout(w.timer);
      w.reject(new Error('Disconnected'));
    }
    for (const w of this._listWaiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new Error('Disconnected'));
    }
    if (wasInRoom && !wasIntentional) this._emit('disconnect', undefined);
  }

  _clearRoomState() {
    this.roomCode = null;
    this.isHost = false;
    this.settings = null;
    this.players.clear();
    this._lastPos = null;
  }

  _send(obj) {
    const ws = this._ws;
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- profile ------------------------------------------------------------

  setProfile({ name, title, level, look } = {}) {
    const prev = this.profile;
    const changed =
      (title !== undefined && title !== prev.title) ||
      (level !== undefined && level !== prev.level);
    this.profile = {
      name: name !== undefined ? name : prev.name,
      title: title !== undefined ? title : prev.title,
      level: level !== undefined ? level : prev.level,
      look: look !== undefined ? look : prev.look,
    };
    if (changed && this.connected && this.roomCode) {
      this._send({ t: 'profile', title: this.profile.title, level: this.profile.level });
    }
  }

  // ---- lobby requests -----------------------------------------------------

  /** @returns {Promise<Array>} resolves with the lobby list */
  listLobbies() {
    return new Promise((resolve, reject) => {
      if (!this._send({ t: 'list' })) return reject(new Error('Not connected'));
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const i = this._listWaiters.indexOf(waiter);
        if (i !== -1) this._listWaiters.splice(i, 1);
        reject(new Error('Lobby list timed out'));
      }, REQUEST_TIMEOUT_MS);
      this._listWaiters.push(waiter);
    });
  }

  /** @returns {Promise<object>} resolves with the 'joined' payload */
  createLobby(settings) {
    return this._joinRequest({ t: 'create', settings, profile: this.profile });
  }

  /** @returns {Promise<object>} resolves with the 'joined' payload */
  joinLobby(code) {
    return this._joinRequest({ t: 'join', code, profile: this.profile });
  }

  _joinRequest(msg) {
    return new Promise((resolve, reject) => {
      if (this._joinWaiter) return reject(new Error('Another join is in progress'));
      if (!this._send(msg)) return reject(new Error('Not connected'));
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        if (this._joinWaiter === waiter) {
          this._joinWaiter = null;
          reject(new Error('Request timed out'));
        }
      }, REQUEST_TIMEOUT_MS);
      this._joinWaiter = waiter;
    });
  }

  leave() {
    if (this.roomCode) this._send({ t: 'leave' });
    this._clearRoomState();
    this._emit('players', this.players);
  }

  // ---- gameplay sends -----------------------------------------------------

  sendPos(x, z, ry, zone, anim) {
    if (!this.connected || !this.roomCode) return;
    const now = Date.now();
    if (now - this._lastPosTime < POS_THROTTLE_MS) return;
    const lp = this._lastPos;
    if (lp &&
        Math.abs(lp.x - x) < POS_EPSILON &&
        Math.abs(lp.z - z) < POS_EPSILON &&
        Math.abs(lp.ry - ry) < POS_EPSILON &&
        lp.zone === zone && lp.anim === anim) {
      return;
    }
    this._lastPosTime = now;
    this._lastPos = { x, z, ry, zone, anim };
    this._send({ t: 'pos', x, z, ry, zone, anim });
  }

  sendChat(text) {
    this._send({ t: 'chat', text });
  }

  sendCatch({ fishId, name, rarity, len } = {}) {
    this._send({ t: 'catch', fishId, name, rarity, len });
  }

  mod(action, targetId) {
    this._send({ t: 'mod', action, target: targetId });
  }

  updateSettings(partial) {
    this._send({ t: 'settings', partial });
  }

  // ---- incoming -----------------------------------------------------------

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'welcome': {
        this.selfId = msg.id;
        this.connected = true;
        if (this._welcomeWaiter) this._welcomeWaiter.resolve();
        break;
      }

      case 'lobbies': {
        const waiters = this._listWaiters.splice(0);
        for (const w of waiters) {
          clearTimeout(w.timer);
          w.resolve(msg.list || []);
        }
        break;
      }

      case 'joined': {
        this.roomCode = msg.code;
        this.selfId = msg.selfId;
        this.isHost = !!msg.isHost;
        this.settings = msg.settings || null;
        this.players.clear();
        for (const p of msg.players || []) {
          if (p.id !== this.selfId) this.players.set(p.id, p);
        }
        this._emit('players', this.players);
        if (this._joinWaiter) {
          const w = this._joinWaiter;
          this._joinWaiter = null;
          clearTimeout(w.timer);
          w.resolve(msg);
        }
        break;
      }

      case 'error': {
        if (this._joinWaiter) {
          const w = this._joinWaiter;
          this._joinWaiter = null;
          clearTimeout(w.timer);
          w.reject(new Error(msg.msg || msg.code || 'error'));
        } else if (msg.msg) {
          this._emit('system', msg.msg);
        }
        break;
      }

      case 'pjoin': {
        const p = msg.player;
        if (p && p.id && p.id !== this.selfId) {
          this.players.set(p.id, p);
          this._emit('players', this.players);
        }
        break;
      }

      case 'pleave': {
        if (this.players.delete(msg.id)) this._emit('players', this.players);
        break;
      }

      case 'pos': {
        const p = this.players.get(msg.id);
        if (p) {
          p.x = msg.x; p.z = msg.z; p.ry = msg.ry;
          p.zone = msg.zone; p.anim = msg.anim;
        }
        this._emit('pos', { id: msg.id, x: msg.x, z: msg.z, ry: msg.ry, zone: msg.zone, anim: msg.anim });
        break;
      }

      case 'chat': {
        this._emit('chat', { id: msg.id, name: msg.name, text: msg.text, self: msg.id === this.selfId });
        break;
      }

      case 'system': {
        this._emit('system', msg.text);
        break;
      }

      case 'catch': {
        this._emit('catch', { id: msg.id, name: msg.name, fishName: msg.fishName, rarity: msg.rarity, len: msg.len });
        break;
      }

      case 'kicked': {
        this._clearRoomState();
        this._emit('players', this.players);
        this._emit('kicked', msg.reason);
        break;
      }

      case 'muted': {
        const self = msg.id === this.selfId;
        const p = this.players.get(msg.id);
        if (p) {
          p.muted = !!msg.muted;
          this._emit('players', this.players);
        }
        this._emit('muted', { id: msg.id, muted: !!msg.muted, self });
        break;
      }

      case 'profile': {
        const p = this.players.get(msg.id);
        if (p) {
          p.title = msg.title;
          p.level = msg.level;
          this._emit('players', this.players);
        }
        break;
      }

      case 'settings': {
        this.settings = msg.settings || this.settings;
        this._emit('settings', this.settings);
        break;
      }

      case 'host': {
        const self = msg.id === this.selfId;
        this.isHost = self;
        this._emit('host', { id: msg.id, self });
        break;
      }

      default:
        break;
    }
  }
}

export const net = new Net();
