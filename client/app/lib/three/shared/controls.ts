// @ts-nocheck -- shared input controls (keyboard + virtual joystick) for the engines.

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const ACTION_KEYS = ['shift', ' '];   // shift = run, space = jump

/** WASD / arrow-key movement (+ shift run / space jump). Returns { keys, dispose }. */
export function createKeyboard() {
  const keys = {};
  // Clearing in place keeps the same `keys` object reference the engines hold.
  const clearKeys = () => { for (const k in keys) keys[k] = false; };
  const onKey = (e, down) => {
    if (e.key == null) return;   // some events (autofill / IME / media keys) have no .key
    // Ctrl / Cmd / Alt + key is a browser/OS shortcut (Ctrl+W close tab, Ctrl+S
    // save, Cmd+… on macOS), NOT movement — and the browser frequently SWALLOWS
    // the matching key-up while the modifier is held, latching a move key so the
    // avatar walks on its own in one direction. Any time a modifier is in play,
    // release everything and bail (also stops the avatar the instant Ctrl goes
    // down, so a key already held can't get stuck behind it).
    if (e.ctrlKey || e.metaKey || e.altKey) { clearKeys(); return; }
    const k = e.key.toLowerCase();
    if (!MOVE_KEYS.includes(k) && !ACTION_KEYS.includes(k)) return;
    // On key-DOWN, ignore game keys while typing in a form field (e.g. the gate
    // ticket's email/password) so they aren't swallowed. But ALWAYS process
    // key-UP — otherwise a key pressed before focusing an input never clears and
    // the avatar walks/runs on its own.
    if (down) {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    }
    keys[k] = down;
    if (MOVE_KEYS.includes(k) || k === ' ') e.preventDefault();   // stop page scroll on arrows/space
  };
  const kd = (e) => onKey(e, true);
  const ku = (e) => onKey(e, false);
  // Release EVERY held key when we can't trust that a matching key-up will
  // arrive. If the window loses focus (Alt-Tab, another window/DevTools, an OS
  // notification) or the tab is hidden while a key is down, the browser delivers
  // the key-up elsewhere — leaving the key latched and the avatar walking on its
  // own ("stuck key").
  const onBlur = () => clearKeys();
  const onVis = () => { if (document.hidden) clearKeys(); };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  return {
    keys,
    dispose() {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
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

/**
 * On-screen thumbstick appended to `container`. Returns { joy:{x,y}, el,
 * setVisual, dispose }.
 *
 * setVisual(nx, ny) moves the knob from an EXTERNAL source (the keyboard) when the
 * stick isn't being touched, so the bottom-left control stays in sync with WASD /
 * arrow input. The release is hardened: a missed pointer-up, a lost pointer
 * capture, a window blur (Alt-Tab) or a tab switch while the stick is held all
 * reset it to centre — otherwise joy.x/y stay latched and the avatar walks on its
 * own ("stuck movement").
 */
export function createJoystick(container) {
  const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
  const base = document.createElement('div'); base.className = 'v-joy-base';
  const knob = document.createElement('div'); knob.className = 'v-joy-knob';
  base.appendChild(knob); container.appendChild(base);
  const R = 52;
  let lvx = 0, lvy = 0;   // last knob offset written (skip redundant DOM writes)
  const setKnob = (dx, dy) => {
    if (dx === lvx && dy === lvy) return;
    lvx = dx; lvy = dy;
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  // Hard reset to centre — used by pointer-up/cancel/lost-capture, blur + tab hide.
  const reset = () => {
    joy.active = false; joy.id = null; joy.x = 0; joy.y = 0; setKnob(0, 0);
  };
  const start = (e) => {
    joy.active = true; joy.id = e.pointerId;
    const r = base.getBoundingClientRect();
    joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2;
    try { base.setPointerCapture(e.pointerId); } catch (_) {}
    move(e);
  };
  const move = (e) => {
    if (!joy.active || e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    setKnob(dx, dy);
    joy.x = dx / R; joy.y = dy / R;
  };
  // Any matching pointer release (or lost capture) recentres. Ignore stray events
  // for a DIFFERENT pointer id while a touch is active.
  const end = (e) => {
    if (joy.active && e.pointerId !== joy.id) return;
    reset();
  };
  const onBlur = () => reset();
  const onVis = () => { if (document.hidden) reset(); };
  base.addEventListener('pointerdown', start);
  base.addEventListener('pointermove', move);
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
  base.addEventListener('lostpointercapture', end);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);
  return {
    joy,
    el: base,
    /** Reflect an external (keyboard) direction on the knob. No-op while touched. */
    setVisual(nx, ny) {
      if (joy.active) return;
      let dx = nx || 0, dy = ny || 0;
      const d = Math.hypot(dx, dy);
      if (d > 1) { dx /= d; dy /= d; }
      setKnob(dx * R, dy * R);
    },
    /** Force the stick back to centre (e.g. when the engine drops input focus). */
    reset,
    dispose() {
      base.removeEventListener('pointerdown', start);
      base.removeEventListener('pointermove', move);
      base.removeEventListener('pointerup', end);
      base.removeEventListener('pointercancel', end);
      base.removeEventListener('lostpointercapture', end);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      if (base.parentNode) base.parentNode.removeChild(base);
    },
  };
}
