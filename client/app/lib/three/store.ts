// @ts-nocheck -- ported vanilla three.js engine; internals intentionally untyped
// store.ts — Veyra walkable 3D shop interior (three.js ES module).
// createVeyraStore(container, opts) -> { dispose }
// opts: { shopHue, lang, labels:{advisor}, look:{hue,skin,style},
//         npc:{name,hue}, products:[{id,name,price,color}], onProximity(poi|null) }
//
// MULTI-FLOOR re-skin: the boutique is now a small BUILDING. The number of
// floors is derived from the product count — a tiny shop is a single room, a
// medium shop stacks two floors joined by a STAIR flight, and a large shop adds
// a third floor plus a self-driving ELEVATOR. The player walks UP the stairs
// (a per-frame Y-follow along each flight's footprint, like the arched bridge in
// worldHanoi) and can ride the elevator between floors. Collision + proximity
// are FLOOR-AWARE so a pedestal on floor 0 never blocks (or "pings") a player
// standing above it on floor 2.
//
// LOW-POLY re-skin: a clean, cohesive Kenney-kit style BOUTIQUE interior. The
// realistic PBR material library is gone; surfaces are SIMPLE FLAT solid-color
// MeshStandardMaterials in a muted palette tinted by shopHue. Soft image-based
// lighting still comes from RoomEnvironment → PMREM plus simple ceiling fills /
// hemi / ambient + ACES tonemap + subtle post (composer). Indoor counterpart to
// world.ts; it does NOT use the outdoor Sky/sun environment.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { hsl } from './shared/helpers';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick, createOrbitCamera } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createComposer } from './shared/postfx';

