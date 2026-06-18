// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// gate.ts — Veyra entry: 3D gate + character customization + walk-in (three.js ES module).
// createVeyraGate(container, opts) -> { dispose, setLook, enter }
// opts: { look:{hue,skin,style,name}, onEnter() }

import * as THREE from 'three';
import { buildAvatar } from './shared/avatar';

export function createVeyraGate(container, opts) {
  opts = opts || {};
  let look = Object.assign({ hue: 184, skin: 1, style: 'minimal', name: 'Veyra' }, opts.look || {});

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;
  const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);
  const SKINS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

  // ── Renderer / scene ─────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#16383c');
  scene.fog = new THREE.Fog('#16383c', 22, 52);

  const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.1, 200);
  camera.position.set(0, 3.0, 8.4);
  const camLook = new THREE.Vector3(0, 1.5, -3);

  scene.add(new THREE.HemisphereLight('#dff5ee', '#2b524c', 1.05));
  scene.add(new THREE.AmbientLight('#cfeee8', 0.4));
  const sun = new THREE.DirectionalLight('#fff3df', 1.2);
  sun.position.set(-8, 16, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sd = 18; sun.shadow.camera.left = -sd; sun.shadow.camera.right = sd;
  sun.shadow.camera.top = sd; sun.shadow.camera.bottom = -sd;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60; sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ── Ground + path ────────────────────────────────────────
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 48),
    new THREE.MeshStandardMaterial({ color: '#5f9a8c', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 30),
    new THREE.MeshStandardMaterial({ color: '#cdd9cf', roughness: .95 }));
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.02, -6); path.receiveShadow = true; scene.add(path);

  // ── Gate wall ────────────────────────────────────────────
  const GZ = -12;
  const stone = new THREE.MeshStandardMaterial({ color: '#3c5b5a', roughness: .9 });
  const stone2 = new THREE.MeshStandardMaterial({ color: '#324d4c', roughness: .9 });
  function wallSeg(x, w) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 8, 1.4), stone);
    m.position.set(x, 4, GZ); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    // cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + .4, .6, 1.8), stone2);
    cap.position.set(x, 8.1, GZ); scene.add(cap);
  }
  wallSeg(-6.5, 7);   // left
  wallSeg(6.5, 7);    // right
  // lintel over opening
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.4, 1.6, 1.4), stone2);
  lintel.position.set(0, 7.0, GZ); lintel.castShadow = true; scene.add(lintel);
  // pillars
  [-2.9, 2.9].forEach(px => {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.5, .55, 6.2, 12), stone2);
    p.position.set(px, 3.1, GZ + .2); p.castShadow = true; scene.add(p);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 14),
      new THREE.MeshStandardMaterial({ color: hsl(look.hue, .6, .6), emissive: hsl(look.hue, .7, .4), emissiveIntensity: .9 }));
    orb.position.set(px, 6.5, GZ + .2); scene.add(orb);
  });

  // ── Gate doors (hinged) ──────────────────────────────────
  const doorMat = new THREE.MeshStandardMaterial({ color: '#274240', roughness: .7, metalness: .2 });
  const trimMat = new THREE.MeshStandardMaterial({ color: hsl(look.hue, .45, .5), roughness: .5, metalness: .3 });
  function door(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.7, 0, GZ + .3);   // hinge at outer edge
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.55, 5.6, .28), doorMat);
    panel.position.set(-side * 1.27, 2.9, 0); panel.castShadow = true; pivot.add(panel);
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, .16, .34), trimMat);
      bar.position.set(-side * 1.27, 1.4 + i * 1.5, 0); pivot.add(bar);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(.16, 10, 10), trimMat);
    knob.position.set(-side * 0.2, 2.9, .2); pivot.add(knob);
    scene.add(pivot); return pivot;
  }
  const doorL = door(-1), doorR = door(1);

  // ── Sign (canvas texture) ────────────────────────────────
  const sCanvas = document.createElement('canvas'); sCanvas.width = 512; sCanvas.height = 150;
  const sctx = sCanvas.getContext('2d');
  function drawSign() {
    sctx.clearRect(0, 0, 512, 150);
    sctx.fillStyle = '#eafcf8';
    sctx.font = '700 92px "Be Vietnam Pro", system-ui, sans-serif';
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.shadowColor = 'rgba(0,0,0,.4)'; sctx.shadowBlur = 12;
    let ls = 'VEYRA', x = 256 - 4 * 18;
    sctx.fillText('V E Y R A', 256, 80);
  }
  drawSign();
  const signTex = new THREE.CanvasTexture(sCanvas);
  signTex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.35),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
  sign.position.set(0, 7.05, GZ + .75); scene.add(sign);
  // glow arch
  const arch = new THREE.Mesh(new THREE.TorusGeometry(2.2, .12, 8, 40, Math.PI),
    new THREE.MeshBasicMaterial({ color: hsl(look.hue, .65, .6) }));
  arch.position.set(0, 7.6, GZ + .7); scene.add(arch);

  // banners
  [-6.5, 6.5].forEach(bx => {
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4.2),
      new THREE.MeshStandardMaterial({ color: hsl(look.hue, .5, .42), roughness: .8, side: THREE.DoubleSide }));
    ban.position.set(bx, 4.2, GZ + .75); scene.add(ban);
  });

  // ── Decor: torches, trees ────────────────────────────────
  function torch(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: '#33403e', roughness: .8 }));
    pole.position.y = 1.3; pole.castShadow = true; g.add(pole);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 10),
      new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ffcf6e', emissiveIntensity: 1 }));
    flame.position.y = 2.75; g.add(flame);
    const light = new THREE.PointLight('#ffd27a', .7, 9); light.position.set(x, 2.8, z); scene.add(light);
    scene.add(g); return flame;
  }
  const flames = [torch(-3.4, -3.5), torch(3.4, -3.5), torch(-3.4, GZ + 1.4), torch(3.4, GZ + 1.4)];
  function tree(x, z, s) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(.16, .22, 1.1, 6),
      new THREE.MeshStandardMaterial({ color: '#7c5e42', roughness: 1 }));
    tr.position.y = .55; tr.castShadow = true; g.add(tr);
    const lm = new THREE.MeshStandardMaterial({ color: hsl(150, .35, .46), roughness: 1 });
    [[0, 1.5, 1], [.4, 2, .7], [-.35, 2.05, .65]].forEach(([dx, dy, r]) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), lm);
      m.position.set(dx, dy, 0); m.castShadow = true; g.add(m);
    });
    scene.add(g);
  }
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (5 + Math.random() * 7);
    const z = -10 + Math.random() * 12;   // sides only, keep the corridor clear
    tree(x, z, .7 + Math.random() * .7);
  }

  // ── Characters (shared avatar builder) ───────────────────
  // player
  const player = buildAvatar({ hue: look.hue, skinColor: SKINS[look.skin] });
  player.group.position.set(0, 0, 6);
  player.group.rotation.y = Math.PI; // face the gate (-z); player walks up to it
  scene.add(player.group);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(.5, 20),
    new THREE.MeshBasicMaterial({ color: '#10302d', transparent: true, opacity: .28 }));
  blob.rotation.x = -Math.PI / 2; blob.position.set(0, .04, 0); scene.add(blob);

  // guard
  const guard = buildAvatar({ hue: 200, skinColor: SKINS[2] });
  guard.group.position.set(0, 0, GZ + 3.0);   // centered, blocking the opening
  guard.group.rotation.y = 0;                  // face the incoming player (+z)
  guard.mats.clothMat.color = hsl(195, .4, .34);
  guard.mats.pantsMat.color = hsl(195, .35, .22);
  scene.add(guard.group);
  // guard hat (tall)
  const ghat = new THREE.Mesh(new THREE.CylinderGeometry(.26, .3, .5, 14), new THREE.MeshStandardMaterial({ color: hsl(195, .45, .28), roughness: .8 }));
  ghat.position.y = 1.95; guard.group.add(ghat);
  // staff
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 2.4, 8), new THREE.MeshStandardMaterial({ color: '#caa15a', roughness: .6, metalness: .3 }));
  staff.position.set(.4, 1.2, 0); guard.group.add(staff);

  // bystanders (unregistered avatars outside)
  const byStanders = [];
  [[-4.2, -2.2, 130], [4.4, -1.6, 60], [-5.2, 1.4, 30], [5.0, 1.0, 280]].forEach(([x, z, h], i) => {
    const c = buildAvatar({ hue: h, skinColor: SKINS[i % SKINS.length] });
    c.group.position.set(x, 0, z);
    c.group.rotation.y = Math.random() * Math.PI * 2;
    c.group.scale.setScalar(.96);
    c.setStyle(['minimal', 'street', 'soft'][i % 3]);
    scene.add(c.group);
    byStanders.push({ c, ph: Math.random() * 6 });
  });

  player.setStyle(look.style);

  // ── setLook (live) ───────────────────────────────────────
  function setLook(next) {
    look = Object.assign(look, next);
    player.mats.clothMat.color = hsl(look.hue, .55, .52);
    player.mats.pantsMat.color = hsl(look.hue, .35, .3);
    player.mats.hairMat.color = hsl(look.hue, .4, .2);
    player.mats.skinMat.color = new THREE.Color(SKINS[look.skin] || SKINS[1]);
    player.setStyle(look.style);
    // tint gate accents to chosen hue
    trimMat.color = hsl(look.hue, .45, .5);
    arch.material.color = hsl(look.hue, .65, .6);
  }

  // ── Controls: free roam (joystick + keyboard + orbit camera) ──
  const sstep = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
  const SPEED = 5.4;

  const keys = {};
  const onKey = (e, down) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys[k] = down; e.preventDefault(); }
  };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

  const joy = { active: false, id: null, x: 0, y: 0, cx: 0, cy: 0 };
  const base = document.createElement('div'); base.className = 'v-joy-base';
  const knob = document.createElement('div'); knob.className = 'v-joy-knob';
  base.appendChild(knob); container.appendChild(base);
  const R = 52;
  function joyStart(e) { joy.active = true; joy.id = e.pointerId; const r = base.getBoundingClientRect(); joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2; base.setPointerCapture(e.pointerId); joyMove(e); }
  function joyMove(e) { if (!joy.active || e.pointerId !== joy.id) return; let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const d = Math.hypot(dx, dy) || 1; if (d > R) { dx = dx / d * R; dy = dy / d * R; } knob.style.transform = `translate(${dx}px,${dy}px)`; joy.x = dx / R; joy.y = dy / R; }
  function joyEnd(e) { if (e.pointerId !== joy.id) return; joy.active = false; joy.x = 0; joy.y = 0; knob.style.transform = 'translate(0,0)'; }
  base.addEventListener('pointerdown', joyStart);
  base.addEventListener('pointermove', joyMove);
  base.addEventListener('pointerup', joyEnd);
  base.addEventListener('pointercancel', joyEnd);

  let camYaw = 0, camElev = 0.4, camDist = 9.5;
  const dom = renderer.domElement;
  const orbit = { pointers: new Map(), lastDist: 0 };
  function camDown(e) { orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { dom.setPointerCapture(e.pointerId); } catch (_) {} }
  function camMove(e) {
    if (!orbit.pointers.has(e.pointerId)) return;
    const prev = orbit.pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbit.pointers.size >= 2) {
      const pts = [...orbit.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit.lastDist) camDist = Math.max(5, Math.min(15, camDist - (d - orbit.lastDist) * 0.05));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.18, Math.min(0.9, camElev + dy * 0.005));
    }
  }
  function camUp(e) { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; }
  dom.addEventListener('pointerdown', camDown);
  dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp);
  dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = Math.max(5, Math.min(15, camDist + e.deltaY * 0.01)); e.preventDefault(); };
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── Guard barrier / proximity / gate ─────────────────────
  const guardX0 = guard.group.position.x, guardZ = guard.group.position.z;
  const barrierZ = guardZ + 1.5;        // player can't pass the guard until the gate opens
  let gateOpen = false, gt = 0;          // gate-open animation timer
  let atGuard = false, doneFired = false, phase = 0;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();

  let raf = 0, running = true, last = performance.now();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // ambient life
    byStanders.forEach((b) => {
      b.c.group.rotation.y += Math.sin(t * .6 + b.ph) * .003;
      b.c.parts.torso.position.y = 1.05 + Math.sin(t * 1.2 + b.ph) * .02;
    });
    flames.forEach((f, i) => { const s = 1 + Math.sin(t * 9 + i) * .12; f.scale.set(s, s + .1, s); });
    arch.rotation.z = Math.sin(t * .5) * .03;
    if (!gateOpen) guard.parts.head.rotation.y = Math.sin(t * .5) * .2;

    // ── input → movement (relative to camera yaw) ──
    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz); const moving = mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    if (moving) {
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      const mvx = rgtX * ix + fwdX * (-iz);
      const mvz = rgtZ * ix + fwdZ * (-iz);
      const p = player.group.position;
      p.x += mvx * SPEED * dt;
      p.z += mvz * SPEED * dt;
      // play area
      p.x = Math.max(-8.5, Math.min(8.5, p.x));
      p.z = Math.min(15, p.z);
      // invisible barrier across the opening until the guard lets you in
      if (!gateOpen && p.z < barrierZ) p.z = barrierZ;
      // funnel through the doorway when crossing the wall
      if (p.z < GZ + 1.6) p.x = Math.max(-2.2, Math.min(2.2, p.x));
      // face direction of travel
      const targetRot = Math.atan2(mvx, mvz);
      let diff = ((targetRot - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.group.rotation.y += diff * Math.min(1, dt * 12);
    }

    // walk animation
    const sp = moving ? mag : 0;
    phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const swing = moving ? 0.7 * sp : 0;
    const ease = (pt, v) => pt.rotation.x += (v - pt.rotation.x) * Math.min(1, dt * 14);
    ease(player.parts.legL, Math.sin(phase) * swing);
    ease(player.parts.legR, -Math.sin(phase) * swing);
    ease(player.parts.armL, -Math.sin(phase) * swing * 0.7);
    ease(player.parts.armR, Math.sin(phase) * swing * 0.7);
    player.parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : Math.sin(t * 1.4) * 0.015);
    blob.position.set(player.group.position.x, .04, player.group.position.z);

    // ── proximity to guard ──
    const gd = Math.hypot(player.group.position.x - guard.group.position.x, player.group.position.z - guardZ);
    const nowAt = gd < 3.0;
    if (nowAt !== atGuard) { atGuard = nowAt; opts.onProximity && opts.onProximity(atGuard); }

    // ── gate opening: doors swing, guard steps aside, barrier drops ──
    if (gateOpen) {
      gt += dt;
      const dOpen = sstep(0, 1.3, gt);
      doorL.rotation.y = dOpen * 2.0; doorR.rotation.y = -dOpen * 2.0;
      const ga = sstep(0, 0.7, gt);
      guard.group.position.x = guardX0 - ga * 3.0;
      guard.parts.armR.rotation.x = -ga * 1.6; staff.rotation.z = -ga * 0.5;
      // the player walks through on their own — fire once they cross the threshold
      if (!doneFired && player.group.position.z < GZ - 0.4) { doneFired = true; opts.onEnter && opts.onEnter(); }
    }

    // ── third-person camera follow ──
    const offX = camDist * Math.cos(camElev) * Math.sin(camYaw);
    const offZ = camDist * Math.cos(camElev) * Math.cos(camYaw);
    const offY = camDist * Math.sin(camElev);
    camTarget.set(player.group.position.x + offX, 1.2 + offY, player.group.position.z + offZ);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    tmp.set(player.group.position.x, 1.3, player.group.position.z);
    camera.lookAt(tmp);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H());
  });
  ro.observe(container);

  // Pause rendering while the tab is hidden (saves battery on mobile).
  let disposed = false;
  const onVisibility = () => {
    if (disposed) return;
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setLook,
    openGate() { if (!gateOpen) { gateOpen = true; gt = 0; } },
    dispose() {
      disposed = true; running = false; cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku);
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (base.parentNode) base.parentNode.removeChild(base);
    },
  };
};
