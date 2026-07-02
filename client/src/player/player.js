// Player avatar, humanoid rig (shared by NPCs and remote players), controls, camera.
import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../core/util.js';
import { mat } from '../world/prims.js';
import { makeTextSprite } from '../world/prims.js';

// ---------- humanoid rig ----------
export function makeHumanoid(look = {}) {
  const { shirt = '#d9663f', pants = '#3f5d8a', hat = '#7a5230', skin = '#f0c49a', hair = '#5d4430' } = look;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 0.5), mat(shirt));
  body.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 7), mat(skin));
  head.position.y = 2.05;
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.44, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2.6), mat(hair));
  hairM.position.y = 2.12;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.34), mat(pants));
  legL.position.set(-0.22, 0.35, 0);
  const legR = legL.clone(); legR.position.x = 0.22;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.28), mat(shirt));
  armL.position.set(-0.56, 1.2, 0);
  const armR = armL.clone(); armR.position.x = 0.56;
  g.add(body, head, hairM, legL, legR, armL, armR);
  let hatG = null;
  if (hat) {
    hatG = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.07, 10), mat(hat));
    const topM = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.35, 9), mat(hat));
    topM.position.y = 0.2;
    hatG.add(brim, topM);
    hatG.position.y = 2.42;
    g.add(hatG);
  }
  // simple face
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), mat('#2a2a2a'));
  eyeL.position.set(-0.14, 2.1, 0.38);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.14;
  g.add(eyeL, eyeR);
  // fishing rod (hidden unless fishing/held)
  const rod = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.6, 5), mat('#8a6642'));
  pole.position.y = 1.3;
  rod.add(pole);
  rod.position.set(0.62, 1.1, 0.25);
  rod.rotation.x = -0.9;
  rod.visible = false;
  g.add(rod);

  let anim = 'idle';
  let phase = Math.random() * 10;
  g.userData.setAnim = (a) => { anim = a; };
  g.userData.getAnim = () => anim;
  g.userData.rod = rod;
  g.userData.animate = (t, dt) => {
    phase += dt * (anim === 'walk' ? 9 : 2);
    if (anim === 'walk') {
      legL.rotation.x = Math.sin(phase) * 0.7;
      legR.rotation.x = -Math.sin(phase) * 0.7;
      armL.rotation.x = -Math.sin(phase) * 0.5;
      armR.rotation.x = rod.visible ? -0.9 : Math.sin(phase) * 0.5;
      body.position.y = 1.15 + Math.abs(Math.sin(phase)) * 0.05;
    } else if (anim === 'fish') {
      legL.rotation.x = legR.rotation.x = 0;
      armR.rotation.x = -1.1;
      armL.rotation.x = -0.25;
      body.position.y = 1.15;
    } else {
      legL.rotation.x = legR.rotation.x = 0;
      armL.rotation.x = Math.sin(phase * 0.5) * 0.06;
      armR.rotation.x = rod.visible ? -0.9 : Math.sin(phase * 0.5 + 1) * 0.06;
      body.position.y = 1.15 + Math.sin(phase * 0.8) * 0.02;
    }
    rod.rotation.x = anim === 'fish' ? -0.55 : -0.9;
  };
  return g;
}

// ---------- overhead labels ----------
export function attachLabel(group, name, title = null, color = '#ffffff') {
  if (group.userData.labelSprite) group.remove(group.userData.labelSprite);
  const text = title ? `${name}\n${title}` : name;
  const sprite = makeTextSprite(title ? `${name} · ${title}` : name, { color, scale: 0.85 });
  sprite.position.y = 3.05;
  group.add(sprite);
  group.userData.labelSprite = sprite;
}
export function showBubble(group, text) {
  if (group.userData.bubble) { group.remove(group.userData.bubble); clearTimeout(group.userData.bubbleTimer); }
  const sprite = makeTextSprite(text, { color: '#2a2418', bg: 'rgba(253,246,227,.95)', outline: null, scale: 0.9 });
  sprite.position.y = 3.9;
  group.add(sprite);
  group.userData.bubble = sprite;
  group.userData.bubbleTimer = setTimeout(() => {
    group.remove(sprite);
    group.userData.bubble = null;
  }, 4500 + Math.min(4000, text.length * 60));
}

