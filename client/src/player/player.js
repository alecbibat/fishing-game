// Player controller + input for the 2D world. Re-exports the actor API so
// npc/main keep importing from here.
import { clamp, lerp } from '../core/util.js';
import { makeHumanoid, attachLabel, showBubble } from '../render2d/actors.js';

export { makeHumanoid, attachLabel, showBubble };

export class Player {
  constructor(stage, world, look) {
    this.world = world;
    this.rig = makeHumanoid(look);
    stage.add(this.rig);
    this.x = 35; this.z = 94; this.y = 0;
    this.ry = 0;             // facing
    this.speed = 0;
    this.frozen = false;     // true while fishing minigame active
    this.walkTarget = null;  // right-click "Walk here"
    this.keys = {};
    this.zoom = 2;           // renderer pixel zoom
  }

  place(x, z) {
    this.x = x; this.z = z;
    this.rig.position.set(this.x, 0, this.z);
  }

  update(dt, input) {
    const k = input.keys;
    let mx = 0, mz = 0;
    if (!this.frozen && !input.typing) {
      // top-down: W = up-screen = north = -z
      if (k['KeyW'] || k['ArrowUp']) mz -= 1;
      if (k['KeyS'] || k['ArrowDown']) mz += 1;
      if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
      if (k['KeyD'] || k['ArrowRight']) mx += 1;
    }
    let moving = (mx !== 0 || mz !== 0);
    if (moving) this.walkTarget = null;
    // right-click walk-to
    let walkAng = null;
    if (!moving && this.walkTarget && !this.frozen) {
      const dx = this.walkTarget.x - this.x, dz = this.walkTarget.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) this.walkTarget = null;
      else { walkAng = Math.atan2(dx, dz); moving = true; }
    }
    const run = k['ShiftLeft'] || k['ShiftRight'];
    const targetSpeed = moving ? (run ? 15 : 9) : 0;
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 8, 0, 1));
    if (moving) {
      const ang = walkAng !== null ? walkAng : Math.atan2(mx, mz);
      const nx = this.x + Math.sin(ang) * this.speed * dt;
      const nz = this.z + Math.cos(ang) * this.speed * dt;
      // slide along blocked axes
      if (this.world.walkableAt(nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.world.walkableAt(nx, this.z)) { this.x = nx; if (walkAng !== null) this.walkTarget = null; }
      else if (this.world.walkableAt(this.x, nz)) { this.z = nz; if (walkAng !== null) this.walkTarget = null; }
      else if (walkAng !== null) this.walkTarget = null;
      this.ry = ang;
      this.rig.userData.setAnim('walk');
    } else if (!this.frozen) {
      this.rig.userData.setAnim(this.rig.userData.getAnim() === 'fish' ? 'fish' : 'idle');
    }
    this.rig.position.set(this.x, 0, this.z);
    this.rig.rotation.y = this.ry;
    this.rig.userData.animate(performance.now() / 1000, dt);
  }

  facingPoint(dist) {
    return { x: this.x + Math.sin(this.ry) * dist, z: this.z + Math.cos(this.ry) * dist };
  }
}

// ---------- input collector ----------
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.typing = false;
    this.pointerDown = false;
    this.justClicked = false;
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this._downAt = 0;
    this.onKey = null; // (code, isDown)

    window.addEventListener('keydown', (e) => {
      if (this.typing) return;
      this.keys[e.code] = true;
      this.onKey?.(e.code, true, e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.onKey?.(e.code, false, e);
    });
    window.addEventListener('blur', () => { this.keys = {}; this.pointerDown = false; });

    let sx = 0, sy = 0, movedTotal = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // right-click is the Choose Option menu
      this.pointerDown = true;
      this._downAt = performance.now();
      sx = e.clientX; sy = e.clientY; movedTotal = 0;
      this.lastX = e.clientX; this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      this.lastX = e.clientX; this.lastY = e.clientY;
      if (!this.pointerDown) return;
      movedTotal += Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy);
      sx = e.clientX; sy = e.clientY;
      if (movedTotal > 8) this.dragging = true;
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      this.pointerDown = false;
      this.lastX = e.clientX; this.lastY = e.clientY;
      const wasDrag = this.dragging;
      this.dragging = false;
      if (!wasDrag && performance.now() - this._downAt < 400) this.justClicked = true;
      this.onPointerUp?.(wasDrag, e.clientX, e.clientY);
    });
    canvas.addEventListener('wheel', (e) => { this.onWheel?.(e.deltaY); }, { passive: true });
  }
  consumeClick() {
    const c = this.justClicked;
    this.justClicked = false;
    return c;
  }
}
