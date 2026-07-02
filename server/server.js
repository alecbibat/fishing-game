'use strict';
/*
 * Driftwood Isles — multiplayer lobby server.
 * Serves the client statically and runs the cozy lobby WebSocket protocol on /ws.
 * No dependencies besides `ws`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');

const MAX_ROOMS = 200;
const HEARTBEAT_MS = 25000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const RARE_TIERS = new Set(['rare', 'epic', 'legendary', 'mythic', 'transcendent']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {Map<string, Room>} code -> room */
const rooms = new Map();
/** @type {Set<Client>} */
const clients = new Set();

// Room shape:
// { code, settings:{name,visibility,maxPlayers,motd,announceRares,chatEnabled},
//   hostId, players: Map<id, Client>, bans: { ids:Set<string>, names:Set<string> } }

// Client shape:
// { ws, id, name, title, level, look, room, x,z,ry,zone,anim, muted,
//   posWindowStart, posCount, chatTimes[] }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId() {
  return crypto.randomBytes(6).toString('base64url');
}

function makeRoomCode() {
  for (let attempt = 0; attempt < 64; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function stripControl(s) {
  return String(s).replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

function sanStr(v, max, fallback = '') {
  if (typeof v !== 'string') return fallback;
  const s = stripControl(v).trim().slice(0, max);
  return s || fallback;
}

function sanLevel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(999999, Math.floor(n)));
}

function sanLook(v) {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const key of ['shirt', 'pants', 'hat', 'skin']) {
      if (typeof v[key] === 'string') out[key] = stripControl(v[key]).slice(0, 9);
    }
  }
  return out;
}

function clampMaxPlayers(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 8;
  return Math.max(2, Math.min(16, Math.floor(n)));
}

function applyProfile(client, profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  client.name = sanStr(p.name, 16, client.name || 'Angler');
  client.title = sanStr(p.title, 40, client.title || '');
  client.level = sanLevel(p.level != null ? p.level : client.level);
  client.look = sanLook(p.look);
}

function playerObj(client) {
  return {
    id: client.id,
    name: client.name,
    title: client.title,
    level: client.level,
    look: client.look,
    x: client.x, z: client.z, ry: client.ry,
    zone: client.zone, anim: client.anim,
    muted: client.muted,
  };
}

