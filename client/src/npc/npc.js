// NPCs: spawning per map, wandering, ambient chatter, dialogue trees.
import { hash2, dist2d, randPick, clamp } from '../core/util.js';
import { makeHumanoid, attachLabel, showBubble } from '../player/player.js';
import { NPCS } from '../data/gen-npcs.js';

// anchor positions: shopkeepers stand by their shops, others get cozy spots around town
const SHOP_ANCHORS = {
  bait: { x: -60, z: 118 }, attachments: { x: 60, z: 122 }, potions: { x: -20, z: 176 },
  general: { x: -34, z: 46 }, rods: { x: 52, z: 118 },
};
const TOWN_SPOTS = [
  { x: 32, z: 80 }, { x: -40, z: 108 }, { x: 38, z: 148 }, { x: -52, z: 66 },
  { x: 78, z: 66 }, { x: 30, z: 192 }, { x: -84, z: 148 }, { x: 96, z: 134 },
  { x: 52, z: 36 }, { x: -38, z: 32 }, { x: 60, z: 176 }, { x: 118, z: 74 },
];
const ZONE_ANCHORS = { docks: { x: 474, z: 462 }, rig: { x: 6, z: 6 } };

export class NPCManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.npcs = [];
  }

  spawnForMap(mapId) {
    for (const n of this.npcs) this.scene.remove(n.rig);
    this.npcs = [];
    let townIdx = 0;
    for (const def of NPCS) {
      const inOverworld = def.zone === 'town' || def.zone === 'docks';
      if (mapId === 'overworld' ? !inOverworld : def.zone !== mapId) continue;
      let anchor;
      if (def.shop && SHOP_ANCHORS[def.shop]) anchor = SHOP_ANCHORS[def.shop];
      else if (def.banker) anchor = { x: 34, z: 52 };
      else if (def.broker) anchor = { x: 38, z: 68 };
      else if (ZONE_ANCHORS[def.zone]) anchor = ZONE_ANCHORS[def.zone];
      else anchor = TOWN_SPOTS[townIdx++ % TOWN_SPOTS.length];
      const rig = makeHumanoid(def.appearance || {});
      attachLabel(rig, def.name, def.role, '#ffe9a8');
      const y = this.world.surfaceYAt(anchor.x, anchor.z);
      rig.position.set(anchor.x, y, anchor.z);
      this.scene.add(rig);
      this.npcs.push({
        def, rig, anchor,
        x: anchor.x, z: anchor.z,
        tx: anchor.x, tz: anchor.z,
        idleT: 2 + hash2(anchor.x, anchor.z) * 5,
        chatterT: 20 + hash2(anchor.z, anchor.x) * 60,
        wanderR: def.shop || def.banker ? 5 : 14,
      });
    }
  }

  update(dt, t, player) {
    for (const n of this.npcs) {
      // wander
      n.idleT -= dt;
      const dx = n.tx - n.x, dz = n.tz - n.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.6) {
        const sp = 2.4;
        const nx = n.x + (dx / d) * sp * dt;
        const nz = n.z + (dz / d) * sp * dt;
        if (this.world.walkableAt(nx, nz)) { n.x = nx; n.z = nz; }
        else { n.tx = n.x; n.tz = n.z; }
        n.rig.userData.setAnim('walk');
        n.rig.rotation.y = Math.atan2(dx, dz);
      } else {
        n.rig.userData.setAnim('idle');
        if (n.idleT <= 0) {
          n.idleT = 3 + Math.random() * 8;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * n.wanderR;
          const tx = n.anchor.x + Math.cos(a) * r;
          const tz = n.anchor.z + Math.sin(a) * r;
          if (this.world.walkableAt(tx, tz)) { n.tx = tx; n.tz = tz; }
        }
      }
      n.rig.position.set(n.x, this.world.surfaceYAt(n.x, n.z), n.z);
      n.rig.userData.animate(t, dt);
      // ambient chatter when player is near
      n.chatterT -= dt;
      if (n.chatterT <= 0) {
        n.chatterT = 30 + Math.random() * 90;
        if (dist2d(n.x, n.z, player.x, player.z) < 26 && n.def.lines?.length) {
          showBubble(n.rig, randPick(n.def.lines));
        }
      }
      // face the player when close
      if (dist2d(n.x, n.z, player.x, player.z) < 5 && Math.hypot(n.tx - n.x, n.tz - n.z) < 1) {
        n.rig.rotation.y = Math.atan2(player.x - n.x, player.z - n.z);
      }
    }
  }

  nearest(x, z, maxDist = 4.5) {
    let best = null, bd = maxDist;
    for (const n of this.npcs) {
      const d = dist2d(n.x, n.z, x, z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  say(npc, text) { showBubble(npc.rig, text); }
}

// Build dialogue options for an NPC (consumed by UI layer)
export function npcOptions(def) {
  const opts = [];
  if (def.shop) opts.push({ label: '🛍️ Browse wares', act: { type: 'shop', shop: def.shop } });
  if (def.banker) opts.push({ label: '🏦 Open bank vault', act: { type: 'bank' } });
  if (def.broker) opts.push({ label: '🏝️ Discuss my island', act: { type: 'broker' } });
  if (def.zone === 'docks') opts.push({ label: '⛵ Ferry me somewhere', act: { type: 'ferry' } });
  const roleId = (def.id + ' ' + def.role).toLowerCase();
  if (roleId.includes('registrar') || roleId.includes('title')) opts.push({ label: '🏆 Review my deeds', act: { type: 'window', window: 'achievements' } });
  if (roleId.includes('professor') || roleId.includes('dex') || roleId.includes('scholar')) opts.push({ label: '📖 Talk fish facts', act: { type: 'window', window: 'dex' } });
  if (roleId.includes('legend') || roleId.includes('retired')) opts.push({ label: '🐋 Ask about the legends', act: { type: 'legends' } });
  opts.push({ label: '💬 Chat', act: { type: 'chat' } });
  opts.push({ label: '👋 Goodbye', act: { type: 'close' } });
  return opts;
}
