// Interactive 3D fish viewer: drag to rotate, gentle auto-spin when idle.
// Used in the dex detail and the catch card.
import * as THREE from '../../vendor/three.module.js';
import { makeFishMesh, makeEffectParticles } from '../fishing/fishmesh.js';

export function mountFishViewer(container, fishDef, { width = 280, height = 190 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;cursor:grab;touch-action:none;';
  container.appendChild(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    container.textContent = '(3D preview unavailable)';
    return { dispose() {} };
  }
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.05, 40);
  camera.position.set(0, 0.35, 2.3);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#e8f2f8', '#5a6b5a', 1.1));
  const key = new THREE.DirectionalLight('#fff2d8', 1.6);
  key.position.set(2, 3, 4);
  scene.add(key);

  const pivot = new THREE.Group();
  scene.add(pivot);
  try {
    const mesh = makeFishMesh(fishDef);
    pivot.add(mesh);
    if (fishDef.effect) pivot.add(makeEffectParticles(fishDef.effect, 0.75));
  } catch { /* mesh failure — show empty */ }

  let yaw = 0.6, pitch = 0.1, autoSpin = true, lastInteract = 0;
  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; px = e.clientX; py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.stopPropagation();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px) * 0.012;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + (e.clientY - py) * 0.008));
    px = e.clientX; py = e.clientY;
    lastInteract = performance.now();
    autoSpin = false;
  });
  const stopDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  let raf = 0, disposed = false;
  const t0 = performance.now();
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const t = (performance.now() - t0) / 1000;
    if (!autoSpin && performance.now() - lastInteract > 3500) autoSpin = true;
    if (autoSpin && !dragging) yaw += 0.008;
    pivot.rotation.y = yaw;
    pivot.rotation.z = pitch * 0.5;
    pivot.position.y = Math.sin(t * 1.4) * 0.04;
    pivot.traverse((n) => n.userData?.animate?.(t, 1 / 60));
    renderer.render(scene, camera);
  }
  frame();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.dispose();
      canvas.remove();
    },
  };
}