function send(client, obj) {
  if (client.ws.readyState === client.ws.OPEN) {
    try { client.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
  }
}

function sendError(client, code, msg) {
  send(client, { t: 'error', code, msg });
}

function broadcast(room, obj, exceptId = null) {
  const data = JSON.stringify(obj);
  for (const member of room.players.values()) {
    if (member.id === exceptId) continue;
    if (member.ws.readyState === member.ws.OPEN) {
      try { member.ws.send(data); } catch { /* ignore */ }
    }
  }
}

function playersInRooms() {
  let n = 0;
  for (const room of rooms.values()) n += room.players.size;
  return n;
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function joinRoom(room, client) {
  // Fresh in-world state on every join.
  client.x = 0; client.z = 0; client.ry = 0;
  client.zone = 'town'; client.anim = 'idle';
  client.muted = false;
  client.room = room;
  room.players.set(client.id, client);

  broadcast(room, { t: 'pjoin', player: playerObj(client) }, client.id);
  broadcast(room, { t: 'system', text: `${client.name} joined the lobby` }, client.id);

  send(client, {
    t: 'joined',
    code: room.code,
    selfId: client.id,
    isHost: room.hostId === client.id,
    settings: room.settings,
    players: [...room.players.values()].map(playerObj),
  });
  console.log(`[lobby ${room.code}] join: ${client.name} (${client.id}) — ${room.players.size}/${room.settings.maxPlayers}`);
}

function leaveRoom(client, { silent = false } = {}) {
  const room = client.room;
  if (!room) return;
  client.room = null;
  room.players.delete(client.id);
  console.log(`[lobby ${room.code}] leave: ${client.name} (${client.id}) — ${room.players.size} left`);

  if (room.players.size === 0) {
    rooms.delete(room.code);
    console.log(`[lobby ${room.code}] removed (empty)`);
    return;
  }

  broadcast(room, { t: 'pleave', id: client.id, name: client.name });
  if (!silent) broadcast(room, { t: 'system', text: `${client.name} left the lobby` });

  if (room.hostId === client.id) {
    // Oldest remaining member (Map preserves insertion order) becomes host.
    const newHost = room.players.values().next().value;
    room.hostId = newHost.id;
    broadcast(room, { t: 'host', id: newHost.id });
    broadcast(room, { t: 'system', text: `${newHost.name} is now the host` });
    console.log(`[lobby ${room.code}] host migrated to ${newHost.name} (${newHost.id})`);
  }
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleMessage(client, msg) {
  switch (msg.t) {
    case 'hello': {
      client.name = sanStr(msg.name, 16, 'Angler');
      send(client, { t: 'welcome', id: client.id });
      break;
    }

    case 'list': {
      const list = [];
      for (const room of rooms.values()) {
        if (room.settings.visibility !== 'public') continue;
        if (room.players.size >= room.settings.maxPlayers) continue;
        list.push({
          code: room.code,
          name: room.settings.name,
          players: room.players.size,
          maxPlayers: room.settings.maxPlayers,
          motd: room.settings.motd,
          hasHost: true,
        });
      }
      send(client, { t: 'lobbies', list });
      break;
    }

    case 'create': {
      if (rooms.size >= MAX_ROOMS) return sendError(client, 'server_full', 'Too many lobbies right now.');
      const code = makeRoomCode();
      if (!code) return sendError(client, 'server_full', 'Too many lobbies right now.');
      if (client.room) leaveRoom(client);

      const s = msg.settings && typeof msg.settings === 'object' ? msg.settings : {};
      applyProfile(client, msg.profile);
      const room = {
        code,
        settings: {
          name: sanStr(s.name, 40, `${client.name}'s Lobby`),
          visibility: s.visibility === 'private' ? 'private' : 'public',
          maxPlayers: clampMaxPlayers(s.maxPlayers),
          motd: sanStr(s.motd, 120, ''),
          announceRares: s.announceRares !== false,
          chatEnabled: s.chatEnabled !== false,
        },
        hostId: client.id,
        players: new Map(),
        bans: { ids: new Set(), names: new Set() },
      };
      rooms.set(code, room);
      console.log(`[lobby ${code}] created by ${client.name} (${client.id}) — "${room.settings.name}" (${room.settings.visibility})`);
      joinRoom(room, client);
      break;
    }

    case 'join': {
      const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      applyProfile(client, msg.profile);
      if (!room) return sendError(client, 'not_found', 'Lobby not found.');
      if (room.bans.ids.has(client.id) || room.bans.names.has(client.name.toLowerCase())) {
        return sendError(client, 'banned', 'You are banned from this lobby.');
      }
      if (room.players.size >= room.settings.maxPlayers) return sendError(client, 'full', 'Lobby is full.');
      if (client.room) leaveRoom(client);
      joinRoom(room, client);
      break;
    }

    case 'leave': {
      leaveRoom(client);
      break;
    }

    case 'pos': {
      const room = client.room;
      if (!room) return;
      // Rate limit: ignore beyond 20 msgs/sec.
      const now = Date.now();
      if (now - client.posWindowStart >= 1000) {
        client.posWindowStart = now;
        client.posCount = 0;
      }
      if (++client.posCount > 20) return;

      const { x, z, ry } = msg;
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(ry)) return;
      if (typeof msg.zone !== 'string' || msg.zone.length > 24) return;
      if (typeof msg.anim !== 'string' || msg.anim.length > 24) return;

      client.x = x; client.z = z; client.ry = ry;
      client.zone = msg.zone; client.anim = msg.anim;
      broadcast(room, { t: 'pos', id: client.id, x, z, ry, zone: msg.zone, anim: msg.anim }, client.id);
      break;
    }

    case 'chat': {
      const room = client.room;
      if (!room) return;
      if (!room.settings.chatEnabled) return sendError(client, 'chat_disabled', 'Chat is disabled in this lobby.');
      if (client.muted) return sendError(client, 'muted', 'You are muted.');

      const now = Date.now();
      client.chatTimes = client.chatTimes.filter((ts) => now - ts < 2000);
      if (client.chatTimes.length >= 3) return sendError(client, 'slow_down', 'Slow down a little.');
      client.chatTimes.push(now);

      const text = stripControl(String(msg.text != null ? msg.text : '')).trim().slice(0, 120);
      if (!text) return;
      broadcast(room, { t: 'chat', id: client.id, name: client.name, text }); // everyone incl. sender
      break;
    }

    case 'catch': {
      const room = client.room;
      if (!room || !room.settings.announceRares) return;
      const rarity = typeof msg.rarity === 'string' ? msg.rarity : '';
      if (!RARE_TIERS.has(rarity)) return;
      const fishName = sanStr(msg.name, 40, 'a fish');
      const len = Number.isFinite(Number(msg.len)) ? Number(msg.len) : 0;
      broadcast(room, { t: 'catch', id: client.id, name: client.name, fishName, rarity, len }, client.id);
      break;
    }

    case 'profile': {
      client.title = sanStr(msg.title, 40, client.title);
      client.level = sanLevel(msg.level != null ? msg.level : client.level);
      if (client.room) {
        broadcast(client.room, { t: 'profile', id: client.id, title: client.title, level: client.level }, client.id);
      }
      break;
    }

    case 'mod': {
      const room = client.room;
      if (!room) return;
      if (room.hostId !== client.id) return sendError(client, 'not_host', 'Only the host can do that.');
      const target = room.players.get(typeof msg.target === 'string' ? msg.target : '');
      if (!target || target.id === client.id) return;

      switch (msg.action) {
        case 'mute':
        case 'unmute': {
          target.muted = msg.action === 'mute';
          broadcast(room, { t: 'muted', id: target.id, muted: target.muted });
          break;
        }
        case 'kick': {
          send(target, { t: 'kicked', reason: 'Kicked by host' });
          leaveRoom(target, { silent: true });
          broadcast(room, { t: 'system', text: `${target.name} was kicked` });
          break;
        }
        case 'ban': {
          room.bans.ids.add(target.id);
          room.bans.names.add(target.name.toLowerCase());
          send(target, { t: 'kicked', reason: 'Banned by host' });
          leaveRoom(target, { silent: true });
          broadcast(room, { t: 'system', text: `${target.name} was banned` });
          break;
        }
      }
      break;
    }

    case 'settings': {
      const room = client.room;
      if (!room) return;
      if (room.hostId !== client.id) return sendError(client, 'not_host', 'Only the host can do that.');
      const p = msg.partial && typeof msg.partial === 'object' ? msg.partial : {};
      if ('motd' in p) room.settings.motd = sanStr(p.motd, 120, '');
      if ('announceRares' in p) room.settings.announceRares = !!p.announceRares;
      if ('chatEnabled' in p) room.settings.chatEnabled = !!p.chatEnabled;
      if ('maxPlayers' in p) room.settings.maxPlayers = clampMaxPlayers(p.maxPlayers);
      broadcast(room, { t: 'settings', settings: room.settings });
      break;
    }

    default:
      break; // unknown message type: ignore
  }
}

// ---------------------------------------------------------------------------
// HTTP server (static files + /health)
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    return res.end('Method Not Allowed');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('Bad Request');
  }

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: playersInRooms() }));
  }

  if (urlPath.endsWith('/')) urlPath += 'index.html';

  // Path traversal prevention: resolve inside CLIENT_DIR and verify prefix.
  const filePath = path.resolve(CLIENT_DIR, '.' + path.posix.normalize('/' + urlPath));
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const client = {
    ws,
    id: shortId(),
    name: 'Angler',
    title: '',
    level: 1,
    look: {},
    room: null,
    x: 0, z: 0, ry: 0,
    zone: 'town', anim: 'idle',
    muted: false,
    posWindowStart: 0,
    posCount: 0,
    chatTimes: [],
  };
  clients.add(client);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      if (typeof data !== 'string' && !Buffer.isBuffer(data)) return;
      if (data.length > 4096) return;
      const msg = JSON.parse(data.toString());
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      handleMessage(client, msg);
    } catch {
      // malformed JSON or handler error: ignore
    }
  });

  ws.on('close', () => {
    clients.delete(client);
    leaveRoom(client);
  });

  ws.on('error', () => { /* close will follow */ });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, HEARTBEAT_MS);

// ---------------------------------------------------------------------------
// Startup / shutdown
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`Driftwood Isles server listening on http://localhost:${PORT} (ws path /ws)`);
  console.log(`Serving static files from ${CLIENT_DIR}`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down…');
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'Server shutting down'); } catch { /* ignore */ }
  }
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  // Failsafe if sockets linger.
  setTimeout(() => process.exit(0), 2000).unref();
});
