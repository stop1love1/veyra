// @ts-nocheck -- shared input controls (keyboard + virtual joystick) for the engines.

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

/** WASD / arrow-key movement state. Returns { keys, dispose }. */
export function createKeyboard() {
  const keys = {};
  const onKey = (e, down) => {
    // Ignore movement keys while the player is typing in a form field (e.g. the
    // gate ticket's email/password) — otherwise WASD would be swallowed and the
    // avatar would walk off mid-login.
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.includes(k)) { keys[k] = down; e.preventDefault(); }
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  return {
    keys,
    dispose() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    },
  };
}

/**
 * Drag-to-rotate / pinch-or-wheel-to-zoom orbit camera state.
 * Returns { cam:{yaw,elev,dist}, dispose }. The frame reads cam.* each tick.
 */
export function createOrbitCamera(dom, opts = {}) {
  const cam = { yaw: opts.yaw ?? 0, elev: opts.elev ?? 0.6, dist: opts.dist ?? 11 };
  const minDist = opts.minDist ?? 6, maxDist = opts.maxDist ?? 18;
  const minElev = opts.minElev ?? 0.2, maxElev = opts.maxElev ?? 1.2;
  const rot = opts.rot ?? 0.007, elevSpeed = opts.elevSpeed ?? 0.005;
  const pinch = opts.pinch ?? 0.05, wheel = opts.wheel ?? 0.015;
  const clampDist = (d) => Math.max(minDist, Math.min(maxDist, d));
  const orbit = { pointers: new Map(), lastDist: 0 };
  const down = (e) => { orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { dom.setPointerCapture(e.pointerId); } catch (_) {} };
  const move = (e) => {
    if (!orbit.pointers.has(e.pointerId)) return;
    const prev = orbit.pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbit.pointers.size >= 2) {
      const pts = [...orbit.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit.lastDist) cam.dist = clampDist(cam.dist - (d - orbit.lastDist) * pinch);
      orbit.lastDist = d;
    } else {
      cam.yaw -= dx * rot;
      cam.elev = Math.max(minElev, Math.min(maxElev, cam.elev + dy * elevSpeed));
    }
  };
  const up = (e) => { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; };
  const onWheel = (e) => { cam.dist = clampDist(cam.dist + e.deltaY * wheel); e.preventDefault(); };
  dom.addEventListener('pointerdown', down);
  dom.addEventListener('pointermove', move);
  dom.addEventListener('pointerup', up);
  dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', onWheel, { passive: false });
  return {
    cam,
    /** Drop any in-flight orbit pointers so they can't trigger a false 2-pointer
     *  pinch once another mode (e.g. inspect) takes over the drag. */
    clearPointers() { orbit.pointers.clear(); orbit.lastDist = 0; },
    dispose() {
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', up);
      dom.removeEventListener('pointercancel', up);
      dom.removeEventListener('wheel', onWheel);
    },
  };
}

/** On-screen thumbstick appended to `container`. Returns { joy:{x,y}, el, dispose }. */
export function createJoystick(container) {
  const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
  const base = document.createElement('div'); base.className = 'v-joy-base';
  const knob = document.createElement('div'); knob.className = 'v-joy-knob';
  base.appendChild(knob); container.appendChild(base);
  const R = 52;
  const start = (e) => {
    joy.active = true; joy.id = e.pointerId;
    const r = base.getBoundingClientRect();
    joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
    base.setPointerCapture(e.pointerId); move(e);
  };
  const move = (e) => {
    if (!joy.active || e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    joy.x = dx / R; joy.y = dy / R;
  };
  const end = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.active = false; joy.x = 0; joy.y = 0; knob.style.transform = 'translate(0,0)';
  };
  base.addEventListener('pointerdown', start);
  base.addEventListener('pointermove', move);
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  return {
    joy,
    el: base,
    dispose() {
      base.removeEventListener('pointerdown', start);
      base.removeEventListener('pointermove', move);
      base.removeEventListener('pointerup', end);
      base.removeEventListener('pointercancel', end);
      if (base.parentNode) base.parentNode.removeChild(base);
    },
  };
}
