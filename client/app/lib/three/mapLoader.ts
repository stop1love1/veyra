// @ts-nocheck -- Veyra DATA-DRIVEN 3D world builder.
//
// createVeyraWorldFromMap(container, opts) -> { dispose, recenter, setLang }
//   opts: {
//     map,        // map definition (environment, bounds, spawnPoints,
//                 //   shopSlots[], npcSlots[], tileSize)
//     instances,  // [{ itemId, transform:{pos,rot,scale}, layer, shadow }]
//     items,      // { [itemId]: { glbUrl, collision, scale } }
//     shops,      // [{ id, hue, name }] resolved shop info for shopSlots
//     playerHue, lite, onProximity(poi|null), onCoin(n), onReady?()
//   }
//
// This mirrors worldKit.createVeyraWorld's public contract + runtime
// (player avatar, keyboard/joystick controls, orbit camera, coins, minimap,
// proximity → onProximity, onReady, dispose) but assembles the scene from a
// server-published map (docs/server/DESIGN.md §5) instead of the hard-coded
// Kenney layout. GLBs are preloaded by URL through the generalized kit loader
// (shared/assets.ts preloadUrls/getByUrl). It degrades gracefully: any item
// whose GLB failed to load is skipped, so a partial map still assembles.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { hsl } from './shared/helpers';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createKitLoader } from './shared/assets';

// ── small helpers ──────────────────────────────────────────────────────────
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const col = (v, d) => { try { return v ? new THREE.Color(v) : new THREE.Color(d); } catch { return new THREE.Color(d); } };

