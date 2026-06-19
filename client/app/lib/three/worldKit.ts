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
  let spawnX = 0, spawnZ = 0, spawnRy = Math.PI;   // player spawn, set during build()

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

  // ── Build the district: "Veyra Old Quarter" ──────────────
  //  A big OPEN central plaza, four short avenues dividing the map into four
  //  clear QUARTERS, each packed with tall narrow tube-houses threaded by
  //  winding NARROW ALLEYS (ngõ ngách, like Hanoi's Old Quarter). Fewer total
  //  buildings than the old cross+ring sprawl; a thin far skyline for depth.
  function build() {
    if (disposed) return;
    const density = q.propDensity;
    const city = new THREE.Group();
    scene.add(city);

    // grass ground plane (covers the far skyline + fog horizon)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2200, 2200),
      new THREE.MeshStandardMaterial({ color: 0x7fae5f, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // ── Hồ Hoàn Kiếm (Hoan Kiem Lake) — the heart of Hanoi's Old Quarter ──
    const PLAZA_R = TILE * 6.2;       // lake + lakeside promenade zone radius
    const LAKE_R = TILE * 4.4;        // the water
    // lakeside promenade ring (stone path around the water — walkable)
    const promenade = new THREE.Mesh(
      new THREE.RingGeometry(LAKE_R - 1.0, PLAZA_R, 64),
      new THREE.MeshStandardMaterial({ color: 0xc2bba9, roughness: 0.95 }),
    );
    promenade.rotation.x = -Math.PI / 2; promenade.position.y = 0.03; promenade.receiveShadow = true; city.add(promenade);
    // the lake water (Hoan Kiem's famous jade-green)
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(LAKE_R, 72),
      new THREE.MeshStandardMaterial({ color: 0x3f8a63, roughness: 0.16, metalness: 0.35, transparent: true, opacity: 0.92 }),
    );
    water.rotation.x = -Math.PI / 2; water.position.y = 0.07; city.add(water);
    circles.push({ x: 0, z: 0, r: LAKE_R });   // can't walk on the lake; walk the promenade around it

    // a few lakeside trees + lamps on the promenade
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const rr = (LAKE_R + PLAZA_R) / 2;
      put(city, 'road:light-square', Math.cos(a) * rr, Math.sin(a) * rr, -a);
    }

    // Tháp Rùa (Turtle Tower) on a small island at the lake centre
    (function turtleTower() {
      const g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: 0x9a9384, roughness: 0.95 });
      const stoneD = new THREE.MeshStandardMaterial({ color: 0x7f786a, roughness: 0.95 });
      const island = new THREE.Mesh(new THREE.CylinderGeometry(TILE * 1.0, TILE * 1.15, 0.7, 22),
        new THREE.MeshStandardMaterial({ color: 0x6f8a55, roughness: 1 }));
      island.position.y = 0.35; island.receiveShadow = true; g.add(island);
      // tiered tower (base wider, narrowing up)
      const tiers = [[2.0, 2.4, 0.0], [1.7, 2.1, 2.5], [1.35, 1.8, 4.7], [1.0, 1.5, 6.6]];
      tiers.forEach(([rad, h, y], idx) => {
        const t = new THREE.Mesh(new THREE.BoxGeometry(rad * 2, h, rad * 2), idx % 2 ? stoneD : stone);
        t.position.y = 0.7 + y + h / 2; t.castShadow = true; t.receiveShadow = true; g.add(t);
      });
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 4), stoneD);
      cap.rotation.y = Math.PI / 4; cap.position.y = 0.7 + 8.3; cap.castShadow = true; g.add(cap);
      g.scale.setScalar(1.5); city.add(g);
    })();

    // Cầu Thê Húc (red Huc bridge) + Đền Ngọc Sơn (Ngoc Son temple) toward the +Z shore
    (function theHucAndTemple() {
      const red = new THREE.MeshStandardMaterial({ color: 0xd23a26, roughness: 0.7 });
      const iz = LAKE_R * 0.6;   // temple island, just inside the water on the +Z side
      const island = new THREE.Mesh(new THREE.CylinderGeometry(TILE * 0.8, TILE * 0.95, 0.7, 18),
        new THREE.MeshStandardMaterial({ color: 0x6f8a55, roughness: 1 }));
      island.position.set(0, 0.35, iz); island.receiveShadow = true; city.add(island);
      // small temple: pale walls + tiered red roofs (đền Ngọc Sơn)
      const tg = new THREE.Group(); tg.position.set(0, 0.7, iz);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.8, 3.6), new THREE.MeshStandardMaterial({ color: 0xeadcb8, roughness: 0.9 }));
      wall.position.y = 1.4; wall.castShadow = true; tg.add(wall);
      const r1 = new THREE.Mesh(new THREE.ConeGeometry(3.9, 1.6, 4), red); r1.rotation.y = Math.PI / 4; r1.position.y = 3.2; r1.castShadow = true; tg.add(r1);
      const r2 = new THREE.Mesh(new THREE.ConeGeometry(2.8, 1.3, 4), red); r2.rotation.y = Math.PI / 4; r2.position.y = 4.3; tg.add(r2);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.2), new THREE.MeshStandardMaterial({ color: 0x7a2d20 })); door.position.set(0, 0.95, 1.82); tg.add(door);
      tg.scale.setScalar(1.4); city.add(tg);
      // the red arched bridge from the +Z shore to the island
      const startZ = iz + TILE * 0.85, endZ = PLAZA_R - 0.5, span = endZ - startZ;
      const planks = 10;
      for (let i = 0; i < planks; i++) {
        const tnorm = i / (planks - 1);
        const z = startZ + tnorm * span;
        const arch = Math.sin(tnorm * Math.PI) * 1.8;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, span / planks + 0.5), red);
        seg.position.set(0, 0.8 + arch, z); seg.castShadow = true; city.add(seg);
        [-1, 1].forEach((s) => { const rl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, span / planks + 0.5), red); rl.position.set(s * 1.1, 1.35 + arch, z); city.add(rl); });
      }
    })();

    // ── Four short avenues dividing the four quarters ──
    const AVE_START = Math.ceil(PLAZA_R / TILE);    // first road tile out from the plaza
    const AVE = 3;                                   // avenue length (tiles)
    const arms = [
      { dx: 0, dz: 1, roadRy: 0 },
      { dx: 0, dz: -1, roadRy: Math.PI },
      { dx: 1, dz: 0, roadRy: -Math.PI / 2 },
      { dx: -1, dz: 0, roadRy: Math.PI / 2 },
    ];
    const shopSlots = [];   // prime frontage along the avenues
    for (const { dx, dz, roadRy } of arms) {
      const px = -dz, pz = dx;
      for (let i = AVE_START; i < AVE_START + AVE; i++) {
        const x = dx * i * TILE, z = dz * i * TILE;
        put(city, 'road:straight', x, z, roadRy);
        [1, -1].forEach((sgn) => {
          put(city, 'road:side', x + px * sgn * TILE, z + pz * sgn * TILE, roadRy + (sgn > 0 ? 0 : Math.PI));
          const bx = x + px * sgn * 2 * TILE, bz = z + pz * sgn * 2 * TILE;
          shopSlots.push({ x: bx, z: bz, faceRy: Math.atan2(-px * sgn, -pz * sgn), nearPlaza: i <= AVE_START, used: false });
        });
        if (i % 2 === 0) {
          put(city, 'road:light-square', x + px * 0.8 * TILE, z + pz * 0.8 * TILE, roadRy);
          put(city, 'road:light-square', x - px * 0.8 * TILE, z - pz * 0.8 * TILE, roadRy + Math.PI);
        }
      }
    }

    // ── Tube-house placer: tall, narrow footprint, varied — the Hanoi look ──
    function placeHouse(x, z, ry, h, far) {
      const name = h > 0.9
        ? 'build:building-skyscraper-' + SKY[Math.floor(h * SKY.length) % SKY.length]
        : 'build:building-' + BUILD[Math.floor(h * BUILD.length) % BUILD.length];
      if (!kit.has(name)) return;
      const c = kit.get(name);
      c.position.set(x, 0, z); c.rotation.y = ry;
      const sxz = CITY_SCALE * (0.6 + h * 0.18);     // narrow footprint (tube house)
      const sy = CITY_SCALE * (1.0 + h * 1.6);        // tall + varied skyline within the block
      c.scale.set(sxz, sy, sxz);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = !far; o.receiveShadow = true; } });
      city.add(c);
      circles.push({ x, z, r: footprintR(c) + 0.6 });
      // an occasional awning/parasol at street level for shop character
      if (h > 0.6) {
        const det = DETAILS[Math.floor(hash01(z, x) * DETAILS.length) % DETAILS.length];
        const fx = Math.sin(ry), fz = Math.cos(ry);
        put(city, 'build:' + det, x + fx * sxz * 0.9, z + fz * sxz * 0.9, ry);
      }
    }

    // ── Four QUARTERS (diagonal blocks) of packed houses + winding alleys ──
    const CELL = TILE * 0.92;          // tight packing → near-solid walls between houses
    const GRID = 6;                    // cells per quarter side
    const Q_IN = (AVE_START + 1) * TILE;   // inner corner of each quarter (just outside plaza/avenues)
    const quarters = [{ sx: 1, sz: 1 }, { sx: -1, sz: 1 }, { sx: -1, sz: -1 }, { sx: 1, sz: -1 }];
    const alleyCoins = [];
    let houseCount = 0;
    const houseCap = Math.round((q.tier === 'high' ? 999 : q.tier === 'mid' ? 90 : 48) * (0.6 + density * 0.4));
    for (const { sx, sz } of quarters) {
      // a winding vertical alley whose column shifts per row, plus one cross alley
      for (let r = 0; r < GRID; r++) {
        const vAlley = 1 + Math.round(hash01(r * 9.1, sx * 3.7 + sz * 5.3) * 2);  // 1..3, shifts per row
        for (let c = 0; c < GRID; c++) {
          if (houseCount >= houseCap) break;
          const x = sx * (Q_IN + c * CELL);
          const z = sz * (Q_IN + r * CELL);
          const isVAlley = c === vAlley;
          const isHAlley = r === (sx > 0 ? 3 : 2);          // one cross alley (offset per quarter)
          const courtyard = hash01(x * 0.5, z * 0.5) < 0.10; // a few empty courtyards
          if (isVAlley || isHAlley || courtyard) {
            // alley/courtyard cell — drop a coin in some of them
            if (hash01(x + 5, z + 9) > 0.78) alleyCoins.push({ x, z });
            continue;
          }
          if (hash01(x + 3, z + 9) > (0.62 + density * 0.38)) continue;   // density cull
          const h = hash01(x * 1.7 + 5, z * 1.3 + 2);
          const ry = Math.floor(hash01(z, x) * 4) * (Math.PI / 2);
          const far = Math.hypot(x, z) > (Q_IN + GRID * CELL);
          placeHouse(x, z, ry, h, far);
          houseCount++;
        }
      }
    }

    // walkable radius = plaza + avenues + quarter blocks (+ margin)
    OUTER_R = Q_IN + GRID * CELL + TILE * 1.5;

    // ── place a generic shop building on an avenue slot ──
    function placeBuilding(slot, opt) {
      opt = opt || {};
      const hb = hash01(slot.x, slot.z);
      const name = opt.name || pickBuilding(hb, slot.nearPlaza);
      const b = put(city, name, slot.x, slot.z, slot.faceRy);
      const r = (b ? footprintR(b) : TILE * 0.5) + 1.0;
      circles.push({ x: slot.x, z: slot.z, r });
      slot.used = true; slot.buildR = r;
      if (hb > 0.45 || opt.detail) {
        const det = DETAILS[Math.floor(hash01(slot.z, slot.x) * DETAILS.length) % DETAILS.length];
        const fx = Math.sin(slot.faceRy), fz = Math.cos(slot.faceRy);
        put(city, 'build:' + det, slot.x + fx * (r * 0.55), slot.z + fz * (r * 0.55), slot.faceRy);
      }
      return b;
    }

    function addShopMarker(slot, info) {
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

    // ── Real shops at prime avenue frontage; fill a FEW more generically ──
    shopSlots.sort((a, b) => (a.x ** 2 + a.z ** 2) - (b.x ** 2 + b.z ** 2));
    const realCount = Math.min(shopsIn.length, shopSlots.length);
    for (let i = 0; i < realCount; i++) { placeBuilding(shopSlots[i], {}); addShopMarker(shopSlots[i], shopsIn[i]); }
    for (let i = realCount; i < shopSlots.length; i++) {
      if (hash01(shopSlots[i].x + 1, shopSlots[i].z + 2) > 0.5) placeBuilding(shopSlots[i], {});
    }

    // ── POI kiosks: quests + cart at the plaza edge ──────────
    function poiKiosk(x, z, accentHue, info) {
      const ry = Math.atan2(-x, -z);
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
    const promR = (LAKE_R + PLAZA_R) / 2;
    poiKiosk(-promR, -promR * 0.15, 45, { id: 'quests', type: 'quests', name: 'Quests' });
    poiKiosk(promR, -promR * 0.15, playerHue, { id: 'cart', type: 'cart', name: 'Cart' });

    // ── Coins: along the avenues + tucked in the alleys ──────
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
    function spawnCoin(x, z) {
      const g = new THREE.Group(); g.position.set(x, TILE * 0.5, z);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32 * CITY_SCALE * 0.45, 0.32 * CITY_SCALE * 0.45, 0.06 * CITY_SCALE * 0.45, 18), coinMat);
      c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
      scene.add(g); coins.push({ g, base: TILE * 0.5, x, z });
    }
    const coinN = Math.round(14 * density);
    for (let i = 0; i < coinN; i++) {
      const arm = arms[i % arms.length];
      const i2 = AVE_START + Math.random() * AVE;
      const x = arm.dx * i2 * TILE + (Math.random() - 0.5) * TILE * 0.6 * (arm.dz ? 1 : 0);
      const z = arm.dz * i2 * TILE + (Math.random() - 0.5) * TILE * 0.6 * (arm.dx ? 1 : 0);
      spawnCoin(x, z);
    }
    // a handful of coins down the alleys (reward exploration)
    for (let i = 0; i < alleyCoins.length && i < Math.round(10 * density); i++) spawnCoin(alleyCoins[i].x, alleyCoins[i].z);

    const WALK_R = OUTER_R;

    // ── Thin far skyline for depth (much smaller than before) ──
    const skyline = new THREE.Group();
    scene.add(skyline);
    const FILL_CAP = Math.round((q.tier === 'high' ? 70 : q.tier === 'mid' ? 40 : 16) * (0.6 + density * 0.4));
    const cell = TILE * 2.6;
    const innerR = WALK_R + TILE * 2.5;
    const outerR = WALK_R + cell * 12;
    let placed = 0;
    const gridN = Math.ceil(outerR / cell);
    outer:
    for (let gx = -gridN; gx <= gridN; gx++) {
      for (let gz = -gridN; gz <= gridN; gz++) {
        if (placed >= FILL_CAP) break outer;
        const hjx = hash01(gx * 3.1, gz * 7.7), hjz = hash01(gz * 5.3, gx * 2.9);
        const x = gx * cell + (hjx - 0.5) * cell * 0.7;
        const z = gz * cell + (hjz - 0.5) * cell * 0.7;
        const r = Math.hypot(x, z);
        if (r < innerR || r > outerR) continue;
        const tNorm = (r - innerR) / (outerR - innerR);
        if (hash01(x * 0.7, z * 1.3) > (1 - tNorm * 0.6)) continue;
        const h = hash01(x + 17, z + 5);
        const name = h > 0.85
          ? 'build:building-skyscraper-' + SKY[Math.floor(h * SKY.length) % SKY.length]
          : 'build:low-detail-building-' + LOW[Math.floor(h * LOW.length) % LOW.length];
        if (!kit.has(name)) continue;
        const c = kit.get(name);
        c.position.set(x, 0, z);
        c.rotation.y = Math.floor(hash01(z, x) * 4) * (Math.PI / 2);
        const vScale = CITY_SCALE * (0.9 + h * 1.6 + tNorm * 0.6);
        c.scale.set(CITY_SCALE * (0.8 + hjx * 0.3), vScale, CITY_SCALE * (0.8 + hjz * 0.3));
        c.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        skyline.add(c);
        placed++;
      }
    }
    skyline.updateMatrixWorld(true);
    skyline.traverse((o) => { o.matrixAutoUpdate = false; });

    sun.target.position.set(0, 0, 0);

    // ── Spawn on the +Z lakeside, beside the red bridge, facing Turtle Tower ──
    spawnX = TILE * 1.5; spawnZ = PLAZA_R - TILE * 0.7;
    spawnRy = Math.atan2(-spawnX, -spawnZ);   // look toward the lake centre
    player.group.position.set(spawnX, 0, spawnZ);
    player.group.rotation.y = spawnRy;
    blob.position.set(spawnX, 0.05, spawnZ);

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
      player.group.position.set(spawnX, 0, spawnZ);
      player.group.rotation.y = spawnRy;
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
