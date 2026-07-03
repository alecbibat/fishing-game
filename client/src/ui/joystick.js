// Virtual joystick for touch devices — writes into input.moveVec.
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function initJoystick(input) {
  const pad = document.getElementById('joystick');
  const thumb = document.getElementById('joystick-thumb');
  if (!pad || !thumb || !isTouchDevice()) return;
  pad.classList.remove('hidden');
  const R = 40; // thumb travel radius (px)
  let activeId = null;

  const setVec = (dx, dy) => {
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    thumb.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    // screen up = north = -z; screen right = +x
    input.moveVec.x = (dx * k) / R;
    input.moveVec.z = (dy * k) / R;
  };
  const reset = () => {
    activeId = null;
    thumb.style.transform = 'translate(-50%, -50%)';
    input.moveVec.x = 0;
    input.moveVec.z = 0;
  };

  pad.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch { /* pointer may have already ended */ }
    const r = pad.getBoundingClientRect();
    setVec(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    e.preventDefault();
    e.stopPropagation();
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const r = pad.getBoundingClientRect();
    setVec(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    e.preventDefault();
  });
  pad.addEventListener('pointerup', reset);
  pad.addEventListener('pointercancel', reset);
}
