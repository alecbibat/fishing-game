// OSRS-style circular minimap: prerendered terrain, rotates with the camera, compass, dots.
import { HALF } from '../world/world.js';

const VIEW_UNITS = 130;   // world units across the minimap
const SIZE = 152;

function terrainColor(g, w, biome) {
  if (g < w - 5) return '#28506e';
  if (g < w - 1.2) return '#336282';
  if (g < w - 0.15) return '#417598';
  if (g < w + 1.4) return '#b3a071';       // sand/shore
  if (g > 46) return '#e8ecee';            // snow
  if (g > 27) return '#7d7d75';            // rock
  switch (biome) {
    case 'swamp': return '#5d7048';
    case 'volcanic': return '#8a5a42';
    case 'harbor': return '#9a927e';       // town paths
    case 'sewer': return '#5a5148';
    case 'cave': return '#57503f';
    case 'rig': return '#6b7075';
    case 'abyss': return '#141c26';
    default: return '#597d3c';             // grass
  }
}

export class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas?.getContext('2d');
    this.compass = document.getElementById('compass');
    this.mapImg = null;      // offscreen canvas of current map
    this.mapMeta = null;     // {minX, minZ, span, res}
    this.building = false;
  }

  // Prerender the current map's terrain to an offscreen canvas (chunked to avoid jank).
  rebuild(world) {
    const isOver = world.mapId === 'overworld';
    const span = isOver ? HALF * 2 : 260;
    const minX = -span / 2, minZ = -span / 2;
    const res = isOver ? 512 : 192;
    const off = document.createElement('canvas');
    off.width = res; off.height = res;
    const g = off.getContext('2d');
    g.fillStyle = '#10202a';
    g.fillRect(0, 0, res, res);
    this.mapImg = off;
    this.mapMeta = { minX, minZ, span, res };
    this.building = true;
    const map = world.map;
    let row = 0;
    const step = span / res;
    const paintRows = () => {
      if (world.map !== map) return; // map changed mid-build
      const rows = isOver ? 24 : 64;
      for (let r = 0; r < rows && row < res; r++, row++) {
        const z = minZ + row * step;
        for (let i = 0; i < res; i++) {
          const x = minX + i * step;
          if (!map.inBounds(x, z) && !isOver) continue;
          const gr = map.ground(x, z);
          const w = map.water(x, z);
          g.fillStyle = terrainColor(gr, w, map.biome(x, z));
          g.fillRect(i, row, 1, 1);
        }
      }
      if (row < res) setTimeout(paintRows, 0);
      else this.building = false;
    };
    paintRows();
  }

  update(world, player, npcs, remotes) {
    const ctx = this.ctx;
    if (!ctx || !this.mapImg) return;
    const { minX, minZ, span, res } = this.mapMeta;
    ctx.save();
    ctx.fillStyle = '#10202a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // rotate with camera: up = camera forward
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(player.camYaw + Math.PI);
    const scale = SIZE / VIEW_UNITS;          // px per world unit
    const imgScale = (span / res);            // units per img px
    ctx.imageSmoothingEnabled = false;
    // draw terrain around player
    const px = (player.x - minX) / imgScale;  // player pos in img px
    const pz = (player.z - minZ) / imgScale;
    const viewImgPx = VIEW_UNITS / imgScale;  // img px across the view
    ctx.drawImage(this.mapImg,
      px - viewImgPx / 2, pz - viewImgPx / 2, viewImgPx, viewImgPx,
      -SIZE / 2, -SIZE / 2, SIZE, SIZE);
    // dots
    const dot = (x, z, color, r = 2.5) => {
      const dx = (x - player.x) * scale, dz = (z - player.z) * scale;
      if (dx * dx + dz * dz > (SIZE / 2 - 6) ** 2) return;
      ctx.fillStyle = color;
      ctx.fillRect(dx - r, dz - r, r * 2, r * 2);
    };
    for (const n of npcs.npcs) dot(n.x, n.z, '#ffff00');
    if (remotes) for (const [, rp] of remotes) { if (rp.rig.visible) dot(rp.rig.position.x, rp.rig.position.z, '#ffffff'); }
    for (const h of world.hotspots) dot(h.x, h.z, '#00ffff', 3);
    for (const it of world.interactables()) {
      if (it.portalSpot) dot(it.x, it.z, it.action?.type === 'map' ? '#46e0d0' : '#7d7d75', 2);
      else dot(it.x, it.z, '#ff3325', 2);
    }
    ctx.restore();
    // player marker (always center, unrotated)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(SIZE / 2 - 2.5, SIZE / 2 - 2.5, 5, 5);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(SIZE / 2 - 2.5, SIZE / 2 - 2.5, 5, 5);
    // compass rotates around the rim
    if (this.compass) {
      const a = player.camYaw + Math.PI;      // map rotation
      const r = 70;
      const cx = Math.sin(a) * r, cy = -Math.cos(a) * r;
      this.compass.style.left = '0';
      this.compass.style.top = '0';
      this.compass.style.transform = `translate(${84 + cx - 13}px, ${84 + cy - 13}px)`;
    }
  }
}