export function createVeyraWorldFromMap(container, opts) {
  opts = opts || {};
  const map = opts.map || {};
  const instances = Array.isArray(opts.instances) ? opts.instances : [];
  const items = opts.items || {};
  const shopsIn = opts.shops || [];
  const playerHue = opts.playerHue != null ? opts.playerHue : 184;

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

  // ── Map-driven constants (with sane fallbacks) ───────────────────────────
  const TILE = num(map.tileSize, 7);
  const OUTER_R0 = num(map.bounds && map.bounds.outerRadius, 30 * TILE);
  let OUTER_R = OUTER_R0;
  const env = map.environment || {};

  // ── Quality tier ─────────────────────────────────────────
  let q = detectQuality();
  if (opts.lite) q = { ...q, tier: 'low', shadowMapSize: 0, propDensity: 0.4, maxPixelRatio: 1, pixelRatio: 1, anisotropy: 1 };

  // ── Renderer ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  q = opts.lite ? q : detectQuality(renderer);
  applyQualityToRenderer(renderer, q);
  renderer.setSize(W(), H());
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // ── Scene + camera ───────────────────────────────────────
  const SKY_COLOR = col(env.skyColor, '#9fd4ea');
  const FOG_COLOR = col(env.fog && env.fog.color, '#bfe0d8');
  renderer.setClearColor(SKY_COLOR, 1);
  const scene = new THREE.Scene();
  scene.background = SKY_COLOR;
  scene.fog = new THREE.Fog(FOG_COLOR, num(env.fog && env.fog.near, 180), num(env.fog && env.fog.far, 900));

  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 2000);
  camera.position.set(0, 90, 200);

  // ── Lighting: hemi + sun + optional RoomEnvironment IBL ──
  const hemi = new THREE.HemisphereLight('#eaf6ff', '#6f8a6a', 1.05);
  scene.add(hemi);
  const sunCfg = env.sun || {};
  const sun = new THREE.DirectionalLight(col(sunCfg.color, '#fff2da'), num(sunCfg.intensity, 2.1));
  // place the sun from azimuth/elevation if provided, else a fixed default.
  if (sunCfg.azimuth != null || sunCfg.elevation != null) {
    const az = num(sunCfg.azimuth, 0.6), el = num(sunCfg.elevation, 1.0), R = 260;
    sun.position.set(Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R);
  } else {
    sun.position.set(120, 220, 90);
  }
  if (q.shadowMapSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const d = 220;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 800 });
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun);
  scene.add(sun.target);

  let envRT = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (env.ibl !== 'none') {
    const roomEnv = new RoomEnvironment();
    envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    if (roomEnv.dispose) roomEnv.dispose();
  }

  // ── State containers ─────────────────────────────────────
  const circles = [];        // collision blockers: { x, z, r }
  const interactables = [];  // { id, type, name, hue?, pos, trig, marker, markerBaseY }
  const coins = [];
  let disposed = false;
  let started = false;

  // ── Player avatar ────────────────────────────────────────
  const player = buildAvatar({ hue: playerHue, style: opts.playerStyle });
  scene.add(player.group);
  const parts = player.parts;

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);

  // ── Kit loader (URL path) ────────────────────────────────
  const kit = createKitLoader();

  // resolve each item's GLB url (accept glbUrl or glb).
  const itemUrl = (def) => (def && (def.glbUrl || def.glb)) || null;
  // unique URLs referenced by this map's items.
  const urls = [];
  for (const id of Object.keys(items)) {
    const u = itemUrl(items[id]);
    if (u) urls.push(u);
  }

  // spawn point (first one, else avenue mouth default)
  const spawn = (Array.isArray(map.spawnPoints) && map.spawnPoints[0]) || { pos: { x: 0, z: (3.5) * TILE }, ry: Math.PI };
  const SPAWN_X = num(spawn.pos && spawn.pos.x, 0);
  const SPAWN_Z = num(spawn.pos && spawn.pos.z, 3.5 * TILE);
  const SPAWN_RY = num(spawn.ry, Math.PI);

  // footprint radius (world units) of a placed piece, for collision.
  function footprintR(obj) {
    const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    return Math.max(s.x, s.z) / 2;
  }

  // place a clone of an item at a transform, return the placed object (or null).
  function placeInstance(group, inst) {
    const def = items[inst.itemId];
    const url = itemUrl(def);
    if (!url || !kit.hasUrl(url)) return null;
    const o = kit.getByUrl(url);
    const tr = inst.transform || {};
    const p = tr.pos || {};
    const r = tr.rot || {};
    const scale = num(tr.scale, num(def.scale, TILE));
    o.position.set(num(p.x, 0), num(p.y, 0), num(p.z, 0));
    o.rotation.set(num(r.x, 0), num(r.y, 0), num(r.z, 0));
    o.scale.setScalar(scale);
    // per-instance / skyline pieces opt out of shadows for cost.
    if (inst.shadow === false || inst.layer === 'skyline') {
      o.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; } });
    }
    group.add(o);
    return o;
  }

  // derive a collision circle for a placed instance from item.collision (+ size).
  function collisionFor(inst, placed) {
    const def = items[inst.itemId] || {};
    const c = def.collision || {};
    const p = (inst.transform && inst.transform.pos) || {};
    const cx = num(p.x, 0), cz = num(p.z, 0);
    if (c.type === 'none' || inst.layer === 'skyline' || inst.layer === 'ground' || inst.layer === 'roads') return null;
    let r;
    if (c.type === 'circle' && c.radius != null) {
      // collision radius is authored in item-local (unscaled mesh) units → scale
      // to world by the same world scale applied to the mesh in placeInstance.
      const scale = num(inst.transform && inst.transform.scale, num(def.scale, TILE));
      r = c.radius * scale;
    } else if (c.type === 'box' && c.half) {
      const scale = num(inst.transform && inst.transform.scale, num(def.scale, TILE));
      r = Math.max(num(c.half.x, 0), num(c.half.z, 0)) * scale;
    } else {
      r = placed ? footprintR(placed) : TILE * 0.5;
    }
    return { x: cx, z: cz, r: r + 1.0 };
  }

  // ── Build the world from the map data ────────────────────
  function build() {
    if (disposed) return;
    const world = new THREE.Group();
    scene.add(world);

    // ground plane (always present so the floor isn't void).
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ color: 0x7fae5f, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // place every instance; register collisions.
    let maxR = 0;
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const placed = placeInstance(world, inst);
      if (!placed) continue;
      const cc = collisionFor(inst, placed);
      if (cc) circles.push(cc);
      const p = (inst.transform && inst.transform.pos) || {};
      maxR = Math.max(maxR, Math.hypot(num(p.x, 0), num(p.z, 0)));
    }
    // play radius: prefer authored bounds, else fit to what we placed. Floor the
    // auto-fit result so a map whose every GLB failed to load (maxR=0) doesn't
    // box the player into a tiny ~17u bubble on the empty ground plane.
    OUTER_R = OUTER_R0 > 0 ? OUTER_R0 : Math.max(maxR + TILE * 2.5, 30 * TILE);

    // ── Shops attached at shopSlots ──────────────────────────
    const shopSlots = Array.isArray(map.shopSlots) ? map.shopSlots : [];
    const realCount = Math.min(shopsIn.length, shopSlots.length);
    for (let i = 0; i < realCount; i++) {
      const slot = shopSlots[i];
      const info = shopsIn[i];
      const sx = num(slot.pos && slot.pos.x, 0), sz = num(slot.pos && slot.pos.z, 0);
      const ry = num(slot.ry, 0);
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const er = TILE * 1.2 + 3.0;
      const ent = new THREE.Vector3(sx + fx * er, 0, sz + fz * er);
      const my = TILE * 2.6;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.5 * TILE * 0.4, 0.06 * TILE * 0.4, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(info.hue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(sx + fx * (er * 0.5), my, sz + fz * (er * 0.5));
      scene.add(marker);
      interactables.push({ id: info.id, type: 'shop', name: info.name, hue: info.hue, pos: ent, trig: TILE * 0.9, marker, markerBaseY: my });
    }

    // ── POI kiosks (quests + cart) near the centre ───────────
    function poiKiosk(x, z, accentHue, info) {
      const my = TILE * 1.8;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 * TILE * 0.4, 0.06 * TILE * 0.4, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(accentHue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(x, my, z); scene.add(marker);
      circles.push({ x, z, r: TILE * 0.5 });
      interactables.push({ id: info.id, type: info.type, name: info.name, pos: new THREE.Vector3(x, 0, z), trig: TILE * 0.85, marker, markerBaseY: my });
    }
    const kioskR = TILE * 2.3;
    poiKiosk(-kioskR, kioskR, 45, { id: 'quests', type: 'quests', name: 'Quests' });
    poiKiosk(kioskR, kioskR, playerHue, { id: 'cart', type: 'cart', name: 'Cart' });

    // ── Coins scattered within the walkable radius ───────────
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
    function spawnCoin(x, z) {
      const g = new THREE.Group(); g.position.set(x, TILE * 0.5, z);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * TILE * 0.45, 0.32 * TILE * 0.45, 0.06 * TILE * 0.45, 18), coinMat);
      c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
      scene.add(g); coins.push({ g, base: TILE * 0.5, x, z });
    }
    const coinN = Math.round(22 * q.propDensity);
    const coinR = Math.min(OUTER_R * 0.7, (8) * TILE);
    // A coin inside a building footprint is unreachable: the collision solver
    // clamps the player to b.r + 0.9 from the blocker centre, and pickup needs
    // dist < TILE*0.4. So reject any candidate closer than b.r + 0.9 + TILE*0.4
    // to a blocker; retry a few times, then skip if we can't find clear ground.
    const coinClear = (x, z) => {
      for (let ci = 0; ci < circles.length; ci++) {
        const b = circles[ci];
        if (Math.hypot(x - b.x, z - b.z) < b.r + 0.9 + TILE * 0.4) return false;
      }
      return true;
    };
    for (let i = 0; i < coinN; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 8 && !placed; attempt++) {
        const ang = (i / coinN) * Math.PI * 2 + Math.random() * 0.6;
        const rr = TILE * 2 + Math.random() * coinR;
        const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
        if (coinClear(x, z)) { spawnCoin(x, z); placed = true; }
      }
    }

    sun.target.position.set(0, 0, 0);

    // place the player at the spawn point.
    player.group.position.set(SPAWN_X, 0, SPAWN_Z);
    player.group.rotation.y = SPAWN_RY;
    blob.position.set(SPAWN_X, 0.05, SPAWN_Z);

    camYaw = 0; camElev = 0.5; camDist = TILE * 5;
    mini.style.display = 'block';

    started = true;
    opts.onReady && opts.onReady();
  }

  // preload by URL, then build.
  kit.preloadUrls(urls).then(() => {
    if (disposed) { kit.dispose(); return; }
    build();
  }).catch(() => {
    kit.dispose();
    if (!disposed) {
      // even with zero GLBs we still show the ground + markers + player.
      try { build(); } catch (_) { started = true; opts.onReady && opts.onReady(); }
    }
  });

  // ── Input: keyboard + joystick (shared) ──────────────────
  const kb = createKeyboard();
  const stick = createJoystick(container);
  const keys = kb.keys, joy = stick.joy;

  // ── Orbit camera (drag rotate, pinch / wheel zoom) ───────
  let camYaw = 0, camElev = 0.5, camDist = TILE * 5;
  const CAM_MIN = TILE * 2.2, CAM_MAX = TILE * 12;
  const dom = renderer.domElement;
  const orbit = { pointers: new Map(), lastDist: 0 };
  const camDown = (e) => { orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { dom.setPointerCapture(e.pointerId); } catch (_) {} };
  const camMove = (e) => {
    if (!orbit.pointers.has(e.pointerId)) return;
    const prev = orbit.pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    orbit.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (orbit.pointers.size >= 2) {
      const pts = [...orbit.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (orbit.lastDist) camDist = Math.max(CAM_MIN, Math.min(CAM_MAX, camDist - (d - orbit.lastDist) * 0.12));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.12, Math.min(1.05, camElev + dy * 0.005));
    }
  };
  const camUp = (e) => { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; };
  dom.addEventListener('pointerdown', camDown); dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp); dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = Math.max(CAM_MIN, Math.min(CAM_MAX, camDist + e.deltaY * 0.06)); e.preventDefault(); };
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── Minimap ──────────────────────────────────────────────
  const mini = document.createElement('canvas');
  mini.className = 'v-minimap'; mini.width = 120; mini.height = 120;
  container.appendChild(mini); mini.style.display = 'none';
  const mctx = mini.getContext('2d');
  const dotColor = (it) => it.type === 'shop' ? '#' + hsl(it.hue, 0.5, 0.62).getHexString()
    : it.type === 'quests' ? '#f0c860' : '#7fe0d0';
  function drawMinimap() {
    const px = player.group.position.x, pz = player.group.position.z;
    mctx.clearRect(0, 0, 120, 120);
    mctx.save();
    mctx.beginPath(); mctx.arc(60, 60, 57, 0, 7); mctx.closePath();
    mctx.fillStyle = 'rgba(9,26,26,.62)'; mctx.fill(); mctx.clip();
    const sc = 57 / Math.max(120, OUTER_R);
    interactables.forEach((it) => {
      const dx = it.pos.x - px, dz = it.pos.z - pz;
      const ang = Math.atan2(dx, dz) - (camYaw + Math.PI);
      let d = Math.hypot(dx, dz) * sc; d = Math.min(d, 53);
      const sx = 60 + Math.sin(ang) * d, sy = 60 - Math.cos(ang) * d;
      mctx.fillStyle = dotColor(it);
      mctx.beginPath(); mctx.arc(sx, sy, it.type === 'shop' ? 4.5 : 3.5, 0, 7); mctx.fill();
    });
    mctx.restore();
    mctx.fillStyle = '#eafcf8';
    mctx.beginPath(); mctx.moveTo(60, 52); mctx.lineTo(55, 65); mctx.lineTo(60, 61); mctx.lineTo(65, 65); mctx.closePath(); mctx.fill();
  }

  // ── Gentle day-light tint cycle ──────────────────────────
  const DAY_PERIOD = 280;
  let dayClock = DAY_PERIOD * 0.34, todAccum = 0;

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = TILE * 0.85;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), camPos = new THREE.Vector3();
  let phase = 0, near = null, raf = 0, last = performance.now(), running = true, miniAccum = 0;

  function step(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz);
    const moving = started && mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    if (moving) {
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      const mvx = rgtX * ix + fwdX * (-iz);
      const mvz = rgtZ * ix + fwdZ * (-iz);
      pp.x += mvx * SPEED * dt; pp.z += mvz * SPEED * dt;

      const pr = Math.hypot(pp.x, pp.z);
      if (pr > OUTER_R) { const s = OUTER_R / pr; pp.x *= s; pp.z *= s; }

      const rad = 0.9;
      for (let ci = 0; ci < circles.length; ci++) {
        const b = circles[ci];
        const dx = pp.x - b.x, dz = pp.z - b.z; const dd = Math.hypot(dx, dz) || 1;
        if (dd < b.r + rad) { pp.x = b.x + dx / dd * (b.r + rad); pp.z = b.z + dz / dd * (b.r + rad); }
      }

      const targetRot = Math.atan2(mvx, mvz);
      let diff = ((targetRot - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.group.rotation.y += diff * Math.min(1, dt * 12);
    }

    const sp = moving ? mag : 0;
    phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const swing = moving ? 0.7 * sp : 0;
    const ease = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 14);
    ease(parts.legL, Math.sin(phase) * swing);
    ease(parts.legR, -Math.sin(phase) * swing);
    ease(parts.armL, -Math.sin(phase) * swing * 0.7);
    ease(parts.armR, Math.sin(phase) * swing * 0.7);
    parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : 0);
    blob.position.set(pp.x, 0.05, pp.z);

    const offX = camDist * Math.cos(camElev) * Math.sin(camYaw);
    const offZ = camDist * Math.cos(camElev) * Math.cos(camYaw);
    const offY = camDist * Math.sin(camElev);
    camTarget.set(pp.x + offX, pp.y + offY + 1.2, pp.z + offZ);
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    tmp.set(pp.x, pp.y + TILE * 0.4, pp.z); camera.lookAt(tmp);
    camPos.copy(camera.position);

    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (!it.marker) continue;
      it.marker.rotation.z = t * 1.0 + i;
      it.marker.position.y = it.markerBaseY + Math.sin(t * 1.4 + i) * 0.3;
    }

    for (let ci = coins.length - 1; ci >= 0; ci--) {
      const co = coins[ci];
      co.g.rotation.y += dt * 2.4;
      co.g.position.y = co.base + Math.sin(t * 2 + ci) * 0.3;
      const cd = Math.hypot(pp.x - co.x, pp.z - co.z);
      if (cd < TILE * 0.4) { scene.remove(co.g); co.g.children[0].geometry.dispose(); coins.splice(ci, 1); opts.onCoin && opts.onCoin(5); }
    }

    let best = null, bestD = Infinity;
    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      const d = Math.hypot(pp.x - it.pos.x, pp.z - it.pos.z);
      if (d < (it.trig || 4) && d < bestD) { bestD = d; best = it; }
    }
    const id = best ? best.id : null;
    if (id !== (near && near.id)) {
      near = best;
      opts.onProximity && opts.onProximity(best ? { id: best.id, name: best.name, type: best.type } : null);
    }

    dayClock += dt; todAccum += dt;
    if (todAccum > 0.5) {
      const cyc = (dayClock % (DAY_PERIOD * 2)) / DAY_PERIOD;
      const tod = cyc <= 1 ? cyc : 2 - cyc;
      const warm = 0.5 + 0.5 * Math.cos((tod - 0.5) * Math.PI);
      sun.color.setHSL(0.09 + warm * 0.02, 0.4, 0.62 - warm * 0.06);
      sun.intensity = 1.5 + tod * 1.0;
      hemi.intensity = 0.7 + tod * 0.6;
      todAccum = 0;
    }

    miniAccum += dt;
    if (miniAccum > 0.12) { drawMinimap(); miniAccum = 0; }

    renderer.render(scene, camera);
    raf = requestAnimationFrame(step);
  }
  raf = requestAnimationFrame(step);

  // ── Pause when tab hidden ────────────────────────────────
  const onVis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(step); }
  };
  document.addEventListener('visibilitychange', onVis);

  // ── Resize ───────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
  });
  ro.observe(container);

  // ── API (same contract as worldKit.createVeyraWorld) ─────
  return {
    dispose() {
      disposed = true;
      running = false; cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      kb.dispose(); stick.dispose();
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      disposeScene(scene);
      kit.dispose();
      if (envRT) envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    recenter() {
      player.group.position.set(SPAWN_X, 0, SPAWN_Z);
      player.group.rotation.y = SPAWN_RY;
    },
    // Relabel shop interactables when the UI language changes. `names` is a
    // { [shopId]: localizedName } map; the proximity prompt is re-fired so the
    // currently-near label updates immediately without a scene remount.
    setLang(names) {
      if (!names) return;
      for (let i = 0; i < interactables.length; i++) {
        const it = interactables[i];
        if (it.type === 'shop' && names[it.id] != null) it.name = names[it.id];
      }
      if (near) opts.onProximity && opts.onProximity({ id: near.id, name: near.name, type: near.type });
    },
  };
}
