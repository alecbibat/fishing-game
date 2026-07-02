// Player avatar, humanoid rig (shared by NPCs and remote players), controls, camera.
import * as THREE from '../../vendor/three.module.js';
import { clamp, lerp } from '../core/util.js';
import { mat } from '../world/prims.js';
import { makeTextSprite } from '../world/prims.js';

// ---------- humanoid rig (RuneScape-style blocky proportions) ----------
export function makeHumanoid(look = {}) {
  const { shirt = '#d9663f', pants = '#3f5d8a', hat = '#7a5230', skin = '#f0c49a', hair = '#5d4430' } = look;
  const g = new THREE.Group();
  const shade = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

  // torso: broad chest tapering to a belted waist
  const torso = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.62, 0.46), mat(shirt));
  chest.position.y = 1.42;
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.4), mat(shirt));
  waist.position.y = 0.96;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.12, 0.42), mat(shade(pants, 0.55)));
  belt.position.y = 0.82;
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.48), mat(shade(shirt, 0.8)));
  shoulderL.position.set(-0.56, 1.66, 0);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 0.56;
  torso.add(chest, waist, belt, shoulderL, shoulderR);
  g.add(torso);

  // head: blocky with neck, hair cap, face
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.22), mat(skin));
  neck.position.y = 1.78;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.54, 0.5), mat(skin));
  head.position.y = 2.12;
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.54), mat(hair));
  hairTop.position.y = 2.38;
  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.34, 0.16), mat(hair));
  hairBack.position.set(0, 2.18, -0.22);
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), mat('#26221c'));
  eyeL.position.set(-0.12, 2.16, 0.26);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.12;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.08), mat(shade(skin, 0.9)));
  nose.position.set(0, 2.06, 0.27);
  g.add(neck, head, hairTop, hairBack, eyeL, eyeR, nose);
  if (hat) {
    const hatG = new THREE.Group();
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.58, 0.08, 9), mat(hat));
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.34, 8), mat(hat));
    top.position.y = 0.18;
    hatG.add(brim, top);
    hatG.position.y = 2.46;
    g.add(hatG);
  }

  // arms: pivot at the shoulder, hang at the sides, skin forearms + hands
  function makeArm(side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.56, 1.6, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.26), mat(shirt));
    upper.position.y = -0.3;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.22), mat(skin));
    fore.position.y = -0.74;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.24), mat(shade(skin, 0.92)));
    hand.position.y = -1.0;
    arm.add(upper, fore, hand);
    arm.rotation.z = side * -0.08; // slight outward hang
    return arm;
  }
  const armL = makeArm(-1), armR = makeArm(1);
  g.add(armL, armR);

  // legs: pivot at the hip, boots
  function makeLeg(side) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.2, 0.78, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.44, 0.34), mat(pants));
    thigh.position.y = -0.22;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.36, 0.3), mat(shade(pants, 0.82)));
    shin.position.y = -0.58;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.44), mat('#4a3a28'));
    boot.position.set(0, -0.73, 0.05);
    leg.add(thigh, shin, boot);
    return leg;
  }
  const legL = makeLeg(-1), legR = makeLeg(1);
  g.add(legL, legR);

  // fishing rod (hidden unless fishing/held) — held in the right hand
  const rod = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.6, 5), mat('#8a6642'));
  pole.position.y = 1.3;
  rod.add(pole);
  rod.position.set(0.6, 0.7, 0.3);
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
      legL.rotation.x = Math.sin(phase) * 0.65;
      legR.rotation.x = -Math.sin(phase) * 0.65;
      armL.rotation.x = -Math.sin(phase) * 0.55;
      armR.rotation.x = rod.visible ? -0.9 : Math.sin(phase) * 0.55;
      torso.position.y = Math.abs(Math.sin(phase)) * 0.04;
    } else if (anim === 'fish') {
      legL.rotation.x = legR.rotation.x = 0;
      armR.rotation.x = -1.15;
      armL.rotation.x = -0.3;
      torso.position.y = 0;
    } else {
      legL.rotation.x = legR.rotation.x = 0;
      armL.rotation.x = Math.sin(phase * 0.5) * 0.05;
      armR.rotation.x = rod.visible ? -0.9 : Math.sin(phase * 0.5 + 1) * 0.05;
      torso.position.y = Math.sin(phase * 0.8) * 0.015;
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
  // OSRS-style overhead chat: yellow text, black outline, no bubble
  const sprite = makeTextSprite(text, { color: '#ffff00', outline: '#000000', bg: null, scale: 0.95 });
  sprite.position.y = 3.8;
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
    this.walkTarget = null;  // right-click "Walk here"
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
      if (k['KeyW'] || k['ArrowUp']) mz += 1;
      if (k['KeyS'] || k['ArrowDown']) mz -= 1;
      if (k['KeyA'] || k['ArrowLeft']) mx += 1;
      if (k['KeyD'] || k['ArrowRight']) mx -= 1;
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
      const ang = walkAng !== null ? walkAng : Math.atan2(mx, mz) + this.camYaw;
      const nx = this.x + Math.sin(ang) * this.speed * dt;
      const nz = this.z + Math.cos(ang) * this.speed * dt;
      // slide along blocked axes
      if (this.world.walkableAt(nx, nz)) { this.x = nx; this.z = nz; }
      else if (this.world.walkableAt(nx, this.z)) { this.x = nx; if (walkAng !== null) this.walkTarget = null; }
      else if (this.world.walkableAt(this.x, nz)) { this.z = nz; if (walkAng !== null) this.walkTarget = null; }
      else if (walkAng !== null) this.walkTarget = null;
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
      if (e.button !== 0) return; // right-click is the Choose Option menu
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
      if (e.button !== 0) return;
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
