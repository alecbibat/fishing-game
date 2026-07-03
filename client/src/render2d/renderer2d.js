// Canvas 2D renderer: chunk-cached tiles, y-sorted sprites & actors, water shimmer,
// fishing line/bobber, name labels, OSRS-yellow overhead chat, day tint.
import { getSprite, makeCharacterSheet, tileTexture, edgeOverlays } from './sprites.js';
import { hash2, RARITY_COLOR } from '../core/util.js';

export const TILE = 2;        // world units per tile
export const TILE_PX = 16;    // pixels per tile at zoom 1

const CHUNK = 24;             // tiles per chunk side

export class Renderer2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.zoom = 2;            // screen pixels per tile pixel
    this.chunks = new Map();  // key -> canvas
    this.chunkGen = 0;        // bumped on map switch to invalidate
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = innerWidth;
    this.canvas.height = innerHeight;
    this.ctx.imageSmoothingEnabled = false;
  }

  invalidate() {
    this.chunks.clear();
    this.chunkGen++;
  }

  // world → screen
  sx(x) { return Math.round((x - this.camX) * (TILE_PX / TILE) * this.zoom + this.canvas.width / 2); }
  sz(z) { return Math.round((z - this.camZ) * (TILE_PX / TILE) * this.zoom + this.canvas.height / 2); }
  // screen → world
  wx(px) { return (px - this.canvas.width / 2) / ((TILE_PX / TILE) * this.zoom) + this.camX; }
  wz(py) { return (py - this.canvas.height / 2) / ((TILE_PX / TILE) * this.zoom) + this.camZ; }

  chunkCanvas(world, ccx, ccz) {
    const key = `${this.chunkGen}:${ccx},${ccz}`;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = CHUNK * TILE_PX;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const { foam } = edgeOverlays();
    for (let tx = 0; tx < CHUNK; tx++) {
      for (let tz = 0; tz < CHUNK; tz++) {
        const wxx = (ccx * CHUNK + tx) * TILE + TILE / 2;
        const wzz = (ccz * CHUNK + tz) * TILE + TILE / 2;
        if (world.map.void && !world.map.inBounds(wxx, wzz)) {
          g.fillStyle = '#0a0c10';
          g.fillRect(tx * TILE_PX, tz * TILE_PX, TILE_PX, TILE_PX);
          continue;
        }
        const kind = world.tileKindAt(wxx, wzz);
        const variant = kind === 'grass' ? Math.floor(hash2(ccx * CHUNK + tx, ccz * CHUNK + tz, 4) * 3) : 0;
        g.drawImage(tileTexture(kind, variant), tx * TILE_PX, tz * TILE_PX);
        // foam edge where water meets land (drawn on the water tile)
        if (kind.startsWith('water')) {
          const dirs = [[0, -1, 0], [1, 0, 1], [0, 1, 2], [-1, 0, 3]];
          for (const [dx, dz, rot] of dirs) {
            const nk = world.tileKindAt(wxx + dx * TILE, wzz + dz * TILE);
            if (!nk.startsWith('water')) {
              g.save();
              g.translate(tx * TILE_PX + TILE_PX / 2, tz * TILE_PX + TILE_PX / 2);
              g.rotate((rot * Math.PI) / 2);
              g.drawImage(foam, -TILE_PX / 2, -TILE_PX / 2);
              g.restore();
            }
          }
        }
      }
    }
    this.chunks.set(key, c);
    if (this.chunks.size > 120) {
      const first = this.chunks.keys().next().value;
      this.chunks.delete(first);
    }
    return c;
  }

  render(world, actors, fx) {
    // fx: {bobber:{visible,x,z,dip}, lineFrom:{x,z}, t, hotspotsVisible}
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const t = fx.t || 0;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0c1014';
    ctx.fillRect(0, 0, W, H);

    const pxPerUnit = (TILE_PX / TILE) * this.zoom;
    const unitsW = W / pxPerUnit, unitsH = H / pxPerUnit;
    const x0 = this.camX - unitsW / 2, z0 = this.camZ - unitsH / 2;

    // tiles via chunks
    const chunkUnits = CHUNK * TILE;
    const c0x = Math.floor(x0 / chunkUnits), c1x = Math.floor((x0 + unitsW) / chunkUnits);
    const c0z = Math.floor(z0 / chunkUnits), c1z = Math.floor((z0 + unitsH) / chunkUnits);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const chunk = this.chunkCanvas(world, cx, cz);
        const px = this.sx(cx * chunkUnits);
        const py = this.sz(cz * chunkUnits);
        ctx.drawImage(chunk, px, py, Math.ceil(CHUNK * TILE_PX * this.zoom), Math.ceil(CHUNK * TILE_PX * this.zoom));
      }
    }

    // water shimmer: sparse animated light dashes
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    const step = TILE * 3;
    for (let x = Math.floor(x0 / step) * step; x < x0 + unitsW; x += step) {
      for (let z = Math.floor(z0 / step) * step; z < z0 + unitsH; z += step) {
        const h = hash2(Math.round(x / step), Math.round(z / step), 8);
        if (h < 0.35) continue;
        if (!world.tileKindAt(x, z).startsWith('water')) continue;
        const phase = (t * 0.6 + h * 7) % 1;
        if (phase > 0.5) continue;
        const px = this.sx(x + Math.sin(h * 20) * 1.5), py = this.sz(z + phase * 2);
        ctx.fillRect(px, py, Math.round(3 * this.zoom), Math.max(1, Math.round(this.zoom * 0.7)));
      }
    }

    // hotspots (animated bubbles)
    for (const hs of world.hotspots) {
      const frame = Math.floor(t * 3) % 2;
      const s = getSprite(frame ? 'hotspot_1' : 'hotspot', 0);
      this.blit(s, hs.x, hs.z, true);
      ctx.strokeStyle = 'rgba(190,240,235,0.5)';
      ctx.lineWidth = Math.max(1, this.zoom);
      ctx.beginPath();
      ctx.ellipse(this.sx(hs.x), this.sz(hs.z), hs.r * pxPerUnit, hs.r * pxPerUnit * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // collect drawables (statics + actors) and y-sort
    const drawables = [];
    for (const s of world.spritesNear(this.camX, this.camZ, Math.max(unitsW, unitsH) / 2 + 40)) {
      if (s.x < x0 - 20 || s.x > x0 + unitsW + 20 || s.z < z0 - 20 || s.z > z0 + unitsH + 20) continue;
      drawables.push({ y: s.z, kind: 'sprite', s });
    }
    for (const a of actors) {
      if (!a.visible) continue;
      drawables.push({ y: a.position.z, kind: 'actor', a });
    }
    drawables.sort((p, q) => p.y - q.y);

    for (const d of drawables) {
      if (d.kind === 'sprite') {
        let name = d.s.name;
        // animated statics
        if (name === 'campfire') name = Math.floor(t * 5) % 2 ? 'campfire_1' : 'campfire';
        if (name === 'fountain') name = Math.floor(t * 3) % 2 ? 'fountain_1' : 'fountain';
        this.blit(getSprite(name, d.s.seed || 0), d.s.x, d.s.z);
      } else {
        this.drawActor(d.a, t);
      }
    }

    // fishing line + bobber
    if (fx.bobber?.visible) {
      const b = fx.bobber;
      ctx.strokeStyle = 'rgba(240,238,225,0.9)';
      ctx.lineWidth = Math.max(1, Math.round(this.zoom * 0.6));
      ctx.beginPath();
      ctx.moveTo(this.sx(fx.lineFrom.x), this.sz(fx.lineFrom.z) - 14 * this.zoom);
      const mx = (fx.lineFrom.x + b.x) / 2, mz = (fx.lineFrom.z + b.z) / 2;
      ctx.quadraticCurveTo(this.sx(mx), this.sz(mz) - 4 * this.zoom, this.sx(b.x), this.sz(b.z) - (b.dip || 0) * this.zoom);
      ctx.stroke();
      this.blit(getSprite('ripple', 0), b.x, b.z + 0.4, true);
      const bs = getSprite('bobber', 0);
      const px = this.sx(b.x) - (bs.w / 2) * this.zoom;
      const py = this.sz(b.z) - (bs.h / 2 + (b.dip || 0)) * this.zoom;
      ctx.drawImage(bs.canvas, px, py, bs.w * this.zoom, bs.h * this.zoom);
    }

    // labels + overhead chat (after everything, unclipped)
    for (const a of actors) {
      if (!a.visible) continue;
      this.drawActorText(a, t);
    }

    // day/mood tint
    const tint = world.dayTint();
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
      // warm lamp glows at night in the overworld
      if (world.mapId === 'overworld' && world.timeKey() === 'night') {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const s of world.spritesNear(this.camX, this.camZ, Math.max(unitsW, unitsH) / 2 + 20)) {
          if (s.name !== 'lamp' && s.name !== 'campfire') continue;
          const g = ctx.createRadialGradient(this.sx(s.x), this.sz(s.z) - 14 * this.zoom, 2, this.sx(s.x), this.sz(s.z) - 14 * this.zoom, 60 * this.zoom);
          g.addColorStop(0, 'rgba(255,190,90,0.35)');
          g.addColorStop(1, 'rgba(255,190,90,0)');
          ctx.fillStyle = g;
          ctx.fillRect(this.sx(s.x) - 60 * this.zoom, this.sz(s.z) - 74 * this.zoom, 120 * this.zoom, 120 * this.zoom);
        }
        ctx.restore();
      }
    }
  }

  blit(sprite, x, z, center = false) {
    const px = this.sx(x) - sprite.ax * this.zoom;
    const py = this.sz(z) - (center ? sprite.h / 2 : sprite.ay) * this.zoom;
    this.ctx.drawImage(sprite.canvas, px, py, sprite.w * this.zoom, sprite.h * this.zoom);
  }

  drawActor(a, t) {
    if (!a.sheet) a.sheet = makeCharacterSheet(a.look || {});
    const sh = a.sheet;
    const dirRow = { down: 0, left: 1, right: 2, up: 3 }[a.dir || 'down'];
    let col = 0;
    if (a.anim === 'walk') col = 1 + (Math.floor(t * 7 + (a.phase || 0)) % 2);
    else if (a.anim === 'fish') col = 3;
    const px = this.sx(a.position.x) - sh.ax * this.zoom;
    const py = this.sz(a.position.z) - sh.ay * this.zoom;
    // soft shadow
    this.ctx.fillStyle = 'rgba(0,0,0,0.22)';
    this.ctx.beginPath();
    this.ctx.ellipse(this.sx(a.position.x), this.sz(a.position.z), 6 * this.zoom, 2.4 * this.zoom, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.drawImage(sh.canvas, col * sh.fw, dirRow * sh.fh, sh.fw, sh.fh, px, py, sh.fw * this.zoom, sh.fh * this.zoom);
  }

  drawActorText(a, t) {
    const ctx = this.ctx;
    const cx = this.sx(a.position.x);
    let topY = this.sz(a.position.z) - (a.sheet ? a.sheet.ay + 4 : 30) * this.zoom;
    ctx.textAlign = 'center';
    if (a.labelName) {
      ctx.font = `bold ${Math.round(5.5 * this.zoom)}px Verdana, sans-serif`;
      ctx.lineWidth = Math.max(2, this.zoom);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(a.labelName, cx, topY);
      ctx.fillStyle = a.labelColor || '#ffffff';
      ctx.fillText(a.labelName, cx, topY);
      if (a.labelTitle) {
        ctx.font = `${Math.round(4.5 * this.zoom)}px Verdana, sans-serif`;
        ctx.strokeText(a.labelTitle, cx, topY + 5.4 * this.zoom);
        ctx.fillStyle = '#ffcf6a';
        ctx.fillText(a.labelTitle, cx, topY + 5.4 * this.zoom);
        topY += 0;
      }
      topY -= 7 * this.zoom;
    }
    if (a.bubble && a.bubble.until > performance.now()) {
      ctx.font = `bold ${Math.round(6 * this.zoom)}px Verdana, sans-serif`;
      const lines = wrapText(ctx, a.bubble.text, 150 * this.zoom);
      for (let i = lines.length - 1; i >= 0; i--) {
        const y = topY - (lines.length - 1 - i) * 7 * this.zoom;
        ctx.lineWidth = Math.max(2, this.zoom);
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(lines[i], cx, y);
        ctx.fillStyle = '#ffff00';
        ctx.fillText(lines[i], cx, y);
      }
    } else if (a.bubble) a.bubble = null;
  }
}

function wrapText(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(-3);
}
