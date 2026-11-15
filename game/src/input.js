// Keyboard + mouse, with pointer lock for mouse look. The sim reads `state` each step;
// look deltas are consumed once per frame by main.js.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    firing: false,
    locked: false,
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    state.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch {
        // Headless or denied: the game runs without the lock.
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
  };
}
