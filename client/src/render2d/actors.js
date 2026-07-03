// 2D actors: drop-in replacement for the old 3D humanoid rig API.
// Actors are plain objects the renderer draws from character sheets.

export function makeHumanoid(look = {}) {
  const actor = {
    isActor: true,
    look,
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    rotation: { y: 0 },
    visible: true,
    dir: 'down',
    anim: 'idle',
    phase: Math.random() * 10,
    sheet: null,          // lazily built by the renderer
    labelName: null,
    labelTitle: null,
    labelColor: '#ffffff',
    bubble: null,
    userData: {},
  };
  actor.userData.rod = { visible: false };
  actor.userData.setAnim = (a) => { actor.anim = a; };
  actor.userData.getAnim = () => actor.anim;
  actor.userData.animate = () => {
    // derive 4-direction facing from rotation.y (dir vector = (sin ry, cos ry); +z is down-screen)
    const s = Math.sin(actor.rotation.y), c = Math.cos(actor.rotation.y);
    actor.dir = Math.abs(s) > Math.abs(c) ? (s > 0 ? 'right' : 'left') : (c > 0 ? 'down' : 'up');
    if (actor.userData.rod.visible && actor.anim !== 'walk') actor.anim = 'fish';
  };
  return actor;
}

export function attachLabel(actor, name, title = null, color = '#ffffff') {
  actor.labelName = name;
  actor.labelTitle = title || null;
  actor.labelColor = color;
}

export function showBubble(actor, text) {
  actor.bubble = { text: String(text), until: performance.now() + 4500 + Math.min(4000, String(text).length * 60) };
}