// ---------- player controller ----------
export class Player {
  constructor(scene, world, look) {
    this.world = world;
    this.rig = makeHumanoid(look);
    scene.add(this.rig);
    this.x = 0; this.z = 60; this.y = 0;
    this.ry = 0;             // facing
    this.speed = 0;
    this.frozen = false;     // true while fishing minigame active
    this.keys = {};
    // camera orbit
    this.camYaw = 0;
    this.camPitch = 0.45;
    this.camDist = 16;
  }

  place(x, z) {
    this.x = x; this.z = z;
    this.y = this.world.surfaceYAt(x, z);
    this.rig.position.set(this.x, this.y, this.z);
  }

  update(dt, input) {
    const k = input.keys;
    let mx = 0, mz = 0;
    if (!this.frozen && !input.typing) {
      if (k['KeyW'] || k['ArrowUp']) mz -= 1;
      if (k['KeyS'] || k['ArrowDown']) mz += 1;
      if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
      if (k['KeyD'] || k['ArrowRight']) mx += 1;
    }
    const moving = (mx !== 0 || mz !== 0);
    const run = k['ShiftLeft'] || k['ShiftRight'];
    const targetSpeed = moving ? (run ? 15 : 9) : 0;
    this.speed = lerp(this.speed, targetSpeed, clamp(dt * 8, 0, 1));
    if (moving) {
      const ang = Math.atan2(mx, mz) + this.camYaw;
      const nx = this.x + Math.sin(ang) * this.speed * dt;
      const nz = this.z + Math.cos(ang) * this.speed * dt;
      // slide along blocked axes
      if (this.world.walkableAt(nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.world.walkableAt(nx, this.z)) { this.x = nx; }
      else if (this.world.walkableAt(this.x, nz)) { this.z = nz; }
      this.ry = lerpAngle(this.ry, ang, clamp(dt * 10, 0, 1));
      this.rig.userData.setAnim('walk');
    } else if (!this.frozen) {
      this.rig.userData.setAnim(this.rig.userData.getAnim() === 'fish' ? 'fish' : 'idle');
    }
    const targetY = this.world.surfaceYAt(this.x, this.z);
    this.y = lerp(this.y, targetY, clamp(dt * 12, 0, 1));
    this.rig.position.set(this.x, this.y, this.z);
    this.rig.rotation.y = this.ry;
    this.rig.userData.animate(performance.now() / 1000, dt);
  }

  updateCamera(camera, dt) {
    const px = this.x, py = this.y + 2, pz = this.z;
    const cd = this.camDist;
    const cx = px - Math.sin(this.camYaw) * Math.cos(this.camPitch) * cd;
    const cy = py + Math.sin(this.camPitch) * cd;
    const cz = pz - Math.cos(this.camYaw) * Math.cos(this.camPitch) * cd;
    // keep camera above terrain
    const groundY = this.world.heightAt(cx, cz) + 1.2;
    camera.position.set(cx, Math.max(cy, groundY), cz);
    camera.lookAt(px, py, pz);
  }

  facingPoint(dist) {
    return { x: this.x + Math.sin(this.ry) * dist, z: this.z + Math.cos(this.ry) * dist };
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ---------- input collector ----------
export class Input {
  constructor(canvas) {
    this.keys = {};
    this.typing = false;
    this.pointerDown = false;
    this.justClicked = false;
    this.dragging = false;
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

    let lastX = 0, lastY = 0, movedTotal = 0;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = true;
      this._downAt = performance.now();
      lastX = e.clientX; lastY = e.clientY; movedTotal = 0;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      movedTotal += Math.abs(dx) + Math.abs(dy);
      if (movedTotal > 8) {
        this.dragging = true;
        this.onDrag?.(dx, dy);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      this.pointerDown = false;
      const wasDrag = this.dragging;
      this.dragging = false;
      if (!wasDrag && performance.now() - this._downAt < 400) this.justClicked = true;
      this.onPointerUp?.(wasDrag);
    });
    canvas.addEventListener('wheel', (e) => { this.onWheel?.(e.deltaY); }, { passive: true });
  }
  consumeClick() {
    const c = this.justClicked;
    this.justClicked = false;
    return c;
  }
}
