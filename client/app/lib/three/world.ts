// @ts-nocheck -- Veyra walkable 3D world: realistic open-air commercial district.
// createVeyraWorld(container, opts) -> { dispose, recenter, setLang }
// opts: { playerHue, lite, shops:[{id,hue,name}], onProximity(poi|null), onCoin(n) }
//
// Flagship "true-to-life" world. A large central plaza with FIVE grand avenues
// radiating out, lined with realistic storefronts, greenery between them.
// Composes shared modules: quality / environment / materials / postfx /
// buildings / streetprops / controls / avatar / dispose / helpers.

import * as THREE from 'three';
import { hsl } from './shared/helpers';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createEnvironment } from './shared/environment';
import { createMaterials } from './shared/materials';
import { createComposer } from './shared/postfx';
import { createBuildings } from './shared/buildings';
import { createStreetProps } from './shared/streetprops';

export function createVeyraWorld(container, opts) {
  opts = opts || {};
  const shopsIn = opts.shops || [];
  const playerHue = opts.playerHue != null ? opts.playerHue : 184;

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

  // ── Quality tier ─────────────────────────────────────────
  let q = detectQuality();
  if (opts.lite) q = { ...q, tier: 'low', enablePost: false, enableSSAO: false, enableBloom: false, shadowMapSize: 0, propDensity: 0.4, maxPixelRatio: 1, pixelRatio: 1, anisotropy: 1 };

  // ── Renderer ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: !q.enablePost, powerPreference: 'high-performance' });
  q = opts.lite ? q : detectQuality(renderer);
  if (opts.lite) q.enablePost = false;
  applyQualityToRenderer(renderer, q);
  renderer.setSize(W(), H());
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // ── Scene + camera ───────────────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 700);
  camera.position.set(0, 16, 36);

  // ── Environment (sky/sun/IBL/tonemap/fog) ────────────────
  const environment = createEnvironment(renderer, scene, { quality: q });

  // ── Materials (PBR). Reflections come from scene.environment (auto). ─────────
  const mats = createMaterials({ anisotropy: q.anisotropy });

  // ── Post-processing composer (adaptive) ──────────────────
  const post = createComposer(renderer, scene, camera, { quality: q });

  // ── Builders ─────────────────────────────────────────────
  const buildings = createBuildings(mats);
  const props = createStreetProps(mats);
  const density = q.propDensity;

  // ── Layout constants (meters) ────────────────────────────
  const SQUARE_R = 50;          // big central plaza
  const LANE_HALF = 9;          // half-width of an avenue
  const BUILD_DEPTH = 7, BUILD_W = 8;
  const LAT = LANE_HALF + BUILD_DEPTH / 2 + 1.5;  // lateral offset of storefronts from avenue centre
  const ROAD_N = 5;
  const ROAD_BASE = Math.PI / 2;                  // avenue 0 points +Z (the arrival road)
  const ROAD_STEP = (Math.PI * 2) / ROAD_N;
  const ROAD_LEN = 120;

  const circles = [];        // collision: { x, z, r }
  const interactables = [];  // { id, type, name, pos, trig, marker?, markerBaseY? }

  // rotate a road-local (lx,lz) point into world space for avenue at angle `a`
  const roadYaw = (a) => Math.PI / 2 - a;
  function toWorld(a, lx, lz) {
    const th = roadYaw(a), c = Math.cos(th), s = Math.sin(th);
    return { x: lx * c + lz * s, z: -lx * s + lz * c };
  }

  // ── Ground (parkland green; fog hides the far edge) ──────
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x6f8a55, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(480, 80), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // central paved plaza
  const square = new THREE.Mesh(new THREE.CircleGeometry(SQUARE_R, 96), mats.paving);
  square.rotation.x = -Math.PI / 2; square.position.y = 0.015; square.receiveShadow = true; scene.add(square);
  const squareRing = new THREE.Mesh(new THREE.TorusGeometry(SQUARE_R - 3, 0.22, 8, 120), mats.curb);
  squareRing.rotation.x = -Math.PI / 2; squareRing.position.y = 0.05; squareRing.receiveShadow = true; scene.add(squareRing);

  // ── Five avenues radiating from the plaza ────────────────
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x86a85f, roughness: 1, metalness: 0 });
  const slots = [];   // { a, lx, lz, side, world:{x,z}, rotYlocal }

  for (let k = 0; k < ROAD_N; k++) {
    const a = ROAD_BASE + k * ROAD_STEP;
    const g = new THREE.Group(); g.rotation.y = roadYaw(a); scene.add(g);

    // paved avenue (runs along local +Z, from the plaza edge outward)
    const laneW = LANE_HALF * 2;
    const startZ = SQUARE_R - 8;
    const pav = new THREE.Mesh(new THREE.PlaneGeometry(laneW, ROAD_LEN), mats.paving);
    pav.rotation.x = -Math.PI / 2; pav.position.set(0, 0.012, startZ + ROAD_LEN / 2); pav.receiveShadow = true; g.add(pav);
    // a subtle central seam
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, ROAD_LEN - 8), mats.curb);
    seam.rotation.x = -Math.PI / 2; seam.position.set(0, 0.02, startZ + ROAD_LEN / 2); g.add(seam);
    // curbs both sides
    [-1, 1].forEach((sd) => {
      const cb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, ROAD_LEN), mats.curb);
      cb.position.set(sd * (LANE_HALF + 0.2), 0.09, startZ + ROAD_LEN / 2); cb.castShadow = true; cb.receiveShadow = true; g.add(cb);
    });

    // storefront slots both sides
    const spacing = BUILD_W + 3;
    const count = Math.max(3, Math.min(7, Math.round((ROAD_LEN / spacing) * density)));
    for (let i = 0; i < count; i++) {
      const lz = SQUARE_R + 4 + i * spacing + spacing / 2;
      [-1, 1].forEach((side) => {
        const lx = side * LAT;
        slots.push({ a, group: g, lx, lz, side, rotYlocal: -side * Math.PI / 2, world: toWorld(a, lx, lz) });
      });
    }

    // a tidy lawn + trees in the wedge clockwise of this avenue
    const wa = a + ROAD_STEP / 2;
    const lr = 16, ld = SQUARE_R + 22;
    const lx0 = Math.cos(wa) * ld, lz0 = Math.sin(wa) * ld;
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(lr, 40), lawnMat);
    lawn.rotation.x = -Math.PI / 2; lawn.position.set(lx0, 0.02, lz0); lawn.receiveShadow = true; scene.add(lawn);
    const lawnTrees = Math.max(1, Math.round(3 * density));
    for (let t = 0; t < lawnTrees; t++) {
      const ta = wa + (t - 1) * 0.5, tr = lr * 0.5 + (t % 2) * 3;
      const tx = Math.cos(wa) * ld + Math.cos(ta) * tr, tz = Math.sin(wa) * ld + Math.sin(ta) * tr;
      const tree = props.tree(1.1 + (t % 3) * 0.25); tree.position.set(tx, 0, tz); scene.add(tree);
    }
  }

  // ── Storefront placement ─────────────────────────────────
  const GEN_HUES = [28, 200, 150, 210, 46, 12, 190, 36, 96, 220, 18, 168];
  // Plausible retail names so EVERY storefront carries a sign (reads as a mall).
  const GENERIC_NAMES = ['Aria', 'Lumen', 'Maison', 'Noir', 'Bloom', 'Stitch', 'Vélo', 'Terra',
    'Lush', 'Mono', 'Aura', 'Form', 'Nova', 'Haven', 'Édit', 'Linen', 'Pace', 'Onyx', 'Mode', 'Lóa'];
  let gi = 0;
  // deterministic per-position pseudo-random so the street is varied but stable
  const hash01 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

  function placeStorefront(slot, hue, real, info) {
    // per-building variety so the frontage doesn't read as a copy-paste loop
    const h1 = hash01(slot.world.x, slot.world.z);
    const h2 = hash01(slot.world.z + 7.7, slot.world.x);
    const h3 = hash01(slot.world.x * 1.7 + 3.3, slot.world.z * 0.9);
    const width = real ? 9 : 6 + Math.floor(h1 * 5);       // 6..10 (≤ spacing, no overlap)
    const depth = BUILD_DEPTH - 0.8 + h2 * 2.2;            // ~6.2..8.4
    const floors = real ? 3 : 2 + Math.floor(h3 * 4);     // 2..5 → varied skyline
    const jz = (h2 - 0.5) * 3.0;                            // ±1.5m along the avenue
    const jx = slot.side * h3 * 1.4;                        // varied setback

    const sf = buildings.storefront({
      width, depth, floors,
      hue, real, name: info ? info.name : undefined, signHue: real ? hue : undefined,
    });
    const g = sf.group;
    g.position.set(slot.lx + jx, 0, slot.lz + jz);
    g.rotation.y = slot.rotYlocal;       // local: face the avenue centreline
    slot.group.add(g);

    const wpt = toWorld(slot.a, slot.lx + jx, slot.lz + jz);
    const r = Math.max(sf.footprint.w, sf.footprint.d) / 2 + 0.6;
    circles.push({ x: wpt.x, z: wpt.z, r });

    if (real && info) {
      // entrance: in front of the façade, toward the avenue centre
      const ent = toWorld(slot.a, slot.lx + jx - slot.side * (depth / 2 + 1.3), slot.lz + jz);
      const my = (sf.markerAnchor ? sf.markerAnchor.y : 9) + 0.6;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.5, 0.06, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(hue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(wpt.x, my, wpt.z); scene.add(marker);
      interactables.push({ id: info.id, type: 'shop', name: info.name, hue, pos: new THREE.Vector3(ent.x, 0, ent.z), trig: 4.6, marker, markerBaseY: my });
    }
  }

  // flagships nearest the plaza, then fill the rest generically
  slots.sort((p, q2) => (p.world.x ** 2 + p.world.z ** 2) - (q2.world.x ** 2 + q2.world.z ** 2));
  const used = new Set();
  const realCount = Math.min(shopsIn.length, slots.length);
  for (let i = 0; i < realCount; i++) { used.add(slots[i]); placeStorefront(slots[i], shopsIn[i].hue, true, shopsIn[i]); }
  slots.forEach((slot) => {
    if (used.has(slot)) return;
    const hh = hash01(slot.world.x + 11, slot.world.z + 5);
    const hn = hash01(slot.world.z * 2.1, slot.world.x * 1.3 + 9);
    placeStorefront(slot, GEN_HUES[Math.floor(hh * GEN_HUES.length)], false, { name: GENERIC_NAMES[Math.floor(hn * GENERIC_NAMES.length)] });
    gi++;
  });

  // ── Ring of shops enclosing the plaza (between avenue mouths) ──
  // A continuous retail façade facing inward, so standing in the plaza you are
  // surrounded by storefronts — the thing that makes it read as a shopping centre.
  const RING_R = SQUARE_R + BUILD_DEPTH / 2 + 1.5;
  const GAP = 0.3;   // keep the avenue mouths clear (radians of half-gap)
  let rgi = 5;
  for (let k = 0; k < ROAD_N; k++) {
    const a0 = ROAD_BASE + k * ROAD_STEP + GAP;
    const a1 = ROAD_BASE + (k + 1) * ROAD_STEP - GAP;
    const per = Math.max(2, Math.round(3 * density));
    for (let j = 0; j < per; j++) {
      const phi = a0 + (a1 - a0) * ((j + 0.5) / per);
      const hr1 = hash01(phi * 31.7, k * 5.1), hr2 = hash01(k * 9.3, phi * 17.4);
      const rr = RING_R + (hr2 - 0.5) * 2.4;                 // varied radial setback
      const x = Math.cos(phi) * rr, z = Math.sin(phi) * rr;
      const ry = Math.atan2(-Math.cos(phi), -Math.sin(phi));   // façade faces plaza centre
      const sf = buildings.storefront({
        width: 7 + Math.floor(hr1 * 4),                       // 7..10
        depth: BUILD_DEPTH - 0.5 + hr2 * 1.8,
        floors: 3 + Math.floor(hr1 * 3),                      // 3..5 (taller ring encloses plaza)
        hue: GEN_HUES[Math.floor(hr1 * GEN_HUES.length)], real: false,
        name: GENERIC_NAMES[Math.floor(hr2 * GENERIC_NAMES.length)],
      });
      rgi++;
      sf.group.position.set(x, 0, z); sf.group.rotation.y = ry; scene.add(sf.group);
      circles.push({ x, z, r: Math.max(sf.footprint.w, sf.footprint.d) / 2 + 0.6 });
    }
  }

  // ── Fountain (large plaza centrepiece) ───────────────────
  (function fountain() {
    const g = new THREE.Group();
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.8, 56), mats.concrete);
    basin.position.y = 0.4; basin.castShadow = true; basin.receiveShadow = true; g.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.22, 12, 64), mats.curb);
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.82; g.add(rim);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.95, 4.95, 0.2, 56), mats.water);
    water.position.y = 0.68; g.add(water);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.2, 22), mats.concrete);
    stem.position.y = 2.0; stem.castShadow = true; g.add(stem);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.8, 0.4, 28), mats.concrete);
    bowl.position.y = 3.2; bowl.castShadow = true; g.add(bowl);
    const topWater = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 28), mats.water);
    topWater.position.y = 3.42; g.add(topWater);
    scene.add(g);
    circles.push({ x: 0, z: 0, r: 5.8 });
  })();

  // ── POIs: notice board (quests) + pickup counter (cart) ──
  function poiKiosk(x, z, kind, accentHue) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(0, 0, 0);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 1.2), mats.wood);
    counter.position.y = 0.55; counter.castShadow = true; counter.receiveShadow = true; g.add(counter);
    [[-1.2, -0.5], [1.2, -0.5], [-1.2, 0.5], [1.2, 0.5]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), mats.steelDark);
      p.position.set(px, 1.2, pz); p.castShadow = true; g.add(p);
    });
    const canopy = props.awning(3.0, accentHue); canopy.position.set(0, 2.4, 0.1); g.add(canopy);
    const sign = mats.makeSign(kind === 'quests' ? 'INFO' : 'PICKUP', { width: 2.0, hue: accentHue });
    sign.position.set(0, 1.95, 0.62); g.add(sign);
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.06, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(accentHue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
    );
    marker.position.set(0, 3.1, 0); g.add(marker);
    scene.add(g);
    circles.push({ x, z, r: 1.7 });
    return { marker, markerBaseY: 3.1 };
  }
  {
    const qa = poiKiosk(-26, 18, 'quests', 45);
    interactables.push({ id: 'quests', type: 'quests', name: 'Quests', pos: new THREE.Vector3(-26, 0, 18), trig: 3.8, marker: qa.marker, markerBaseY: qa.markerBaseY });
    const ca = poiKiosk(26, 18, 'cart', playerHue);
    interactables.push({ id: 'cart', type: 'cart', name: 'Cart', pos: new THREE.Vector3(26, 0, 18), trig: 3.8, marker: ca.marker, markerBaseY: ca.markerBaseY });
  }

  // ── Plaza dressing: streetlights along avenues, ring of trees + bollards ──
  function placeProp(group, x, z, rotY) { group.position.set(x, 0, z); if (rotY != null) group.rotation.y = rotY; scene.add(group); }
  for (let k = 0; k < ROAD_N; k++) {
    const a = ROAD_BASE + k * ROAD_STEP;
    const n = Math.max(2, Math.round((ROAD_LEN / 18) * density));
    for (let i = 0; i < n; i++) {
      const lz = SQUARE_R + 6 + i * 18;
      [-1, 1].forEach((side) => {
        const wpt = toWorld(a, side * (LANE_HALF - 0.6), lz);
        placeProp(props.streetlight(), wpt.x, wpt.z, roadYaw(a));
        if (i % 2 === 0) { const b = props.bench(); placeProp(b, toWorld(a, side * (LANE_HALF - 1.2), lz).x, toWorld(a, side * (LANE_HALF - 1.2), lz).z, roadYaw(a) + (side > 0 ? Math.PI : 0)); }
        else { const bn = props.bin(); placeProp(bn, wpt.x, wpt.z); }
      });
    }
  }
  const ringTrees = Math.round(7 * density);
  for (let i = 0; i < ringTrees; i++) {
    const ang = (i / Math.max(1, ringTrees)) * Math.PI * 2 + 0.2;
    // street trees set well inside the plaza so they don't screen the shopfronts
    placeProp(props.tree(1.0 + (i % 3) * 0.3), Math.cos(ang) * (SQUARE_R - 12), Math.sin(ang) * (SQUARE_R - 12));
  }
  const bollardN = Math.round(16 * density);
  for (let i = 0; i < bollardN; i++) {
    const ang = (i / Math.max(1, bollardN)) * Math.PI * 2;
    placeProp(props.bollard(), Math.cos(ang) * (SQUARE_R + 0.6), Math.sin(ang) * (SQUARE_R + 0.6));
  }

  // ── Player avatar ────────────────────────────────────────
  const player = buildAvatar({ hue: playerHue, style: opts.playerStyle });
  player.group.position.set(0, 0, SQUARE_R + 8);   // near the plaza mouth of avenue 0
  player.group.rotation.y = Math.PI;   // face the plaza + fountain (−Z)
  scene.add(player.group);
  const parts = player.parts;

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);

  // ── Collectible coins (scattered along the avenues) ──────
  const coins = [];
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
  function spawnCoin(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0.95, z);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 18), coinMat); c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
    scene.add(g); coins.push({ g, base: 0.95, x, z });
  }
  const coinN = Math.round(22 * density);
  for (let i = 0; i < coinN; i++) {
    const a = ROAD_BASE + (i % ROAD_N) * ROAD_STEP;
    const lz = SQUARE_R + 4 + Math.random() * (ROAD_LEN - 8);
    const lx = (Math.random() - 0.5) * (LANE_HALF * 1.4);
    const w = toWorld(a, lx, lz); spawnCoin(w.x, w.z);
  }

  // ── Input: keyboard + joystick (shared) ──────────────────
  const kb = createKeyboard();
  const stick = createJoystick(container);
  const keys = kb.keys, joy = stick.joy;

  // ── Orbit camera (drag rotate, pinch / wheel zoom) ───────
  let camYaw = 0, camElev = 0.42, camDist = 30;
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
      if (orbit.lastDist) camDist = Math.max(10, Math.min(80, camDist - (d - orbit.lastDist) * 0.1));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.12, Math.min(1.05, camElev + dy * 0.005));
    }
  };
  const camUp = (e) => { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; };
  dom.addEventListener('pointerdown', camDown); dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp); dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = Math.max(10, Math.min(80, camDist + e.deltaY * 0.05)); e.preventDefault(); };
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
    const sc = 57 / 180;
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

  // ── Rain (weather) ───────────────────────────────────────
  const rainN = q.tier === 'low' ? 0 : Math.round(420 * density);
  let rainPts = null;
  if (rainN) {
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) { pos[i * 3] = (Math.random() - 0.5) * 100; pos[i * 3 + 1] = Math.random() * 48; pos[i * 3 + 2] = (Math.random() - 0.5) * 100; }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainPts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xc4d2d6, size: 0.5, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    rainPts.visible = false; scene.add(rainPts);
  }

  // ── Weather + time-of-day cycle (mostly clear & pretty) ──
  const DAY_PERIOD = 260;
  let dayClock = DAY_PERIOD * 0.34, todAccum = 0;
  const WEATHER_PHASES = [
    { overcast: 0.0, rain: 0.0, dur: 95 },
    { overcast: 0.35, rain: 0.0, dur: 30 },
    { overcast: 0.0, rain: 0.0, dur: 75 },
    { overcast: 0.6, rain: 0.5, dur: 22 },
  ];
  let wPhase = 0, wClock = 0;
  environment.setWeather({ overcast: WEATHER_PHASES[0].overcast, rain: WEATHER_PHASES[0].rain });
  let wet = 0, rainAmt = 0;

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = 5.8;
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
    const moving = mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    if (moving) {
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      const mvx = rgtX * ix + fwdX * (-iz);
      const mvz = rgtZ * ix + fwdZ * (-iz);
      pp.x += mvx * SPEED * dt; pp.z += mvz * SPEED * dt;

      const pr = Math.hypot(pp.x, pp.z);
      if (pr > SQUARE_R + ROAD_LEN) { const s = (SQUARE_R + ROAD_LEN) / pr; pp.x *= s; pp.z *= s; }

      const rad = 0.5;
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
    tmp.set(pp.x, pp.y + 1.5, pp.z); camera.lookAt(tmp);
    camPos.copy(camera.position);

    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (!it.marker) continue;
      it.marker.rotation.z = t * 1.0 + i;
      it.marker.position.y = it.markerBaseY + Math.sin(t * 1.4 + i) * 0.12;
    }

    for (let ci = coins.length - 1; ci >= 0; ci--) {
      const co = coins[ci];
      co.g.rotation.y += dt * 2.4;
      co.g.position.y = co.base + Math.sin(t * 2 + ci) * 0.12;
      const cd = Math.hypot(pp.x - co.x, pp.z - co.z);
      if (cd < 1.5) { scene.remove(co.g); co.g.children[0].geometry.dispose(); coins.splice(ci, 1); opts.onCoin && opts.onCoin(5); }
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
      environment.setTimeOfDay(tod);
      const night = tod < 0.12 || tod > 0.88;
      post.setBloom(night ? 0.5 : 0.22);
      todAccum = 0;
    }

    wClock += dt;
    if (wClock >= WEATHER_PHASES[wPhase].dur) {
      wClock = 0; wPhase = (wPhase + 1) % WEATHER_PHASES.length;
      const np = WEATHER_PHASES[wPhase];
      environment.setWeather({ overcast: np.overcast, rain: np.rain });
    }
    const targetRain = WEATHER_PHASES[wPhase].rain;
    wet += (targetRain - wet) * Math.min(1, dt * 0.6);
    rainAmt += (targetRain - rainAmt) * Math.min(1, dt * 0.8);
    mats.setWetness && mats.setWetness(wet);
    if (rainPts) {
      rainPts.visible = rainAmt > 0.04;
      if (rainPts.visible) {
        const arr = rainPts.geometry.attributes.position.array;
        for (let i = 0; i < rainN; i++) { arr[i * 3 + 1] -= dt * 46; if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 48; arr[i * 3] = (Math.random() - 0.5) * 100; arr[i * 3 + 2] = (Math.random() - 0.5) * 100; } }
        rainPts.geometry.attributes.position.needsUpdate = true;
        rainPts.position.set(pp.x, 0, pp.z);
        rainPts.material.opacity = rainAmt * 0.6;
      }
    }

    miniAccum += dt;
    if (miniAccum > 0.12) { drawMinimap(); miniAccum = 0; }

    environment.update(dt, camPos);
    post.render(dt);
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
    post.setSize(W(), H());
  });
  ro.observe(container);

  // ── API ──────────────────────────────────────────────────
  return {
    dispose() {
      running = false; cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      kb.dispose(); stick.dispose();
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      post.dispose();
      environment.dispose();
      mats.dispose();
      disposeScene(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    recenter() { player.group.position.set(0, 0, SQUARE_R + 8); player.group.rotation.y = Math.PI; },
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