export function createVeyraStore(container, opts) {
  opts = opts || {};
  const shopHue = opts.shopHue != null ? opts.shopHue : 184;
  const look = Object.assign({ hue: 184, skin: 1, style: 'minimal' }, opts.look || {});
  const products = opts.products || [];
  const npcInfo = opts.npc || { name: 'Mira', hue: shopHue };
  const SKINS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

  // ── Quality tier ─────────────────────────────────────────
  // Pre-detect (no renderer) to choose construction flags; refine after.
  let q = detectQuality();

  // ── Renderer ─────────────────────────────────────────────
  // When post runs, FXAA handles AA so MSAA is off; otherwise enable it.
  const renderer = new THREE.WebGLRenderer({ antialias: !q.enablePost, powerPreference: 'high-performance' });
  q = detectQuality(renderer); // refine with real GL caps
  applyQualityToRenderer(renderer, q);
  renderer.setSize(W(), H());
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  // ── Scene + camera ───────────────────────────────────────
  const scene = new THREE.Scene();
  // Interior: no distance fog / flat background tint. A faint, neutral fog
  // keeps far corners from reading as a hard cutoff without tinting the room.
  scene.fog = new THREE.Fog(0x20242a, 30, 80);

  const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 160);
  camera.position.set(0, 8, 12);

  // ── Interior IBL (RoomEnvironment → PMREM) ───────────────
  // Gives realistic soft reflections on glass / metal and even fill light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  let roomEnv;
  try { roomEnv = new RoomEnvironment(renderer); } catch (_) { roomEnv = new RoomEnvironment(); }
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  roomEnv.dispose && roomEnv.dispose();

  // ── Low-poly material kit ────────────────────────────────
  // Flat solid-color MeshStandardMaterials (no procedural textures, no glass).
  // Soft IBL still comes from scene.environment. We track every material so
  // dispose() can free them (no shared library to call mats.dispose() on now).
  const ownMats = [];
  const M = (m) => { ownMats.push(m); return m; };
  const lp = (color, { rough = 0.85, metal = 0, flat = false, emissive, emissiveIntensity } = {}) => M(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: rough, metalness: metal,
      flatShading: flat,
      ...(emissive != null ? { emissive: new THREE.Color(emissive), emissiveIntensity: emissiveIntensity ?? 1 } : {}),
    }),
  );

  // Muted palette tinted by shopHue (kept low-saturation for a tasteful look).
  const matFloor = lp(hsl(shopHue, 0.06, 0.42), { rough: 0.95, flat: true });
  const matRug = lp(hsl(shopHue, 0.18, 0.4), { rough: 0.95 });
  const matWall = lp(hsl(shopHue, 0.1, 0.72), { rough: 0.95, flat: true });
  const matCeil = lp(hsl(38, 0.08, 0.9), { rough: 1, flat: true });
  const matFrame = lp(hsl(shopHue, 0.12, 0.32), { rough: 0.6, metal: 0.3, flat: true });
  const matAccent = lp(hsl(shopHue, 0.32, 0.55), { rough: 0.7, flat: true });
  const matPlinth = lp(hsl(shopHue, 0.08, 0.66), { rough: 0.85, flat: true });
  const matPlinthTop = lp(hsl(shopHue, 0.05, 0.8), { rough: 0.8, flat: true });
  const matPanel = lp(0xfff6e8, { rough: 0.5, emissive: 0xffe7c0, emissiveIntensity: 0.75 });
  const matLeaf = lp(hsl(130, 0.4, 0.42), { rough: 1, flat: true });
  const matPot = lp(hsl(20, 0.4, 0.45), { rough: 0.95, flat: true });
  // Stair + elevator kit.
  const matStep = lp(hsl(shopHue, 0.08, 0.58), { rough: 0.9, flat: true });
  const matRail = lp(hsl(shopHue, 0.14, 0.34), { rough: 0.6, metal: 0.35, flat: true });
  const matLift = lp(hsl(shopHue, 0.06, 0.5), { rough: 0.7, metal: 0.4, flat: true });
  const matLiftPlate = lp(hsl(shopHue, 0.1, 0.62), { rough: 0.55, metal: 0.5, flat: true });
  const matBtn = lp(hsl(shopHue, 0.1, 0.3), { rough: 0.5, metal: 0.4, flat: true });
  const matBtnLit = lp(0xffffff, { rough: 0.4, emissive: hsl(shopHue, 0.6, 0.5), emissiveIntensity: 1.4 });

  // ── Post-processing composer (adaptive) ──────────────────
  const post = createComposer(renderer, scene, camera, { quality: q });

  // ── Floor-count rule (derived from product count) ────────
  // small (≤2)  → 1 floor / no stairs
  // medium (≤5) → 2 floors + stairs
  // large (>5)  → 3 floors + stairs + elevator
  // Low tier caps to 2 floors max (perf) so big shops degrade gracefully.
  let FLOORS = products.length <= 2 ? 1 : products.length <= 5 ? 2 : 3;
  const LOW = q.shadowMapSize <= 0 || (q.tier && q.tier === 'low');
  if (LOW && FLOORS > 2) FLOORS = 2;
  const HAS_STAIRS = FLOORS >= 2;
  const HAS_ELEVATOR = FLOORS >= 3;

  // ── Vertical geometry ────────────────────────────────────
  const wallH = 4.2, SLAB = 0.3, floorH = wallH + SLAB;
  const baseY = (f) => f * floorH;
  const RX = 10.5, RZ = 11.5;

  // ── Interior lighting (calm boutique, not a stage) ───────
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3d42, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));

  // Per-floor warm ceiling fills (PointLights). One on floor 0 casts shadows
  // when allowed. Low tiers thin the lamp grid to keep the light count sane.
  const ceilLights = [];
  const baseLamps = [[-5.5, -5.5], [5.5, -5.5], [-5.5, 2.5], [5.5, 2.5], [0, -1.5]];
  const lampPositions = (LOW ? baseLamps.slice(0, 2).concat([[0, -1.5]]) : baseLamps);
  const lampLocalY = wallH - 0.5;
  for (let f = 0; f < FLOORS; f++) {
    const fb = baseY(f);
    lampPositions.forEach(([lx, lz], i) => {
      const pl = new THREE.PointLight(0xfff2dc, 18, 36, 2.0);
      pl.position.set(lx, fb + lampLocalY, lz);
      if (f === 0 && i === 0 && q.shadowMapSize > 0) {
        pl.castShadow = true;
        pl.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        pl.shadow.camera.near = 0.4; pl.shadow.camera.far = 24; pl.shadow.bias = -0.0006;
      }
      scene.add(pl);
      ceilLights.push(pl);
    });
  }

  // ── Room shell builders (parameterized by floor base Y) ──
  // Floor slab.
  function buildFloorSlab(fb) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, 0.4, RZ * 2 + 1), matFloor);
    m.position.set(0, fb - 0.2, 0); m.receiveShadow = true; scene.add(m);
    return m;
  }
  // One side wall (back / left / right) spanning fb..fb+wallH.
  function wall(fb, x, z, w, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, 0.3), matWall);
    m.position.set(x, fb + wallH / 2 - 0.2, z); m.rotation.y = rotY; m.receiveShadow = true; scene.add(m);
    return m;
  }
  // Front wall panel (either side of the doorway gap on the +Z face).
  const FRONT_Z = RZ;
  function frontPanel(fb, x, w) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, 0.3), matWall);
    g.position.set(x, fb + wallH / 2 - 0.2, FRONT_Z); g.receiveShadow = true; scene.add(g);
    return g;
  }
  // Ceiling slab (also the next floor's underside).
  function buildCeilSlab(fb) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, 0.3, RZ * 2 + 1), matCeil);
    m.position.set(0, fb + wallH - 0.2, 0); scene.add(m);
    return m;
  }
  // Ceiling lamp fixtures (housing box + emissive panel) per lamp slot.
  function buildLampFixtures(fb) {
    lampPositions.forEach(([lx, lz]) => {
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 1.5), matFrame);
      housing.position.set(lx, fb + wallH - 0.36, lz); scene.add(housing);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 1.24), matPanel);
      panel.rotation.x = Math.PI / 2; panel.position.set(lx, fb + wallH - 0.44, lz); scene.add(panel);
    });
  }

  const GAP = 1.5;
  // Build the shell for every floor.
  for (let f = 0; f < FLOORS; f++) {
    const fb = baseY(f);
    buildFloorSlab(fb);
    wall(fb, 0, -RZ, RX * 2, 0);             // back
    wall(fb, -RX, 0, RZ * 2, Math.PI / 2);   // left
    wall(fb, RX, 0, RZ * 2, Math.PI / 2);    // right
    if (f === 0) {
      // Floor 0 front wall has the exit doorway gap.
      frontPanel(fb, -(RX / 2 + GAP / 2), RX - GAP);
      frontPanel(fb, (RX / 2 + GAP / 2), RX - GAP);
      const header = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, 0.6, 0.34), matWall);
      header.position.set(0, fb + wallH - 0.5, FRONT_Z); header.receiveShadow = true; scene.add(header);
    } else {
      // Upper floors get a solid front wall (no exit).
      const fullFront = new THREE.Mesh(new THREE.BoxGeometry(RX * 2, wallH, 0.3), matWall);
      fullFront.position.set(0, fb + wallH / 2 - 0.2, FRONT_Z); fullFront.receiveShadow = true; scene.add(fullFront);
    }
    // Ceiling slab on every floor (the top floor is capped; lower floors' ceiling
    // doubles as the slab the next floor sits above).
    buildCeilSlab(fb);
    buildLampFixtures(fb);
    // Per-floor brand sign accent plaque on the back wall.
    const brandSign = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.9, 0.12), matAccent);
    brandSign.position.set(0, fb + wallH - 0.7, -RZ + 0.22); scene.add(brandSign);
  }

  // Subtle accent rug under the floor-0 central display zone.
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.04, 32), matRug);
  rug.position.set(0, 0.03, -1.5); rug.receiveShadow = true; scene.add(rug);

  // ── Floor-0 exit doorframe (jambs + lintel + sill) ───────
  const door = new THREE.Group(); door.position.set(0, 0, FRONT_Z);
  [-1.45, 1.45].forEach((jx) => {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 4.2, 0.4), matFrame);
    jamb.position.set(jx, 1.9, 0); jamb.castShadow = true; door.add(jamb);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.4, 0.4), matFrame);
  lintel.position.set(0, 3.95, 0); lintel.castShadow = true; door.add(lintel);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 0.5), matAccent);
  sill.position.set(0, 0.04, 0); door.add(sill);
  const doorGap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.9, 0.16), M(new THREE.MeshBasicMaterial({ visible: false })));
  doorGap.position.set(0, 1.85, 0); door.add(doorGap);
  scene.add(door);

  // Low-poly potted plants in the floor-0 back corners.
  function lowPolyPlant() {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.6, 8), matPot);
    pot.position.y = 0.3; pot.castShadow = true; g.add(pot);
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), matLeaf);
    foliage.position.y = 1.15; foliage.castShadow = true; g.add(foliage);
    return g;
  }
  [[-RX + 1, -RZ + 1], [RX - 1, -RZ + 1]].forEach(([px, pz]) => {
    const pl = lowPolyPlant();
    pl.position.set(px, 0, pz); pl.scale.set(1.2, 1.2, 1.2); scene.add(pl);
  });

  // ── STAIRS ───────────────────────────────────────────────
  // One flight per gap f=0..FLOORS-2, alternating back corners so flights never
  // overlap (flight 0 at back-RIGHT, flight 1 at back-LEFT). Each flight rises
  // floorH along -Z (low end at zStart toward room centre, high landing at zEnd
  // near the back wall). Footprint + direction are recorded so the frame loop
  // can lift the player along the run (the core mechanic).
  const stairs = [];
  if (HAS_STAIRS) {
    const STEPS = 12;
    const flightWidth = 3.0;             // x-footprint
    const zStartBase = -RZ + 5.0;        // low end (toward centre)
    const zEndBase = -RZ + 0.8;          // high landing (near back wall)
    const run = zStartBase - zEndBase;   // positive horizontal run along -Z
    for (let f = 0; f <= FLOORS - 2; f++) {
      const right = (f % 2 === 0);       // flight 0 → right, flight 1 → left, …
      // Center the flight in a back corner, inset from the side wall.
      const cx = right ? (RX - 0.4 - flightWidth / 2) : (-RX + 0.4 + flightWidth / 2);
      const xMin = cx - flightWidth / 2, xMax = cx + flightWidth / 2;
      const fb = baseY(f);
      const group = new THREE.Group(); scene.add(group);
      // Visible step boxes spanning fb → fb+floorH.
      for (let s = 0; s < STEPS; s++) {
        const p0 = s / STEPS, p1 = (s + 1) / STEPS;
        const z = zStartBase - ((p0 + p1) / 2) * run;     // step centre z
        const yTop = fb + ((s + 1) / STEPS) * floorH;     // tread top height
        const stepH = (floorH / STEPS) + 0.18;            // slight overlap so no gaps
        const depth = (run / STEPS) + 0.06;
        const step = new THREE.Mesh(new THREE.BoxGeometry(flightWidth, stepH, depth), matStep);
        step.position.set(cx, yTop - stepH / 2, z);
        step.castShadow = true; step.receiveShadow = true; group.add(step);
      }
      // Side rail (toward the open / inner side) for looks.
      const railX = right ? xMin - 0.05 : xMax + 0.05;
      const railLen = Math.hypot(run, floorH);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, railLen), matRail);
      const midZ = (zStartBase + zEndBase) / 2, midY = fb + floorH / 2 + 0.95;
      rail.position.set(railX, midY, midZ);
      rail.rotation.x = -Math.atan2(floorH, run);
      group.add(rail);
      // Rail posts at both ends.
      [[zStartBase, fb], [zEndBase, fb + floorH]].forEach(([pz, py]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), matRail);
        post.position.set(railX, py + 0.5, pz); group.add(post);
      });
      stairs.push({ f, xMin, xMax, zStart: zStartBase, zEnd: zEndBase, yBase: fb });
    }
  }

  // ── ELEVATOR (FLOORS>=3) ─────────────────────────────────
  // A shaft + platform at the back-CENTER, away from the stair corners. When the
  // player stands centered on the idle platform, after a short dwell it travels
  // UP one floor (carrying the player), wrapping back to floor 0 after the top.
  // Self-contained — no UI; exposes an `elevator` poi for prompts.
  let elevator = null;
  if (HAS_ELEVATOR) {
    const ex = 0, ez = -RZ + 2.6;          // back-centre, clear of corner stairs
    const half = 0.9;                      // 1.8 × 1.8 platform half-extent
    const topY = baseY(FLOORS - 1);
    const group = new THREE.Group(); scene.add(group);
    // Shaft corner posts spanning floor 0 → top floor.
    const shaftH = topY + wallH;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, shaftH, 0.16), matLift);
      post.position.set(ex + sx * (half + 0.12), shaftH / 2 - 0.2, ez + sz * (half + 0.12));
      group.add(post);
    });
    // Back shaft panel (so the shaft reads as an enclosure, not just posts).
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.4, shaftH, 0.1), matLift);
    backPanel.position.set(ex, shaftH / 2 - 0.2, ez - (half + 0.18)); group.add(backPanel);
    // Moving platform (its own mesh; we lerp its y AND pp.y together).
    const platform = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.18, half * 2), matLiftPlate);
    platform.position.set(ex, baseY(0) + 0.0, ez);
    platform.castShadow = true; platform.receiveShadow = true; group.add(platform);
    // Emissive ride indicator above the platform.
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), matBtnLit);
    indicator.position.set(ex, baseY(0) + 1.9, ez); group.add(indicator);
    // Call-button box on the back panel (decorative; ride is automatic).
    const btnBox = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.12), matBtn);
    btnBox.position.set(ex + half - 0.1, baseY(0) + 1.3, ez - half - 0.1); group.add(btnBox);
    elevator = {
      ex, ez, half, group, platform, indicator,
      curFloor: 0,            // floor the platform currently rests at
      state: 'idle',          // 'idle' | 'dwell' | 'moving'
      timer: 0,               // dwell timer
      fromY: baseY(0), toY: baseY(0), prog: 0,
      pos: new THREE.Vector3(ex, 0, ez), trig: 2.0,
    };
  }

  // ── Billboard label helper ───────────────────────────────
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  const labels = [];
  function makeLabel(title, sub, w) {
    const cv = document.createElement('canvas'); cv.width = 300; cv.height = 104;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(18,20,24,.86)'; roundRect(c, 4, 4, 292, 96, 22); c.fill();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#f2efe9'; c.font = '600 30px "Be Vietnam Pro", system-ui, sans-serif';
    const tt = title.length > 16 ? title.slice(0, 15) + '…' : title;
    c.fillText(tt, 150, 40);
    if (sub) { c.fillStyle = '#cbb89a'; c.font = '700 26px "Space Mono", monospace'; c.fillText(sub, 150, 76); }
    const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
    const ww = w || 2.0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, ww * 104 / 300), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    labels.push(m); return m;
  }

  // Flat low-poly tag marker (gently emissive so it pops, not neon).
  const markerMat = lp(0xffffff, { rough: 0.5, emissive: hsl(shopHue, 0.4, 0.5), emissiveIntensity: 0.55 });

  // ── Player (shared avatar builder) ───────────────────────
  const player = buildAvatar({ hue: look.hue, skinColor: SKINS[look.skin], style: look.style });
  player.group.position.set(0, 0, 1.5);   // mid-room so the camera stays inside
  player.group.rotation.y = Math.PI; // face into room (−z, toward the advisor)
  scene.add(player.group);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.24 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);

  // ── NPC stylist (floor 0, back center) ───────────────────
  const npc = buildAvatar({ hue: npcInfo.hue, skinColor: SKINS[2], style: 'minimal' });
  npc.group.position.set(0, 0, -RZ + 1.8);
  npc.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(npc.group);
  const npcLabel = makeLabel(npcInfo.name, (opts.labels && opts.labels.advisor) || (opts.lang === 'en' ? 'Advisor' : 'Tư vấn'), 1.9);
  npcLabel.position.set(0, 2.5, -RZ + 1.8); scene.add(npcLabel);
  const npcMarker = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 10, 24), markerMat);
  npcMarker.position.set(0, 3.15, -RZ + 1.8); scene.add(npcMarker);

  // ── Product displays (spread across floors) ──────────────
  // pois / blockers are FLOOR-TAGGED so a fixture on floor 0 never blocks (or
  // pings) the player standing above it. Exit + npc live on floor 0.
  const pois = [
    { id: '__exit', type: 'exit', pos: new THREE.Vector3(0, 0, RZ - 0.4), trig: 2.0, floor: 0 },
    { id: '__npc', type: 'npc', pos: new THREE.Vector3(0, 0, -RZ + 1.8), trig: 2.4, floor: 0 },
  ];
  if (elevator) pois.push({ id: '__elevator', type: 'elevator', pos: elevator.pos, trig: elevator.trig, floor: -1 });
  const markers = [npcMarker];
  // Map of product id -> { group, form, formMat, pedestalPos, baseRot, floor }.
  const productById = {};
  // Local slot layout, REPEATED per floor. The stair corner (back, one side) and
  // elevator shaft (back centre) are kept clear by choosing front/side slots.
  const slots = [
    [-6.8, -6.5], [6.8, -6.5],
    [-6.8, -1.5], [6.8, -1.5],
    [-6.8, 3.5], [6.8, 3.5],
  ];
  // Spread products ~ceil(products/FLOORS) per floor. Slot index within a floor
  // = i % slots.length; floor = floor(i / perFloor) clamped to FLOORS-1.
  const perFloor = Math.max(1, Math.ceil(Math.max(products.length, 1) / FLOORS));

  // Build one product pedestal+garment+label. `floor` lifts the group to baseY,
  // and tags the product's poi/blocker/label/record with that floor.
  function buildPedestal(p, slotIdx, floor) {
    const [x, z] = slots[slotIdx % slots.length];
    const fb = baseY(floor);
    const g = new THREE.Group(); g.position.set(x, fb, z);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.78, 1.0, 8), matPlinth);
    ped.position.y = 0.5; ped.castShadow = true; ped.receiveShadow = true; g.add(ped);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.12, 8), matPlinthTop);
    top.position.y = 1.06; top.castShadow = true; g.add(top);
    // Garment "form": a sub-group inspect can lift + spin as a unit.
    const form = new THREE.Group();
    form.position.y = 0;
    g.add(form);
    const col = new THREE.Color(p.color || '#cfd8d2');
    const formMat = M(new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.0 }));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.52, 1.2, 12), formMat);
    body.position.y = 1.85; body.castShadow = true; form.add(body);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), formMat);
    shoulder.position.y = 2.4; shoulder.scale.set(1, 0.7, 1); shoulder.castShadow = true; form.add(shoulder);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8), matPlinthTop);
    neck.position.y = 2.62; form.add(neck);
    const mk = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 10, 24), markerMat);
    mk.position.set(0, 3.15, 0); g.add(mk); markers.push(mk);
    scene.add(g);
    // Billboard label above the pedestal (in world space at the floor's height).
    const lab = makeLabel(p.name, p.price, 2.0);
    lab.position.set(x, fb + 3.7, z);
    scene.add(lab);
    pois.push({ id: p.id, type: 'product', pos: new THREE.Vector3(x, fb, z), trig: 2.2, floor });
    // Live blocker, floor-tagged.
    if (blockers) blockers.push({ pos: new THREE.Vector3(x, fb, z), r: 1.1, floor });
    productById[p.id] = {
      group: g, form, formMat, label: lab, marker: mk,
      pedestalPos: new THREE.Vector3(x, fb, z), baseRot: 0, floor,
    };
    return productById[p.id];
  }

  // Allocate a (floor, slotIdx) for the Nth product so placement stays stable
  // for both the init loop and live addProduct().
  const placedPerFloor = new Array(FLOORS).fill(0);
  function nextPlacement() {
    // Prefer filling each floor up to perFloor before overflowing; never exceed
    // slots.length on a single floor.
    for (let f = 0; f < FLOORS; f++) {
      if (placedPerFloor[f] < perFloor && placedPerFloor[f] < slots.length) {
        return { floor: f, slotIdx: placedPerFloor[f] };
      }
    }
    // Floors at quota → overflow onto any floor with a free slot.
    for (let f = 0; f < FLOORS; f++) {
      if (placedPerFloor[f] < slots.length) return { floor: f, slotIdx: placedPerFloor[f] };
    }
    return null; // genuinely full
  }

  let blockers = null;
  // Static blockers first (npc on floor 0). Built before pedestals so live
  // pushes land in the same array.
  blockers = [{ pos: new THREE.Vector3(0, 0, -RZ + 1.8), r: 1.0, floor: 0 }];

  let usedSlots = 0;
  products.forEach((p) => {
    const place = nextPlacement();
    if (!place) return;
    buildPedestal(p, place.slotIdx, place.floor);
    placedPerFloor[place.floor] += 1;
    usedSlots += 1;
  });

  // ── Input: keyboard + joystick ───────────────────────────
  const kbd = createKeyboard();
  const keys = kbd.keys;
  const stick = createJoystick(container);
  const joy = stick.joy;

  // ── Orbit camera (drag to rotate 360°, pinch / wheel to zoom) ─
  const orbitCam = createOrbitCamera(renderer.domElement, { yaw: 0, elev: 0.45, dist: 10, minDist: 5, maxDist: 22, minElev: 0.16, maxElev: 1.2, pinch: 0.06, wheel: 0.02 });
  const cam = orbitCam.cam;

  // ── Tactile inspect mode ─────────────────────────────────
  const dom = renderer.domElement;
  const inspect = {
    active: false,
    id: null,
    entry: null,
    t: 0,
    spinYaw: 0,
    spinTilt: 0,
    spinVel: 0,
    dist: 4.2,
    minDist: 2.6, maxDist: 7.0,
    fromPos: new THREE.Vector3(), fromTarget: new THREE.Vector3(),
    camTarget: new THREE.Vector3(),
    liftFrom: 0, liftTo: 0,
  };
  const followLook = new THREE.Vector3(0, 1.4, -0.5);

  function inspectPedestalCenter(entry, out) {
    // Frame around the upper garment area of the pedestal, at the FLOOR's height.
    return out.set(entry.pedestalPos.x, baseY(entry.floor) + 2.1, entry.pedestalPos.z);
  }

  // Drag-to-spin pointer controller (active only while inspecting).
  const spin = { pointers: new Map(), lastDist: 0 };
  const spinDown = (e) => {
    if (!inspect.active) return;
    e.stopPropagation();
    spin.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    inspect.spinVel = 0;
    try { dom.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const spinMove = (e) => {
    if (!inspect.active) return;
    e.stopPropagation();
    if (!spin.pointers.has(e.pointerId)) return;
    const prev = spin.pointers.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    spin.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (spin.pointers.size >= 2) {
      const pts = [...spin.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (spin.lastDist) inspect.dist = Math.max(inspect.minDist, Math.min(inspect.maxDist, inspect.dist - (d - spin.lastDist) * 0.012));
      spin.lastDist = d;
    } else {
      inspect.spinYaw -= dx * 0.01;
      inspect.spinVel = -dx * 0.01;
      inspect.spinTilt = Math.max(-0.5, Math.min(0.5, inspect.spinTilt + dy * 0.006));
    }
  };
  const spinUp = (e) => { if (inspect.active) e.stopPropagation(); spin.pointers.delete(e.pointerId); if (spin.pointers.size < 2) spin.lastDist = 0; };
  const spinWheel = (e) => {
    if (!inspect.active) return;
    inspect.dist = Math.max(inspect.minDist, Math.min(inspect.maxDist, inspect.dist + e.deltaY * 0.004));
    e.preventDefault(); e.stopPropagation();
  };
  dom.addEventListener('pointerdown', spinDown, true);
  dom.addEventListener('pointermove', spinMove, true);
  dom.addEventListener('pointerup', spinUp, true);
  dom.addEventListener('pointercancel', spinUp, true);
  dom.addEventListener('wheel', spinWheel, { passive: false, capture: true });

  function enterInspect(id) {
    const entry = productById[id];
    if (!entry) return;
    if (inspect.active && inspect.entry === entry) return;
    inspect.fromPos.copy(camera.position);
    inspect.fromTarget.copy(followLook);
    inspect.camTarget.copy(followLook);
    inspect.active = true;
    inspect.id = id;
    inspect.entry = entry;
    inspect.t = 0;
    inspect.spinYaw = entry.form.rotation.y;
    inspect.spinTilt = entry.form.rotation.x;
    inspect.spinVel = 0;
    inspect.dist = 4.2;
    inspect.liftFrom = entry.form.position.y;
    inspect.liftTo = 0.55;
    orbitCam.clearPointers();
  }

  function leaveInspect() {
    if (!inspect.active) return;
    inspect.active = false;
  }

  function setInspectColorHex(hex) {
    if (!inspect.entry) return;
    try { inspect.entry.formMat.color.set(hex); } catch (_) {}
  }

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = 5.4;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
  const followPos = new THREE.Vector3();
  const inspPos = new THREE.Vector3();
  const inspLook = new THREE.Vector3();
  let phase = 0, near = null, raf = 0, last = performance.now(), running = true;
  // Which floor the player is currently standing on (derived from pp.y on flat
  // ground; updated explicitly at stair/elevator endpoints).
  let currentFloor = 0;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // Inspect tween: ease t toward 1 while active, toward 0 while leaving (~0.4s).
    inspect.t += (inspect.active ? 1 : -1) * (dt / 0.4);
    inspect.t = Math.max(0, Math.min(1, inspect.t));
    const it = inspect.t < 0.5 ? 2 * inspect.t * inspect.t : 1 - Math.pow(-2 * inspect.t + 2, 2) / 2;
    const inspecting = inspect.t > 0.001;
    if (!inspect.active && inspect.entry && inspect.t <= 0.001) {
      inspect.entry.form.position.y = 0;
      inspect.entry.form.rotation.set(0, 0, 0);
      inspect.entry = null; inspect.id = null;
    }

    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz);
    const moving = !inspecting && mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    // Is the player riding the elevator (locked to the shaft while it moves)?
    const riding = elevator && elevator.state === 'moving';
    if (moving && !riding) {
      const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw);
      const rgtX = Math.cos(cam.yaw), rgtZ = -Math.sin(cam.yaw);
      const mvx = rgtX * ix + fwdX * (-iz), mvz = rgtZ * ix + fwdZ * (-iz);
      pp.x += mvx * SPEED * dt; pp.z += mvz * SPEED * dt;
      // Per-floor wall clamp (applies on every floor).
      pp.x = Math.max(-RX + 0.7, Math.min(RX - 0.7, pp.x));
      pp.z = Math.max(-RZ + 0.7, Math.min(RZ - 0.4, pp.z));
      // FLOOR-AWARE collision: only blockers on the current floor apply.
      blockers.forEach((b) => {
        if (b.floor !== currentFloor) return;
        const dx = pp.x - b.pos.x, dz = pp.z - b.pos.z;
        const dd = Math.hypot(dx, dz) || 1;
        if (dd < b.r) { pp.x = b.pos.x + dx / dd * b.r; pp.z = b.pos.z + dz / dd * b.r; }
      });
      const tr = Math.atan2(mvx, mvz); let diff = ((tr - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI; player.group.rotation.y += diff * Math.min(1, dt * 12);
    }

    // ── Vertical follow: STAIRS ──────────────────────────────
    // Default target = the current floor's slab. Inside a flight footprint,
    // interpolate up the run; flip currentFloor at the endpoints.
    let targetY = baseY(currentFloor);
    if (HAS_STAIRS && !riding) {
      for (let i = 0; i < stairs.length; i++) {
        const s = stairs[i];
        if (pp.x >= s.xMin && pp.x <= s.xMax && pp.z <= s.zStart + 0.4 && pp.z >= s.zEnd - 0.4) {
          const p = clamp01((s.zStart - pp.z) / (s.zStart - s.zEnd));
          targetY = s.yBase + p * floorH;
          if (p >= 0.985) currentFloor = s.f + 1;
          else if (p <= 0.015) currentFloor = s.f;
          break;
        }
      }
    }

    // ── Vertical follow: ELEVATOR ────────────────────────────
    if (elevator) {
      const el = elevator;
      const onPad = Math.abs(pp.x - el.ex) <= el.half - 0.15 && Math.abs(pp.z - el.ez) <= el.half - 0.15;
      if (el.state === 'idle') {
        el.platform.position.y = baseY(el.curFloor);
        if (onPad && !inspecting) { el.state = 'dwell'; el.timer = 0; }
      } else if (el.state === 'dwell') {
        el.timer += dt;
        if (!onPad) { el.state = 'idle'; el.timer = 0; }
        else if (el.timer >= 0.4) {
          // Begin a ride: up one floor, wrapping to floor 0 after the top.
          const next = el.curFloor >= FLOORS - 1 ? 0 : el.curFloor + 1;
          el.fromY = baseY(el.curFloor); el.toY = baseY(next);
          el.nextFloor = next; el.prog = 0; el.state = 'moving';
        }
      } else if (el.state === 'moving') {
        el.prog = Math.min(1, el.prog + dt / 1.3);
        const e2 = el.prog < 0.5 ? 2 * el.prog * el.prog : 1 - Math.pow(-2 * el.prog + 2, 2) / 2; // easeInOutQuad
        const y = el.fromY + (el.toY - el.fromY) * e2;
        el.platform.position.y = y;
        // Keep the player centered on the platform shaft + carry them vertically.
        pp.x += (el.ex - pp.x) * Math.min(1, dt * 8);
        pp.z += (el.ez - pp.z) * Math.min(1, dt * 8);
        targetY = y;                 // overrides the stair/floor target while riding
        if (el.prog >= 1) {
          el.curFloor = el.nextFloor;
          currentFloor = el.curFloor;
          el.state = 'idle'; el.timer = 0;
        }
      }
      el.indicator.position.y = el.platform.position.y + 1.9;
      el.indicator.material.emissiveIntensity = el.state === 'moving' ? 1.4 + Math.sin(t * 10) * 0.5 : 0.6;
    }

    // Determine currentFloor from pp.y when on flat ground (not mid-stair / ride).
    if (!riding) {
      const onFlat = Math.abs(pp.y - baseY(currentFloor)) < 0.05;
      if (onFlat) currentFloor = Math.max(0, Math.min(FLOORS - 1, Math.round(pp.y / floorH)));
    }

    // Ease the player's vertical position toward the target.
    pp.y += (targetY - pp.y) * Math.min(1, dt * 10);

    const sp = moving ? mag : 0; phase += dt * (6 + sp * 4) * (moving ? 1 : 0);
    const sw = moving ? 0.7 * sp : 0; const ease = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 14);
    ease(player.parts.legL, Math.sin(phase) * sw); ease(player.parts.legR, -Math.sin(phase) * sw);
    ease(player.parts.armL, -Math.sin(phase) * sw * 0.7); ease(player.parts.armR, Math.sin(phase) * sw * 0.7);
    player.parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : 0);
    blob.position.set(pp.x, pp.y + 0.05, pp.z);

    // NPC idle + look at player (floor 0; paused while inspecting)
    if (!inspecting) {
      npc.parts.torso.position.y = 1.05 + Math.sin(t * 1.3) * 0.02;
      npc.group.rotation.y = Math.atan2(pp.x - npc.group.position.x, pp.z - npc.group.position.z);
    }

    // Drag-to-spin: apply accumulated yaw/tilt to the focused garment form.
    if (inspect.entry) {
      const f = inspect.entry.form;
      if (spin.pointers.size === 0 && Math.abs(inspect.spinVel) > 0.0001) {
        inspect.spinYaw += inspect.spinVel;
        inspect.spinVel *= 0.92;
      }
      f.rotation.y = inspect.spinYaw;
      f.rotation.x = inspect.spinTilt * it;
      f.position.y = inspect.liftFrom + (inspect.liftTo - inspect.liftFrom) * it;
    }

    // ── camera follow (orbit) pose — now tracks pp.y ─────────
    const offX = cam.dist * Math.cos(cam.elev) * Math.sin(cam.yaw);
    const offZ = cam.dist * Math.cos(cam.elev) * Math.cos(cam.yaw);
    const offY = cam.dist * Math.sin(cam.elev);
    followPos.set(pp.x + offX, pp.y + offY, pp.z + offZ);
    followLook.set(pp.x * 0.6, pp.y + 1.4, pp.z * 0.6 - 0.5);

    if (inspecting && inspect.entry) {
      inspectPedestalCenter(inspect.entry, inspLook);
      const px = inspect.entry.pedestalPos.x, pz = inspect.entry.pedestalPos.z;
      const fy = baseY(inspect.entry.floor);
      const dirX = -px, dirZ = -pz;
      const dl = Math.hypot(dirX, dirZ) || 1;
      inspPos.set(
        px + (dirX / dl) * inspect.dist,
        fy + 2.5 + inspect.dist * 0.18,
        pz + (dirZ / dl) * inspect.dist,
      );
      camTarget.copy(followPos).lerp(inspPos, it);
      inspect.camTarget.lerp(inspLook, Math.min(1, dt * 6));
      tmp.copy(followLook).lerp(inspect.camTarget, it);
      camera.position.lerp(camTarget, Math.min(1, dt * 6));
      camera.lookAt(tmp);
    } else {
      camTarget.copy(followPos);
      camera.position.lerp(camTarget, Math.min(1, dt * 6));
      camera.lookAt(followLook);
    }

    // billboards face camera
    labels.forEach((l) => l.quaternion.copy(camera.quaternion));
    markers.forEach((m, i) => { m.rotation.z = t * 1.2 + i; });
    npcMarker.position.y = 3.15 + Math.sin(t * 1.6) * 0.12;

    // ── proximity (FLOOR-AWARE) ──────────────────────────────
    // Only pois on the current floor count (exit/npc = floor 0). The elevator
    // poi (floor -1) is matched whenever the player is on the pad, any floor.
    let best = null, bestD = Infinity;
    pois.forEach((poi) => {
      if (poi.floor >= 0 && poi.floor !== currentFloor) return;
      const d = Math.hypot(pp.x - poi.pos.x, pp.z - poi.pos.z);
      if (d < poi.trig && d < bestD) { bestD = d; best = poi; }
    });
    const id = best ? best.id : null;
    if (id !== (near && near.id)) { near = best; opts.onProximity && opts.onProximity(best ? { id: best.id, type: best.type } : null); }

    post.render(dt);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const ro = new ResizeObserver(() => {
    camera.aspect = W() / H(); camera.updateProjectionMatrix();
    renderer.setSize(W(), H());
    post.setSize(W(), H());
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
    // ── Tactile inspect API (unchanged) ────────────────────
    inspect(id) { enterInspect(id); },
    endInspect() { leaveInspect(); },
    setInspectColor(hex) { setInspectColorHex(hex); },

    /**
     * Diegetically stock a new product onto the next free slot/floor.
     * p: { id, name, price, color }. No-ops if the id already exists or every
     * slot on every floor is full. Returns true when a pedestal was spawned.
     */
    addProduct(p) {
      if (!p || !p.id) return false;
      if (productById[p.id]) return false;
      const place = nextPlacement();
      if (!place) return false;             // genuinely full → caller re-inits
      buildPedestal(p, place.slotIdx, place.floor);
      placedPerFloor[place.floor] += 1;
      usedSlots += 1;
      return true;
    },

    dispose() {
      disposed = true; running = false; cancelAnimationFrame(raf); ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      dom.removeEventListener('pointerdown', spinDown, true);
      dom.removeEventListener('pointermove', spinMove, true);
      dom.removeEventListener('pointerup', spinUp, true);
      dom.removeEventListener('pointercancel', spinUp, true);
      dom.removeEventListener('wheel', spinWheel, true);
      kbd.dispose(); stick.dispose(); orbitCam.dispose();
      post.dispose();
      ownMats.forEach((m) => m.dispose());
      envRT.dispose();
      pmrem.dispose();
      disposeScene(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
}
