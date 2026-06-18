// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// store3d.js — Veyra walkable 3D shop interior. Reads window.THREE.
// window.createVeyraStore(container, opts) -> { dispose }
// opts: { shopHue, look:{hue,skin,style}, products:[{id,name,price,color}], npc:{name,hue},
//         labels:{exit}, onProximity(poi|null), onExit() }

import * as THREE from 'three';

export function createVeyraStore(container, opts) {
  opts = opts || {};
  const shopHue = opts.shopHue != null ? opts.shopHue : 184;
  const look = Object.assign({ hue: 184, skin: 1, style: 'minimal' }, opts.look || {});
  const products = opts.products || [];
  const npcInfo = opts.npc || { name: 'Mira', hue: shopHue };
  const SKINS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;
  const hsl = (h, s, l) => new THREE.Color().setHSL(h / 360, s, l);

  // ── Renderer / scene ─────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W(), H());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const wallTint = hsl(shopHue, .18, .16);
  scene.background = wallTint.clone();
  scene.fog = new THREE.Fog(wallTint.clone(), 18, 34);

  const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 120);
  camera.position.set(0, 8, 12);

  // ── Lights (warm interior) ───────────────────────────────
  scene.add(new THREE.HemisphereLight('#fff1de', '#3a4f4c', .9));
  scene.add(new THREE.AmbientLight('#e9ddc8', .4));
  const key = new THREE.DirectionalLight('#fff4e2', .85);
  key.position.set(6, 14, 8); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sd = 14; key.shadow.camera.left = -sd; key.shadow.camera.right = sd;
  key.shadow.camera.top = sd; key.shadow.camera.bottom = -sd; key.shadow.camera.far = 50; key.shadow.bias = -.0004;
  scene.add(key);
  // ceiling glow lamps
  [-4, 4].forEach(lx => {
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(.7, .8, .25, 16),
      new THREE.MeshStandardMaterial({ color: '#fff6e6', emissive: '#ffe9c2', emissiveIntensity: .9 }));
    lamp.position.set(lx, 6.4, -1); scene.add(lamp);
    const pl = new THREE.PointLight(hsl(shopHue, .3, .7), .5, 22); pl.position.set(lx, 6, -1); scene.add(pl);
  });

  // ── Room shell ───────────────────────────────────────────
  const RX = 6.6, RZ = 7;
  const floorMat = new THREE.MeshStandardMaterial({ color: hsl(shopHue, .12, .34), roughness: .9 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, .4, RZ * 2 + 1), floorMat);
  floor.position.set(0, -.2, 0); floor.receiveShadow = true; scene.add(floor);
  // rug
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, .06, 36),
    new THREE.MeshStandardMaterial({ color: hsl(shopHue, .4, .5), roughness: .8 }));
  rug.position.set(0, .03, -1.5); rug.receiveShadow = true; scene.add(rug);
  const rugRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, .06, 8, 48),
    new THREE.MeshStandardMaterial({ color: '#eafcf8', roughness: .7 }));
  rugRing.rotation.x = -Math.PI / 2; rugRing.position.set(0, .07, -1.5); scene.add(rugRing);

  const wallMat = new THREE.MeshStandardMaterial({ color: hsl(shopHue, .16, .26), roughness: .95 });
  const wallH = 6.6;
  function wall(x, z, w, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, .3), wallMat);
    m.position.set(x, wallH / 2 - .2, z); m.rotation.y = rotY; m.receiveShadow = true; scene.add(m);
    return m;
  }
  wall(0, -RZ, RX * 2, 0);            // back
  wall(-RX, 0, RZ * 2, Math.PI / 2);  // left
  wall(RX, 0, RZ * 2, Math.PI / 2);   // right
  // front wall split for the exit doorway
  wall(-(RX / 2 + .8), RZ, RX - 1.6, 0);
  wall((RX / 2 + .8), RZ, RX - 1.6, 0);
  // ceiling
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, .3, RZ * 2 + 1),
    new THREE.MeshStandardMaterial({ color: hsl(shopHue, .14, .2), roughness: 1 }));
  ceil.position.set(0, wallH - .2, 0); scene.add(ceil);

  // back-wall sign (canvas)
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ── Exit portal (front doorway) ──────────────────────────
  const portal = new THREE.Group(); portal.position.set(0, 0, RZ - .1);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.3, .13, 10, 28, Math.PI),
    new THREE.MeshBasicMaterial({ color: hsl(shopHue, .6, .6) }));
  arch.position.y = 3.1; portal.add(arch);
  [-1.3, 1.3].forEach(px => { const p = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, 3.2, 10), new THREE.MeshBasicMaterial({ color: hsl(shopHue, .55, .55) })); p.position.set(px, 1.55, 0); portal.add(p); });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.1), new THREE.MeshBasicMaterial({ color: hsl(shopHue, .5, .7), transparent: true, opacity: .16 }));
  glow.position.set(0, 1.7, .05); portal.add(glow);
  scene.add(portal);

  // potted plants in back corners
  [[-RX + 1, -RZ + 1], [RX - 1, -RZ + 1]].forEach(([px, pz]) => {
    const pg = new THREE.Group(); pg.position.set(px, 0, pz);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(.4, .3, .6, 12), new THREE.MeshStandardMaterial({ color: '#b98a55', roughness: .9 }));
    pot.position.y = .3; pot.castShadow = true; pg.add(pot);
    const leafM = new THREE.MeshStandardMaterial({ color: hsl(140, .35, .45), roughness: 1 });
    [[0, 1.1, .55], [.3, 1.5, .42], [-.28, 1.45, .4]].forEach(([dx, dy, r]) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafM); m.position.set(dx, dy, 0); m.castShadow = true; pg.add(m); });
    scene.add(pg);
  });

  // ── Billboard label helper ───────────────────────────────
  const labels = [];
  function makeLabel(title, sub, w) {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 104;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(12,30,30,.84)'; roundRect(c, 4, 4, 292, 96, 22); c.fill();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#eafcf8'; c.font = '600 30px "Be Vietnam Pro", system-ui, sans-serif';
    let tt = title.length > 16 ? title.slice(0, 15) + '…' : title;
    c.fillText(tt, 150, 40);
    if (sub) { c.fillStyle = '#8fe3d4'; c.font = '700 26px "Space Mono", monospace'; c.fillText(sub, 150, 76); }
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
    const ww = w || 2.0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, ww * 104 / 300), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    labels.push(m); return m;
  }

  // ── Person builder (player + NPC) ────────────────────────
  function buildPerson(cfg) {
    const grp = new THREE.Group();
    const clothM = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .55, .52), roughness: .8 });
    const pantsM = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .35, .3), roughness: .85 });
    const skinM = new THREE.MeshStandardMaterial({ color: cfg.skinColor || SKINS[1], roughness: .9 });
    const hairM = new THREE.MeshStandardMaterial({ color: hsl(cfg.hue, .4, .2), roughness: 1 });
    const cap = (r, len, m) => { const x = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m); x.castShadow = true; return x; };
    const torso = cap(.26, .5, clothM); torso.position.y = 1.05; grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.26, 18, 18), skinM); head.position.y = 1.62; head.castShadow = true; grp.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.285, 16, 16, 0, Math.PI * 2, 0, Math.PI * .62), hairM); hair.position.set(0, 1.66, -.02); grp.add(hair);
    function limb(x, y, r, len, m) { const p = new THREE.Group(); p.position.set(x, y, 0); const mm = cap(r, len, m); mm.position.y = -(len / 2 + r); p.add(mm); grp.add(p); return p; }
    const armL = limb(-.33, 1.28, .08, .4, clothM), armR = limb(.33, 1.28, .08, .4, clothM);
    const legL = limb(-.13, .78, .1, .42, pantsM), legR = limb(.13, .78, .1, .42, pantsM);
    [armL, armR].forEach(a => { const h = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 8), skinM); h.position.y = -.62; a.add(h); });
    [legL, legR].forEach(l => { const f = new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .3), pantsM); f.position.set(0, -.66, .06); f.castShadow = true; l.add(f); });
    if (cfg.style === 'street') { const crown = new THREE.Mesh(new THREE.CylinderGeometry(.27, .29, .22, 14), clothM); crown.position.y = 1.86; grp.add(crown); const visor = new THREE.Mesh(new THREE.BoxGeometry(.46, .06, .32), clothM); visor.position.set(0, 1.78, .26); grp.add(visor); }
    if (cfg.style === 'soft') { const tunic = new THREE.Mesh(new THREE.ConeGeometry(.46, .7, 16, 1, true), clothM); tunic.position.y = .78; grp.add(tunic); }
    return { group: grp, parts: { armL, armR, legL, legR, torso } };
  }

  // ── Player ───────────────────────────────────────────────
  const player = buildPerson({ hue: look.hue, skinColor: SKINS[look.skin], style: look.style });
  player.group.position.set(0, 0, RZ - 2.2);
  player.group.rotation.y = Math.PI; // face into room (-z)
  scene.add(player.group);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(.5, 20), new THREE.MeshBasicMaterial({ color: '#0c2220', transparent: true, opacity: .28 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = .08; scene.add(blob);

  // ── NPC stylist (back center) ────────────────────────────
  const npc = buildPerson({ hue: npcInfo.hue, skinColor: SKINS[2], style: 'minimal' });
  npc.group.position.set(0, 0, -RZ + 1.8);
  scene.add(npc.group);
  const npcLabel = makeLabel(npcInfo.name, (opts.lang === 'en' ? 'Advisor' : 'Tư vấn'), 1.9);
  npcLabel.position.set(0, 2.5, -RZ + 1.8); scene.add(npcLabel);
  const npcMarker = new THREE.Mesh(new THREE.TorusGeometry(.42, .07, 8, 20), new THREE.MeshBasicMaterial({ color: hsl(npcInfo.hue, .7, .6) }));
  npcMarker.position.set(0, 3.15, -RZ + 1.8); scene.add(npcMarker);

  // ── Product displays ─────────────────────────────────────
  const pois = [{ id: '__exit', type: 'exit', pos: new THREE.Vector3(0, 0, RZ - .4), trig: 2.0 },
                { id: '__npc', type: 'npc', pos: new THREE.Vector3(0, 0, -RZ + 1.8), trig: 2.4 }];
  const markers = [npcMarker];
  const slots = [
    [-2.9, -4.2], [2.9, -4.2],
    [-2.9, -1.4], [2.9, -1.4],
    [-2.9, 1.4], [2.9, 1.4],
  ];
  products.slice(0, 6).forEach((p, i) => {
    const [x, z] = slots[i]; const side = x < 0 ? 1 : -1;
    const g = new THREE.Group(); g.position.set(x, 0, z);
    // pedestal
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(.7, .8, 1, 18),
      new THREE.MeshStandardMaterial({ color: '#eee7d8', roughness: .7 }));
    ped.position.y = .5; ped.castShadow = true; ped.receiveShadow = true; g.add(ped);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.74, .74, .12, 18),
      new THREE.MeshStandardMaterial({ color: hsl(shopHue, .4, .55), roughness: .5 }));
    top.position.y = 1.06; g.add(top);
    // garment form (dress/torso) tinted to product color
    const col = new THREE.Color(p.color || '#cfd8d2');
    const formMat = new THREE.MeshStandardMaterial({ color: col, roughness: .75 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.28, .52, 1.2, 14), formMat);
    body.position.y = 1.85; body.castShadow = true; g.add(body);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(.3, 14, 12), formMat); shoulder.position.y = 2.4; shoulder.scale.set(1, .7, 1); g.add(shoulder);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .2, 8), new THREE.MeshStandardMaterial({ color: '#c9b79c', roughness: .8 })); neck.position.y = 2.62; g.add(neck);
    // marker
    const mk = new THREE.Mesh(new THREE.TorusGeometry(.4, .06, 8, 20), new THREE.MeshBasicMaterial({ color: hsl(shopHue, .7, .62) }));
    mk.position.set(0, 3.15, 0); g.add(mk); markers.push(mk);
    // label
    const lab = makeLabel(p.name, p.price, 2.0);
    lab.position.set(x - side * 0, 1.0, z + 1.0);
    lab.userData.anchor = new THREE.Vector3(x, 3.0, z);
    scene.add(lab);
    scene.add(g);
    pois.push({ id: p.id, type: 'product', pos: new THREE.Vector3(x, 0, z), trig: 2.2 });
    // reposition label above pedestal
    lab.position.set(x, 3.7, z);
  });

  const blockers = pois.filter(p => p.type !== 'exit').map(p => ({ pos: p.pos, r: p.type === 'npc' ? 1.0 : 1.1 }));

  // ── Input: keyboard + joystick ───────────────────────────
  const keys = {};
  const onKey = (e, d) => { const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { keys[k] = d; e.preventDefault(); } };
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);

  const joy = { active: false, id: null, x: 0, y: 0 };
  const base = document.createElement('div'); base.className = 'v-joy-base';
  const knob = document.createElement('div'); knob.className = 'v-joy-knob';
  base.appendChild(knob); container.appendChild(base);
  const JR = 52;
  function jStart(e) { joy.active = true; joy.id = e.pointerId; const r = base.getBoundingClientRect(); joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2; base.setPointerCapture(e.pointerId); jMove(e); }
  function jMove(e) { if (!joy.active || e.pointerId !== joy.id) return; let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy; const d = Math.hypot(dx, dy) || 1; if (d > JR) { dx = dx / d * JR; dy = dy / d * JR; } knob.style.transform = `translate(${dx}px,${dy}px)`; joy.x = dx / JR; joy.y = dy / JR; }
  function jEnd(e) { if (e.pointerId !== joy.id) return; joy.active = false; joy.x = 0; joy.y = 0; knob.style.transform = 'translate(0,0)'; }
  base.addEventListener('pointerdown', jStart); base.addEventListener('pointermove', jMove);
  base.addEventListener('pointerup', jEnd); base.addEventListener('pointercancel', jEnd);

  // ── Orbit camera (drag to rotate 360°, pinch / wheel to zoom) ─
  let camYaw = 0, camElev = 0.6, camDist = 11;
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
      if (orbit.lastDist) camDist = Math.max(6, Math.min(18, camDist - (d - orbit.lastDist) * 0.05));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.2, Math.min(1.2, camElev + dy * 0.005));
    }
  }
  function camUp(e) { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; }
  dom.addEventListener('pointerdown', camDown); dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp); dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = Math.max(6, Math.min(18, camDist + e.deltaY * 0.015)); e.preventDefault(); };
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = 5.4;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
  let phase = 0, near = null, raf = 0, last = performance.now(), running = true;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz); const moving = mag > .08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    if (moving) {
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      const mvx = rgtX * ix + fwdX * (-iz), mvz = rgtZ * ix + fwdZ * (-iz);
      pp.x += mvx * SPEED * dt; pp.z += mvz * SPEED * dt;
      pp.x = Math.max(-RX + .7, Math.min(RX - .7, pp.x));
      pp.z = Math.max(-RZ + .7, Math.min(RZ - .4, pp.z));
      blockers.forEach(b => { const dx = pp.x - b.pos.x, dz = pp.z - b.pos.z; const dd = Math.hypot(dx, dz) || 1; if (dd < b.r) { pp.x = b.pos.x + dx / dd * b.r; pp.z = b.pos.z + dz / dd * b.r; } });
      const tr = Math.atan2(mvx, mvz); let diff = ((tr - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI; player.group.rotation.y += diff * Math.min(1, dt * 12);
    }
    const sp = moving ? mag : 0; phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const sw = moving ? .7 * sp : 0; const ease = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 14);
    ease(player.parts.legL, Math.sin(phase) * sw); ease(player.parts.legR, -Math.sin(phase) * sw);
    ease(player.parts.armL, -Math.sin(phase) * sw * .7); ease(player.parts.armR, Math.sin(phase) * sw * .7);
    player.parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * .04 : 0);
    blob.position.set(pp.x, .08, pp.z);

    // NPC idle + look at player
    npc.parts.torso.position.y = 1.05 + Math.sin(t * 1.3) * .02;
    npc.group.rotation.y = Math.atan2(pp.x - npc.group.position.x, pp.z - npc.group.position.z);

    // camera follow (orbit)
    const offX = camDist * Math.cos(camElev) * Math.sin(camYaw);
    const offZ = camDist * Math.cos(camElev) * Math.cos(camYaw);
    const offY = camDist * Math.sin(camElev);
    camTarget.set(pp.x + offX, pp.y + offY, pp.z + offZ);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    tmp.set(pp.x * .6, 1.4, pp.z * .6 - .5); camera.lookAt(tmp);

    // billboards face camera
    labels.forEach(l => l.quaternion.copy(camera.quaternion));
    markers.forEach((m, i) => { m.rotation.z = t * 1.2 + i; });
    npcMarker.position.y = 3.15 + Math.sin(t * 1.6) * .12;
    arch.material.color = hsl(shopHue, .6, .58 + Math.sin(t * 2) * .06);

    // proximity
    let best = null, bestD = Infinity;
    pois.forEach(it => { const d = Math.hypot(pp.x - it.pos.x, pp.z - it.pos.z); if (d < it.trig && d < bestD) { bestD = d; best = it; } });
    const id = best ? best.id : null;
    if (id !== (near && near.id)) { near = best; opts.onProximity && opts.onProximity(best ? { id: best.id, type: best.type } : null); }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); });
  ro.observe(container);

  return {
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
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
