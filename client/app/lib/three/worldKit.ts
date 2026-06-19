// @ts-nocheck -- Veyra walkable 3D world: low-poly Kenney City Kit shopping district.
// createVeyraWorld(container, opts) -> { dispose, recenter, setLang }
// opts: { playerHue, lite, shops:[{id,hue,name}], onProximity(poi|null), onCoin(n), onReady?() }
//
// A cohesive low-poly shopping district built by cloning Kenney City Kit (CC0)
// GLB pieces: a central roundabout, four avenues of straight road radiating
// N/S/E/W, sidewalks + storefront buildings lining both sides, street lights,
// over a grass plane. Real shops (opts.shops) take prime frontage near the
// plaza; quests + cart sit as kiosks beside it. Same public API as world.ts.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { hsl } from './shared/helpers';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createKitLoader } from './shared/assets';

export function createVeyraWorld(container, opts) {
  opts = opts || {};
  const shopsIn = opts.shops || [];
  const playerHue = opts.playerHue != null ? opts.playerHue : 184;

  const W = () => container.clientWidth || 390;
  const H = () => container.clientHeight || 700;

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
  const SKY_COLOR = new THREE.Color('#9fd4ea');
  const FOG_COLOR = new THREE.Color('#bfe0d8');
  renderer.setClearColor(SKY_COLOR, 1);   // so the container isn't black during async load
  const scene = new THREE.Scene();
  scene.background = SKY_COLOR;
  // fog starts beyond the walkable core and ends near the skyline horizon, so
  // distant low-detail buildings dissolve softly into the sky (no hard edge).
  scene.fog = new THREE.Fog(FOG_COLOR, 180, 900);

  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 2000);
  camera.position.set(0, 90, 200);

  // ── Lighting: hemi + sun + RoomEnvironment IBL ───────────
  const hemi = new THREE.HemisphereLight('#eaf6ff', '#6f8a6a', 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff2da', 2.1);
  sun.position.set(120, 220, 90);
  if (q.shadowMapSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const d = 220;
    Object.assign(sun.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 800 });
    sun.shadow.bias = -0.0004;
  }
  scene.add(sun);
  scene.add(sun.target);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomEnv, 0.04);
  scene.environment = envRT.texture;
  if (roomEnv.dispose) roomEnv.dispose();   // free the RoomEnvironment scene after baking

  // ── State containers ─────────────────────────────────────
  const circles = [];        // collision blockers in scaled world units: { x, z, r }
  const interactables = [];   // { id, type, name, hue?, pos, trig, marker, markerBaseY }
  const coins = [];
  let disposed = false;
  let started = false;        // build complete

  // ── Player avatar (built up front so dispose is uniform) ──
  const player = buildAvatar({ hue: playerHue, style: opts.playerStyle });
  scene.add(player.group);
  const parts = player.parts;

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);

  // ── Kit loader ───────────────────────────────────────────
  const kit = createKitLoader();

  // ── Layout constants ─────────────────────────────────────
  const CITY_SCALE = 7;          // tile ≈ 1u -> 7u footprint
  const TILE = CITY_SCALE;        // one placed tile spans ~TILE world units
  const ARM = 7;                  // tiles per avenue
  const START_T = 2;              // first road tile index out from the roundabout
  let OUTER_R = (START_T + ARM + 1) * TILE;  // play radius (recomputed after build)
  const ROUNDABOUT_R = TILE * 1.4;            // blocked plaza centre radius
  const START_Z = (START_T + 1.5) * TILE;     // player spawn: avenue mouth by the first buildings

  // building catalogue (cycled deterministically)
  const BUILD = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];
  const SKY = ['a', 'b', 'c', 'd', 'e'];
  const DETAILS = ['detail-awning', 'detail-awning-wide', 'detail-parasol-a', 'detail-parasol-b'];
  // cheap GLBs for the distant, non-walkable skyline fill (shared-geometry clones)
  const LOW = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];

  // names the loader must fetch
  const preloadNames = [
    'road:roundabout', 'road:straight', 'road:side', 'road:light-square',
    'road:bend', 'road:crossroad',
    ...BUILD.map((b) => 'build:building-' + b),
    ...SKY.map((s) => 'build:building-skyscraper-' + s),
    ...DETAILS.map((d) => 'build:' + d),
    ...LOW.map((l) => 'build:low-detail-building-' + l),
  ];

  // deterministic hash so the street is varied but stable
  const hash01 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

  // place a clone of `name` at scaled world (x,z), rotation ry, ground y=0.
  // Skips gracefully (returns null) if the asset failed to preload, so the
  // district still assembles from whatever loaded.
  function put(group, name, x, z, ry) {
    if (!kit.has(name)) return null;
    const c = kit.get(name);
    c.position.set(x, 0, z);
    c.rotation.y = ry || 0;
    c.scale.setScalar(CITY_SCALE);
    group.add(c);
    return c;
  }

  // footprint radius (scaled world units) of a placed piece, for collision.
  function footprintR(obj) {
    const s = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    return Math.max(s.x, s.z) / 2;
  }

  function pickBuilding(slotHash, nearPlaza) {
    if (nearPlaza && slotHash > 0.55) return 'build:building-skyscraper-' + SKY[Math.floor(slotHash * SKY.length) % SKY.length];
    return 'build:building-' + BUILD[Math.floor(slotHash * BUILD.length) % BUILD.length];
  }

  // ── Build the district (async, after preload) ────────────
  function build() {
    if (disposed) return;
    const density = q.propDensity;
    const city = new THREE.Group();
    scene.add(city);

    // grass ground plane (large enough to cover the whole skyline to the horizon)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ color: 0x7fae5f, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // central roundabout at origin; blocks the centre
    const ra = put(city, 'road:roundabout', 0, 0, 0);
    circles.push({ x: 0, z: 0, r: Math.max(ROUNDABOUT_R, ra ? footprintR(ra) * 0.85 : 0) });

    // collect storefront slots: { x, z, faceRy, nearPlaza }
    const slots = [];
    // four avenues N/S (along Z) and E/W (along X)
    const arms = [
      { dx: 0, dz: 1, roadRy: 0 },
      { dx: 0, dz: -1, roadRy: Math.PI },
      { dx: 1, dz: 0, roadRy: -Math.PI / 2 },
      { dx: -1, dz: 0, roadRy: Math.PI / 2 },
    ];
    for (const { dx, dz, roadRy } of arms) {
      const px = -dz, pz = dx; // perpendicular (sidewalk / building offset axis)
      for (let i = START_T; i < START_T + ARM; i++) {
        const x = dx * i * TILE, z = dz * i * TILE;
        put(city, 'road:straight', x, z, roadRy);
        // sidewalks + building slots both sides
        [1, -1].forEach((sgn) => {
          put(city, 'road:side', x + px * sgn * TILE, z + pz * sgn * TILE, roadRy + (sgn > 0 ? 0 : Math.PI));
          const bx = x + px * sgn * 2 * TILE, bz = z + pz * sgn * 2 * TILE;
          // building faces the avenue centreline (toward -perp*sgn)
          const faceRy = Math.atan2(-px * sgn, -pz * sgn);
          slots.push({ x: bx, z: bz, faceRy, nearPlaza: i <= START_T + 1, used: false });
        });
        // street lights at intervals, on the sidewalk edge
        if (i % 2 === 0) {
          put(city, 'road:light-square', x + px * 0.75 * TILE, z + pz * 0.75 * TILE, roadRy);
          put(city, 'road:light-square', x - px * 0.75 * TILE, z - pz * 0.75 * TILE, roadRy + Math.PI);
        }
      }
    }

    // ── Outer ring road: a square loop linking the four avenue ends, so the
    //    player can wander several city blocks (not just the four spokes). ──
    const ringHalf = START_T + ARM;           // half-extent of the ring, one tile past avenue ends
    // side runs: along +X/-X edges (vary z) and +Z/-Z edges (vary x). Each edge
    // is a row of straight tiles; corners get a bend; the avenue mid-points get a
    // crossroad (T/4-way) so the spoke connects cleanly into the ring.
    const RC = ringHalf * TILE;               // ring coordinate (world units) on each axis
    // edges: { fixed axis value, varying axis, roadRy for straight tiles, perp for buildings }
    function ringStraightRy(edge) {
      // edges 'N'/'S' run along X -> rotate 90°; 'E'/'W' run along Z -> 0
      return (edge === 'N' || edge === 'S') ? -Math.PI / 2 : 0;
    }
    const ringEdges = [
      { edge: 'N', fz: RC, dir: 'x' },   // top edge (z = +RC)
      { edge: 'S', fz: -RC, dir: 'x' },  // bottom edge (z = -RC)
      { edge: 'E', fx: RC, dir: 'z' },   // right edge (x = +RC)
      { edge: 'W', fx: -RC, dir: 'z' },  // left edge (x = -RC)
    ];
    for (const e of ringEdges) {
      const roadRy = ringStraightRy(e.edge);
      for (let k = -ringHalf; k <= ringHalf; k++) {
        const x = e.dir === 'x' ? k * TILE : e.fx;
        const z = e.dir === 'z' ? k * TILE : e.fz;
        const isCorner = Math.abs(k) === ringHalf;
        const isAvenueMouth = k === 0;        // where a spoke avenue meets the ring
        if (isCorner) {
          // corner handled once per corner below (skip here to avoid double-place)
          continue;
        }
        if (isAvenueMouth) {
          put(city, 'road:crossroad', x, z, 0);
        } else {
          put(city, 'road:straight', x, z, roadRy);
        }
        // sidewalk + a building slot on the OUTER side of the ring, facing in
        const ox = e.dir === 'z' ? Math.sign(e.fx) : 0;
        const oz = e.dir === 'x' ? Math.sign(e.fz) : 0;
        put(city, 'road:side', x + ox * TILE, z + oz * TILE, roadRy);
        const bx = x + ox * 2 * TILE, bz = z + oz * 2 * TILE;
        const faceRy = Math.atan2(-ox, -oz);   // face inward toward the ring road
        slots.push({ x: bx, z: bz, faceRy, nearPlaza: false, used: false });
        // also a building slot on the INNER side (between ring and avenues) for density
        if (Math.abs(k) % 2 === 0) {
          const ix2 = -ox, iz2 = -oz;
          const ibx = x + ix2 * 2 * TILE, ibz = z + iz2 * 2 * TILE;
          slots.push({ x: ibx, z: ibz, faceRy: Math.atan2(-ix2, -iz2), nearPlaza: false, used: false });
        }
      }
    }
    // four ring corners: a bend tile + a skyscraper anchor just outside it
    const corners = [
      { x: RC, z: RC, ry: 0 }, { x: -RC, z: RC, ry: Math.PI / 2 },
      { x: -RC, z: -RC, ry: Math.PI }, { x: RC, z: -RC, ry: -Math.PI / 2 },
    ];
    for (const c of corners) {
      put(city, 'road:bend', c.x, c.z, c.ry);
      // tall anchor building just beyond the corner, facing the city centre
      const bx = c.x + Math.sign(c.x) * 1.6 * TILE, bz = c.z + Math.sign(c.z) * 1.6 * TILE;
      slots.push({ x: bx, z: bz, faceRy: Math.atan2(-Math.sign(c.x), -Math.sign(c.z)), nearPlaza: false, used: false, anchor: true });
    }

    // extend the player play radius to include the new ring blocks
    OUTER_R = (ringHalf + 2.5) * TILE;

    // sort slots so the closest-to-plaza go first (prime frontage for real shops)
    slots.sort((a, b) => (a.x ** 2 + a.z ** 2) - (b.x ** 2 + b.z ** 2));

    // place a generic building into a slot, register a collision circle
    function placeBuilding(slot, opt) {
      opt = opt || {};
      const hb = hash01(slot.x, slot.z);
      const name = opt.name
        || (slot.anchor ? 'build:building-skyscraper-' + SKY[Math.floor(hb * SKY.length) % SKY.length]
          : pickBuilding(hb, slot.nearPlaza));
      const b = put(city, name, slot.x, slot.z, slot.faceRy);
      // Distant generic fill contributes little visible shadow detail but
      // inflates the single-light shadow pass; drop its castShadow so only
      // near/important buildings cast (the skyline fill is already shadowless).
      if (b && opt.noShadow) b.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      const r = (b ? footprintR(b) : TILE * 0.5) + 1.0;
      circles.push({ x: slot.x, z: slot.z, r });
      slot.used = true;
      slot.buildR = r;
      // shop character: an awning/parasol on some ground floors
      if (hb > 0.45 || opt.detail) {
        const det = DETAILS[Math.floor(hash01(slot.z, slot.x) * DETAILS.length) % DETAILS.length];
        // place the detail just in front of the façade, facing same way
        const fx = Math.sin(slot.faceRy), fz = Math.cos(slot.faceRy);
        put(city, 'build:' + det, slot.x + fx * (r * 0.55), slot.z + fz * (r * 0.55), slot.faceRy);
      }
      return b;
    }

    // ── Real shops at prime frontage ─────────────────────────
    const GEN_HUES = [28, 200, 150, 210, 46, 12, 190, 36, 96, 220, 18, 168];

    function addShopMarker(slot, info) {
      // entrance point: in front of the façade toward the avenue centre
      const fx = Math.sin(slot.faceRy), fz = Math.cos(slot.faceRy);
      const er = (slot.buildR || TILE) + 3.0;
      const ent = new THREE.Vector3(slot.x + fx * er, 0, slot.z + fz * er);
      const my = TILE * 2.6;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.5 * CITY_SCALE * 0.4, 0.06 * CITY_SCALE * 0.4, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(info.hue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(slot.x + fx * (er * 0.5), my, slot.z + fz * (er * 0.5));
      scene.add(marker);
      interactables.push({ id: info.id, type: 'shop', name: info.name, hue: info.hue, pos: ent, trig: TILE * 0.9, marker, markerBaseY: my });
    }

    const realCount = Math.min(shopsIn.length, slots.length);
    for (let i = 0; i < realCount; i++) {
      placeBuilding(slots[i], {});
      addShopMarker(slots[i], shopsIn[i]);
    }

    // ── Remaining slots filled generically (capped by density) ──
    const remaining = slots.filter((s) => !s.used);
    const fillCap = Math.max(realCount, Math.round(remaining.length * Math.min(1, 0.5 + density * 0.6)));
    // Buildings past this radius drop their shadow casting (little visible
    // detail, but real cost on the single-light shadow pass). OUTER_R is the
    // walkable radius set above; a few tiles past it is the near/far cutoff.
    const SHADOW_R = OUTER_R + TILE * 6;
    for (let i = 0; i < remaining.length && i < fillCap; i++) {
      const s = remaining[i];
      const far = Math.hypot(s.x, s.z) > SHADOW_R;
      placeBuilding(s, { noShadow: far });
    }

    // ── POI kiosks: quests + cart beside the plaza ───────────
    function poiKiosk(x, z, accentHue, info) {
      // reuse a small detail (parasol) + emissive marker as a kiosk
      const ry = Math.atan2(-x, -z); // face the plaza centre
      put(city, 'build:detail-parasol-a', x, z, ry);
      const my = TILE * 1.8;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 * CITY_SCALE * 0.4, 0.06 * CITY_SCALE * 0.4, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(accentHue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(x, my, z); scene.add(marker);
      circles.push({ x, z, r: TILE * 0.5 });
      interactables.push({ id: info.id, type: info.type, name: info.name, pos: new THREE.Vector3(x, 0, z), trig: TILE * 0.85, marker, markerBaseY: my });
    }
    const kioskR = ROUNDABOUT_R + TILE * 0.9;
    poiKiosk(-kioskR, kioskR, 45, { id: 'quests', type: 'quests', name: 'Quests' });
    poiKiosk(kioskR, kioskR, playerHue, { id: 'cart', type: 'cart', name: 'Cart' });

    // ── Coins scattered along the avenues ────────────────────
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
    function spawnCoin(x, z) {
      const g = new THREE.Group(); g.position.set(x, TILE * 0.5, z);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * CITY_SCALE * 0.45, 0.32 * CITY_SCALE * 0.45, 0.06 * CITY_SCALE * 0.45, 18), coinMat);
      c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
      scene.add(g); coins.push({ g, base: TILE * 0.5, x, z });
    }
    const coinN = Math.round(22 * density);
    for (let i = 0; i < coinN; i++) {
      const arm = arms[i % arms.length];
      const i2 = START_T + Math.random() * ARM;
      // scatter across the road WIDTH (perpendicular to the avenue): for N/S
      // avenues (arm.dz) jitter x; for E/W avenues (arm.dx) jitter z.
      const x = arm.dx * i2 * TILE + (Math.random() - 0.5) * TILE * 0.7 * (arm.dz ? 1 : 0);
      const z = arm.dz * i2 * TILE + (Math.random() - 0.5) * TILE * 0.7 * (arm.dx ? 1 : 0);
      spawnCoin(x, z);
    }

    // play radius = the walkable ring blocks (set above; do NOT let the distant
    // skyline fill below inflate it — that fill is purely visual).
    const WALK_R = OUTER_R;

    // ── Distant skyline fill: cheap low-detail buildings on a coarse grid from
    //    the walkable edge out to the horizon, denser near + thinning out, no
    //    collision, no shadow. Shared-geometry clones keep this cheap. ────────
    const skyline = new THREE.Group();
    scene.add(skyline);
    const FILL_CAP = Math.round((q.tier === 'high' ? 220 : q.tier === 'mid' ? 130 : 60) * (0.6 + density * 0.4));
    const cell = TILE * 2.2;                 // grid spacing between distant buildings
    const innerR = WALK_R + TILE * 1.5;      // start just past the walkable area
    const outerR = WALK_R + cell * 16;       // horizon radius
    let placed = 0;
    const gridN = Math.ceil(outerR / cell);
    // walk a square grid; keep cells in the annulus [innerR, outerR]; skip by a
    // distance-weighted probability so the fill thins toward the horizon.
    outer:
    for (let gx = -gridN; gx <= gridN; gx++) {
      for (let gz = -gridN; gz <= gridN; gz++) {
        if (placed >= FILL_CAP) break outer;
        // jitter each cell so the grid doesn't read as a lattice
        const hjx = hash01(gx * 3.1, gz * 7.7), hjz = hash01(gz * 5.3, gx * 2.9);
        const x = gx * cell + (hjx - 0.5) * cell * 0.7;
        const z = gz * cell + (hjz - 0.5) * cell * 0.7;
        const r = Math.hypot(x, z);
        if (r < innerR || r > outerR) continue;
        // thinning: near the edge keep most; near horizon keep few
        const tNorm = (r - innerR) / (outerR - innerR);     // 0 near .. 1 far
        const keep = 1 - tNorm * 0.7;
        if (hash01(x * 0.7, z * 1.3) > keep) continue;
        const h = hash01(x + 17, z + 5);
        // mostly low-detail boxes, a few skyscrapers as far-tower silhouettes
        const name = h > 0.9
          ? 'build:building-skyscraper-' + SKY[Math.floor(h * SKY.length) % SKY.length]
          : 'build:low-detail-building-' + LOW[Math.floor(h * LOW.length) % LOW.length];
        if (!kit.has(name)) continue;
        const c = kit.get(name);
        c.position.set(x, 0, z);
        c.rotation.y = Math.floor(hash01(z, x) * 4) * (Math.PI / 2);   // axis-aligned variety
        // vary height a little + scale up the farther towers so they read on the horizon
        const vScale = CITY_SCALE * (0.9 + h * 1.4 + tNorm * 0.6);
        c.scale.set(CITY_SCALE * (0.9 + hjx * 0.3), vScale, CITY_SCALE * (0.9 + hjz * 0.3));
        c.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        skyline.add(c);
        placed++;
      }
    }
    // The distant skyline is static (never moves/animates): bake its world
    // matrices once and stop per-frame matrix recomputation for these hundreds
    // of clones to cut idle CPU cost on low/mid tiers.
    skyline.updateMatrixWorld(true);
    skyline.traverse((o) => { o.matrixAutoUpdate = false; });

    // point the sun shadow target at the district centre
    sun.target.position.set(0, 0, 0);

    // ── Place the player at the avenue mouth by the first buildings ──
    player.group.position.set(0, 0, START_Z);
    player.group.rotation.y = Math.PI; // face the plaza / roundabout (−Z)
    blob.position.set(0, 0.05, START_Z);

    // frame the camera behind the player looking at the plaza
    camYaw = 0; camElev = 0.5; camDist = TILE * 5;

    // the minimap is drawn correctly every frame — reveal it now that the
    // district (and its interactable dots) actually exist.
    mini.style.display = 'block';

    started = true;
    opts.onReady && opts.onReady();
  }

  kit.preload(preloadNames).then(() => {
    if (disposed) { kit.dispose(); return; }
    build();
  }).catch(() => {
    // A failed / partial load: free any GPU memory the kit grabbed, then still
    // let the screen proceed (renderer shows the sky clear colour).
    kit.dispose();
    if (!disposed) { started = true; opts.onReady && opts.onReady(); }
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

    // gentle day-light tint cycle
    dayClock += dt; todAccum += dt;
    if (todAccum > 0.5) {
      const cyc = (dayClock % (DAY_PERIOD * 2)) / DAY_PERIOD;
      const tod = cyc <= 1 ? cyc : 2 - cyc; // 0..1..0
      const warm = 0.5 + 0.5 * Math.cos((tod - 0.5) * Math.PI); // warmer at dawn/dusk
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

  // ── API ──────────────────────────────────────────────────
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
      // Scene clones share geometry/material with the kit cache: let scene
      // disposal free those GPU resources first, then kit.dispose() just clears
      // the (now-emptied) cache map.
      disposeScene(scene);
      kit.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    recenter() {
      player.group.position.set(0, 0, START_Z);
      player.group.rotation.y = Math.PI;
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
