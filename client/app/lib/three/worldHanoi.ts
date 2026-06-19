// @ts-nocheck -- Veyra walkable 3D world: HANOI, VIETNAM — Hoan Kiem / Old Quarter,
// rebuilt from REAL OpenStreetMap data and rendered hyper-realistic (PBR).
//
// createVeyraWorld(container, opts) -> { dispose, recenter, setLang }
// opts: { playerHue, lite, shops:[{id,hue,name}], onProximity(poi|null),
//         onReady?(), onWeather?({ tempC, label, labelEn, icon, wind }) }
//
// The world is no longer procedural. At runtime we FETCH '/data/hanoi.json' — a
// dump of ~850 real building footprints, ~450 real streets and the Hoan Kiem lake
// polygon, all in local metres (x=east, z=south(+)/north(-), origin = lake centre,
// extentR ~457 m). We then build:
//
//   • PHỐ CỔ (Old Quarter) — every real footprint becomes an upright PBR prism
//     (THREE.Shape → ExtrudeGeometry → stood up). All buildings sharing one of ~6
//     muted Hanoi façade materials are MERGED into a single BufferGeometry, so the
//     entire ~850-building Old Quarter costs only ~6 draw calls.
//   • The real STREET NETWORK — every road polyline is expanded to a flat triangle
//     strip of its real width and the whole network is MERGED into ONE asphalt mesh.
//   • HỒ HOÀN KIẾM (Hoan Kiem Lake) — the true water polygon as a reflective jade
//     ShapeGeometry, ringed by a stone promenade, with the landmark cluster placed
//     on it: THÁP RÙA (Turtle Tower) at the lake centre, CẦU THÊ HÚC (the red bridge)
//     and ĐỀN NGỌC SƠN (Ngoc Son temple) near the north shore.
//
// Composes the SAME shared engine modules as world.ts: quality / environment /
// materials / postfx / buildings / streetprops / controls / avatar / dispose /
// helpers. 1 world unit ≈ 1 metre. Built ASYNCHRONOUSLY (fetch then build); the
// branded loader is held until opts.onReady() fires.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { hsl } from './shared/helpers';
import { createKitLoader } from './shared/assets';
import { createTextureLoader } from './shared/textures';
import { buildAvatar } from './shared/avatar';
import { createKeyboard, createJoystick } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createEnvironment } from './shared/environment';
import { createMaterials } from './shared/materials';
import { createComposer } from './shared/postfx';
import { createBuildings } from './shared/buildings';
import { createStreetProps } from './shared/streetprops';
import { createHanoiFacades } from './shared/hanoiFacades';
import { createHanoiItems } from './shared/hanoiItems';

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
  // Far plane is generous so the procedural skyline + sky read at full pull-back
  // (extentR*2.6 skyline + ~extentR*0.7 of camera dist + margin). Tightened to the
  // real extent once the data is known.
  // near is kept at 0.5 (not 0.1): with the very large far plane needed for the
  // skyline, a tiny near wrecks depth-buffer precision and z-fights the near-flat
  // lake/road/promenade layers (water shimmer/flicker). The camera is third-person
  // and never sits closer than a couple of metres, so 0.5 clips nothing.
  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.5, 4500);
  camera.position.set(0, 40, 120);

  // ── Environment (sky/sun/IBL/tonemap/fog) ────────────────
  // REALISTIC Hanoi: the sun is driven by the REAL current Hanoi local time and the
  // sky/weather by REAL Open-Meteo data (see the loop below). No forced-bright
  // overrides — environment.setTimeOfDay()/setWeather() carry the look naturally so
  // night is night and noon is bright, soft and never blown out.
  const environment = createEnvironment(renderer, scene, {
    quality: q,
    // HDRI IBL for richer real-sky reflections (skipped on LOW → dynamic Sky IBL).
    envHdrUrl: q.tier === 'low' ? null : '/textures/env/sky_1k.hdr',
  });

  // Vietnam is UTC+7 (no DST). Compute Hanoi local hour from the device clock.
  function hanoiHour() {
    const d = new Date();
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const hcm = new Date(utc + 7 * 3600000);
    return hcm.getHours() + hcm.getMinutes() / 60;     // 0..24
  }
  // tod = hour/24 → environment maps 0=dawn, 0.5=noon, 1=dusk via sin(t·π) elevation.
  environment.setTimeOfDay(hanoiHour() / 24);
  // Mild default weather until the first Open-Meteo fetch resolves.
  environment.setWeather({ overcast: 0.25, rain: 0 });
  // Realistic, non-blown-out base exposure (ACES). Bloom is reduced below.
  renderer.toneMappingExposure = 0.95;

  // ── Materials (PBR). Reflections come from scene.environment (auto). ─────────
  const mats = createMaterials({ anisotropy: q.anisotropy });

  // ── Post-processing composer (adaptive) ──────────────────
  const post = createComposer(renderer, scene, camera, { quality: q });
  // Subtle bloom for a natural, non-glaring look (was 0.22). Set once — there is no
  // synthetic day/night ramp anymore; the real-time sun carries the mood.
  post.setBloom(0.12);

  // ── Builders ─────────────────────────────────────────────
  const buildings = createBuildings(mats);
  const props = createStreetProps(mats);
  const density = q.propDensity;
  const facades = createHanoiFacades(THREE);
  const items = createHanoiItems(THREE);
  const itemGroups = [];  // item root groups (geometry freed by items.dispose())

  // ── External CC0 assets (textures + GLB), all with procedural fallbacks ──
  const texer = createTextureLoader({ anisotropy: q.anisotropy });
  const kit = createKitLoader();
  // CC0 Kenney Nature Kit trees (green broadleaf + a palm); fewer varieties on low.
  const TREE_GLBS = q.tier === 'low'
    ? ['/models/nature/tree_default.glb', '/models/nature/tree_oak.glb', '/models/nature/tree_tall.glb']
    : ['/models/nature/tree_default.glb', '/models/nature/tree_detailed.glb', '/models/nature/tree_oak.glb',
       '/models/nature/tree_fat.glb', '/models/nature/tree_tall.glb', '/models/nature/tree_palmTall.glb'];
  // Kick GLB preloads off immediately (resolved before build() places them).
  const kitReady = kit.preloadUrls(
    q.tier === 'low' ? TREE_GLBS : [...TREE_GLBS, 'build:detail-awning', 'build:detail-parasol-a'],
  );

  // Configure façade material tiling ONCE: walls are UV-mapped in METRES, so each
  // map repeats every (tileWidth × tileHeight) metres. DoubleSide because the walls
  // are single-quad soups (winding-agnostic) — this fixes shading + visibility.
  const FW = facades.tileWidth, FH = facades.tileHeight;
  for (const fm of facades.materials) {
    fm.side = THREE.DoubleSide;            // walls are single-quad soups; DoubleSide fixes winding + shading
    for (const mp of [fm.map, fm.emissiveMap, fm.roughnessMap]) {
      if (mp) { mp.wrapS = THREE.RepeatWrapping; mp.wrapT = THREE.RepeatWrapping; mp.repeat.set(1 / FW, 1 / FH); mp.needsUpdate = true; }
    }
  }
  // Base window-glow per façade material so we can ramp lit windows up at night.
  const facadeEmissiveBase = facades.materials.map((m) => (m.emissiveIntensity != null ? m.emissiveIntensity : 0.8));
  // Ramp the city's lit windows: dim by day (~0.12×), bright by night (~1.5×).
  function setFacadeNight(night) {
    for (let i = 0; i < facades.materials.length; i++) {
      facades.materials[i].emissiveIntensity = facadeEmissiveBase[i] * (0.12 + night * 1.4);
    }
  }

  // ── Hanoi-specific landmark materials (a few dedicated tints) ─────
  const redPaint = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6, metalness: 0.0 });   // The Huc vermilion
  const roofTile = new THREE.MeshStandardMaterial({ color: hsl(14, 0.5, 0.34), roughness: 0.78, metalness: 0.0 }); // temple terracotta
  const mossStone = new THREE.MeshStandardMaterial({ color: hsl(86, 0.16, 0.42), roughness: 0.96, metalness: 0.0 }); // weathered stone
  const darkWood = new THREE.MeshStandardMaterial({ color: hsl(26, 0.42, 0.22), roughness: 0.82, metalness: 0.0 });  // temple timber
  const localMats = [redPaint, roofTile, mossStone, darkWood];
  // Geometries we allocate directly here (merged city, roads, lake, landmarks) so
  // dispose() can free them precisely (disposeScene also walks the graph, but we
  // keep explicit refs for the big merged buffers).
  const ownedGeoms = [];
  const ownedInstanced = [];   // InstancedMeshes (trees) — need explicit .dispose()
  const ownedTextures = [];    // CanvasTextures (gate labels) — need explicit .dispose()

  const circles = [];        // collision: { x, z, r }
  const interactables = [];  // { id, type, name, pos, trig, marker?, markerBaseY? }

  // Spatial hash over the collision circles so the per-frame resolve stays fast
  // even with thousands of furniture/building blockers. Built once at end of build().
  let grid = null, gridB = null; const GCELL = 8;
  // Each building footprint gets accurate POLYGON collision (not a bounding
  // circle, which over-blocked the narrow Old-Quarter alleys / ngõ ngách).
  const buildingPolys = [];
  // Height-follow targets for the arched bridge + temple island (set by the
  // landmark builders) so the player can walk UP the deck and onto the island.
  let bridgeInfo = null, islandInfo = null;
  function addBldgCollision(poly) {
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const p of poly) { if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]; if (p[1] < mnz) mnz = p[1]; if (p[1] > mxz) mxz = p[1]; }
    buildingPolys.push({ poly, minx: mnx, maxx: mxx, minz: mnz, maxz: mxz });
  }
  function buildGrid() {
    grid = new Map();
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const x0 = Math.floor((c.x - c.r) / GCELL), x1 = Math.floor((c.x + c.r) / GCELL);
      const z0 = Math.floor((c.z - c.r) / GCELL), z1 = Math.floor((c.z + c.r) / GCELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx + '_' + gz; let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
      }
    }
    gridB = new Map();
    for (let i = 0; i < buildingPolys.length; i++) {
      const b = buildingPolys[i];
      const x0 = Math.floor(b.minx / GCELL), x1 = Math.floor(b.maxx / GCELL);
      const z0 = Math.floor(b.minz / GCELL), z1 = Math.floor(b.maxz / GCELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx + '_' + gz; let a = gridB.get(k); if (!a) { a = []; gridB.set(k, a); } a.push(i);
      }
    }
  }

  // deterministic per-position pseudo-random so dressing is varied but stable
  const hash01 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

  // Procedural tiling normal map for the lake (fallback if the real JPG 404s).
  function makeWaterNormals(size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const h = (x, y) => {
      let v = 0, amp = 1, f = 1;
      for (let o = 0; o < 4; o++) {
        v += amp * Math.sin((x * 0.13 + y * 0.07) * f + o) * Math.cos((x * 0.05 - y * 0.11) * f - o);
        amp *= 0.5; f *= 2.0;
      }
      return v;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 0.5, ny = -dy * 0.5, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      img.data[i] = (nx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // Build a Three.js Water on a flat (XY) geometry. The caller sets rotation.x =
  // -PI/2 + position so Water derives the correct upward reflection-plane normal.
  function makeLakeWater(geo) {
    if (!waterNormals) waterNormals = makeWaterNormals(q.tier === 'low' ? 128 : 256);
    // Reflection render-target: kept modest for a smooth extra full-scene pass on a
    // large OSM city (water reflections read fine at these sizes).
    const reflRT = q.tier === 'high' ? 512 : q.tier === 'mid' ? 256 : 128;
    const w = new Water(geo, {
      textureWidth: reflRT,
      textureHeight: reflRT,
      waterNormals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: new THREE.Color().setHSL(168 / 360, 0.45, 0.22).getHex(), // jade Hoan Kiem
      distortionScale: 2.4,
      fog: !!scene.fog,
      alpha: 0.95,
    });
    // Bias the surface toward the camera so it reliably wins the z-test against the
    // near-coplanar road/promenade/ground layers under the lake (no shimmer).
    w.material.polygonOffset = true;
    w.material.polygonOffsetFactor = -2;
    w.material.polygonOffsetUnits = -2;
    w.renderOrder = 1;

    // Wind-DIRECTION drift: Water's built-in noise scroll is fixed-direction. Inject a
    // uWindShift uniform and offset the noise sampling coordinate by it, so the whole
    // ripple field visibly flows downwind. The shift is accumulated each frame from the
    // real wind direction (windDir) in the render loop.
    w.material.uniforms.uWindShift = { value: waterWindShift };
    w.material.fragmentShader = w.material.fragmentShader
      .replace('uniform float size;', 'uniform float size;\n\t\t\t\tuniform vec2 uWindShift;')
      .replace('getNoise( worldPosition.xz * size )', 'getNoise( worldPosition.xz * size + uWindShift )');
    w.material.needsUpdate = true;
    return w;
  }

  // Attach the wind-sway vertex shader to a foliage material (GLB or procedural).
  // weight = local vertex height; displacement is in LOCAL space so it scales with
  // the per-instance tree size. Shared swayUniforms are driven each frame.
  function attachSway(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = swayUniforms.uTime;
      shader.uniforms.uWind = swayUniforms.uWind;
      shader.uniforms.uWindDir = swayUniforms.uWindDir;
      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uWindDir;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float swayPhase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.15;
         float swayAmt = sin(uTime * 1.6 + swayPhase) * (0.03 + uWind * 0.12) * max(position.y, 0.0);
         transformed.x += cos(uWindDir) * swayAmt;
         transformed.z += sin(uWindDir) * swayAmt;`,
      );
    };
    mat.needsUpdate = true;
  }

  // Build the ~800 OSM trees from instanced Kenney GLB varieties (one InstancedMesh
  // per variety per primitive → a handful of draw calls). Returns false to fall back
  // to the procedural trees. `treeUrls` are already-preloaded GLB URLs.
  function buildGltfTrees(treeList, treeUrls, castShadows) {
    const varieties = [];
    for (const url of treeUrls) {
      const root = kit.getByUrl(url);
      root.updateMatrixWorld(true);
      const prims = [];
      root.traverse((o) => {
        if (o.isMesh && o.geometry) {
          // Bake the node's transform into a cloned geometry (instancing ignores the
          // node hierarchy), so each primitive sits correctly with its base at y≈0.
          const geo = o.geometry.clone();
          geo.applyMatrix4(o.matrixWorld);
          geo.computeBoundingBox();
          prims.push({ geo, mat: o.material });
        }
      });
      if (!prims.length) continue;
      let maxY = 0;
      for (const p of prims) maxY = Math.max(maxY, p.geo.boundingBox.max.y);
      varieties.push({ prims, h: maxY || 1 });
    }
    if (!varieties.length) return false;

    // Wind sway on each variety's foliage material (name ~ leaf/green); ensure matte.
    const swayed = new Set();
    for (const v of varieties) for (const p of v.prims) {
      if (!p.mat) continue;
      const nm = (p.mat.name || '').toLowerCase();
      if ((nm.includes('leaf') || nm.includes('green')) && !swayed.has(p.mat)) { attachSway(p.mat); swayed.add(p.mat); }
      p.mat.metalness = 0;
    }

    // Assign each tree to a variety (seeded by position); count per variety.
    const assign = new Array(treeList.length);
    const counts = new Array(varieties.length).fill(0);
    for (let i = 0; i < treeList.length; i++) {
      const vi = Math.floor(hash01(treeList[i][0] * 3.1 + 7, treeList[i][1] * 1.7 - 3) * varieties.length) % varieties.length;
      assign[i] = vi; counts[vi]++;
    }
    // Create the instanced meshes.
    for (let vi = 0; vi < varieties.length; vi++) {
      const v = varieties[vi];
      v.insts = v.prims.map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, counts[vi]);
        im.castShadow = castShadows; im.receiveShadow = false; im.frustumCulled = false;
        ownedGeoms.push(p.geo);   // we own the baked clones
        return im;
      });
    }
    // Fill per-instance transforms (scale to a realistic 3.5–7 m height, random yaw).
    const m = new THREE.Matrix4(), qrot = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const vIdx = new Array(varieties.length).fill(0);
    for (let i = 0; i < treeList.length; i++) {
      const tx = treeList[i][0], tz = treeList[i][1];
      circles.push({ x: tx, z: tz, r: 0.5 });   // trunk collision
      const v = varieties[assign[i]];
      const r1 = hash01(tx + 1.7, tz - 2.3), r3 = hash01(tx * 2.1 + 5, tz);
      const s = (3.5 + r1 * 3.5) / v.h;
      qrot.setFromAxisAngle(up, r3 * Math.PI * 2);
      pos.set(tx, 0, tz); scl.set(s, s, s);
      m.compose(pos, qrot, scl);
      const li = vIdx[assign[i]]++;
      for (const im of v.insts) im.setMatrixAt(li, m);
    }
    for (const v of varieties) for (const im of v.insts) {
      im.instanceMatrix.needsUpdate = true;
      im.matrixAutoUpdate = false; im.updateMatrix();
      scene.add(im); ownedInstanced.push(im);
    }
    return true;
  }

  // ── Runtime state shared between the async build and the API/loop ─────────
  let disposed = false;
  let ready = false;
  let raf = 0, running = true;
  let player = null, parts = null, blob = null;
  let SPAWN = new THREE.Vector3(0, 0, -300);   // overwritten once the lake is known
  let spawnYaw = 0;                            // facing-the-lake rotation at spawn
  let MAXR = 520;                              // player clamp radius (extentR + margin)
  // Orbit-zoom range. CAM_MAX is raised to ~extentR*0.7 in build() so the player can
  // pull WAY back to an aerial survey of the whole Old Quarter, then zoom to street level.
  let CAM_MIN = 8, CAM_MAX = 420, CAM_ELEV_MAX = 1.5;
  let skylinePlaced = 0;                       // count of procedural backdrop boxes

  // ── Lake (Three.js Water) + wind + GLB/anim state ─────────
  let water = null;            // reflective animated lake
  let waterNormals = null;     // normal texture (real or procedural fallback)
  let windDir = 0;             // radians; ripple drift direction (from weather)
  const waterWindShift = new THREE.Vector2(0, 0); // accumulated downwind drift of the ripples
  let birdMesh = null;         // instanced bird flock (built in build())
  const birdParams = [];       // per-bird orbit params
  const charMixers = [];       // AnimationMixers for the animated hero NPCs
  const charRoots = [];        // their root Object3Ds (cleaned up on dispose)
  // Tree foliage wind-sway uniforms (bound in build() onBeforeCompile).
  const swayUniforms = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: 0 } };

  // ── Perimeter-gate / auth state ──────────────────────────
  // Unauthenticated players spawn OUTSIDE the fence and must clear a gate's
  // ticket check to come in. `entered` flips true once they're inside the ring.
  let fenceR = 0;                              // perimeter fence radius (set in build)
  let entered = !!opts.authed;                 // inside the fence? guests start outside
  const openGates = Object.create(null);       // gate key -> true once the ticket is accepted
  let nearGate = null;                         // gate the guest is standing at (or null)
  let autoEnter = null;                        // { a } — after a ticket clears, auto-walk the player IN
  let nameTag = null;                          // floating username sprite above the player
  let vy = 0;                                  // player vertical velocity (jump)
  const liveGuards = [];                       // detailed guards to idle-animate { g, ph }
  let perim = null;                            // instanced perimeter-guard patrol state

  // ─────────────────────────────────────────────────────────────────────────
  //  BUILD — runs after the data fetch resolves (or after a fallback on error).
  //  `data` may be null; we then render just ground + a nominal lake + landmarks
  //  so the world never hangs.
  // ─────────────────────────────────────────────────────────────────────────
  async function build(data) {
    if (disposed) return;

    // ── External CC0 assets (parallel; each resolves null → procedural fallback) ──
    const [waterNormalTex, asphaltSet, pavingSet, plasterSet] = await Promise.all([
      texer.loadDataTex('/textures/water/waternormals.jpg', [1, 1]),
      q.tier === 'low' ? null : texer.loadPBR('/textures/ground/asphalt', [1, 1]),
      q.tier === 'low' ? null : texer.loadPBR('/textures/ground/paving', [1, 1]),
      q.tier === 'low' ? null : texer.loadPBR('/textures/wall/plaster', [1, 1]),
    ]);
    await kitReady;
    if (disposed) return;
    waterNormals = waterNormalTex;   // may be null → makeWaterNormals() fallback in lake build
    // Bind PBR maps onto the shared ground/wall materials (no-op if null).
    mats.applyPBR && mats.applyPBR({ asphalt: asphaltSet, paving: pavingSet, plaster: plasterSet });

    const extentR = data && data.extentR ? data.extentR : 457;
    MAXR = extentR + 30;
    fenceR = MAXR + 4;                      // fence sits just beyond the clamp radius
    const WORLD_R = extentR * 1.25;
    const SKYLINE_OUTER = extentR * 2.6;   // procedural skyline reaches to here

    // ── Camera range now that the real extent is known ──
    // Pull-back to an aerial survey (~extentR*0.7), tighter near plane for the city.
    CAM_MAX = Math.round(extentR * 0.7);
    camDist = Math.min(CAM_MAX, 60);       // pleasant street-ish default on spawn
    camera.far = SKYLINE_OUTER + CAM_MAX + 600;
    camera.updateProjectionMatrix();

    // ── GROUND — a large warm-earth plane under everything (covers the skyline) ──
    const groundMat = new THREE.MeshStandardMaterial({ color: hsl(40, 0.1, 0.42), roughness: 1, metalness: 0 });
    const groundGeo = new THREE.CircleGeometry(SKYLINE_OUTER + extentR * 0.4, 96);
    ownedGeoms.push(groundGeo);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    localMats.push(groundMat);

    // Fog pushed OUT so the distant skyline reads clearly. The environment.setWeather()
    // already tinted/positioned the fog for the current sky mood; we only widen the
    // base distances to the real city extent, then let applyFog() nudge them by the
    // current overcast (more cloud → fog a touch nearer, never grey soup).
    fogNear = extentR * 0.85;
    fogFar = extentR * 3.2;
    applyFog(curOvercast);

    // ──────────────── GREENS — real parks / lawns / pitches ───────────────
    // Each green polygon → a flat filled ShapeGeometry patch on the ground. We
    // MERGE all patches by kind into 1–2 meshes (lawn green for parks/gardens, a
    // slightly different sport-green for pitches). They sit just under the roads
    // (y=0.03) so the street network draws cleanly over any overlap.
    const greenList = (data && data.greens) ? data.greens : [];
    if (greenList.length) {
      const lawnMat = new THREE.MeshStandardMaterial({ color: hsl(104, 0.34, 0.36), roughness: 1, metalness: 0 });
      const pitchMat = new THREE.MeshStandardMaterial({ color: hsl(128, 0.40, 0.32), roughness: 1, metalness: 0 });
      // polygonOffset so the greens never z-fight against the ground beneath them.
      lawnMat.polygonOffset = true; lawnMat.polygonOffsetFactor = -1; lawnMat.polygonOffsetUnits = -1;
      pitchMat.polygonOffset = true; pitchMat.polygonOffsetFactor = -1; pitchMat.polygonOffsetUnits = -1;
      localMats.push(lawnMat, pitchMat);
      const lawnGeoms = [], pitchGeoms = [];
      for (const gr of greenList) {
        const poly = gr.poly;
        if (!poly || poly.length < 3) continue;
        const shp = new THREE.Shape();
        shp.moveTo(poly[0][0], -poly[0][1]);
        for (let i = 1; i < poly.length; i++) shp.lineTo(poly[i][0], -poly[i][1]);
        let pg;
        try { pg = new THREE.ShapeGeometry(shp); } catch (_) { continue; }
        if (!pg.attributes.position || pg.attributes.position.count < 3) { pg.dispose(); continue; }
        pg.rotateX(-Math.PI / 2);
        pg.deleteAttribute('uv');
        (gr.kind === 'pitch' ? pitchGeoms : lawnGeoms).push(pg);
      }
      const addGreen = (list, mat) => {
        if (!list.length) return;
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        if (!merged) return;
        ownedGeoms.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.position.y = 0.06; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        scene.add(mesh);
      };
      addGreen(lawnGeoms, lawnMat);   // parks/gardens/grass → 1 mesh
      addGreen(pitchGeoms, pitchMat); // sports pitches → 1 mesh
    }

    // ───────────────────────── HỒ HOÀN KIẾM (the lake) ─────────────────────
    // Build the water mesh straight from the real water polygon. Compute its
    // area-weighted centroid + a representative radius so the landmarks and the
    // shore promenade can be sized/placed to the true lake.
    let lakeCx = 0, lakeCz = -20, lakeR = 110, lakeNorthZ = -300;
    const lakePoly = (data && data.water && data.water[0]) ? data.water[0] : null;

    if (lakePoly && lakePoly.length >= 3) {
      // area-weighted centroid (shoelace)
      let A = 0, cx = 0, cz = 0;
      for (let i = 0; i < lakePoly.length; i++) {
        const p = lakePoly[i], n = lakePoly[(i + 1) % lakePoly.length];
        const cr = p[0] * n[1] - n[0] * p[1];
        A += cr; cx += (p[0] + n[0]) * cr; cz += (p[1] + n[1]) * cr;
      }
      A *= 0.5;
      if (Math.abs(A) > 1) { lakeCx = cx / (6 * A); lakeCz = cz / (6 * A); }
      // mean vertex radius (for landmark scaling) + northernmost edge (min z)
      let sum = 0, minZ = Infinity, minZx = 0;
      for (const p of lakePoly) {
        sum += Math.hypot(p[0] - lakeCx, p[1] - lakeCz);
        if (p[1] < minZ) { minZ = p[1]; minZx = p[0]; }
      }
      lakeR = sum / lakePoly.length;
      lakeNorthZ = minZ;

      // Water surface — a reflective animated Three.js Water built on the REAL
      // ~120-pt Hoan Kiem polygon. Shape is in X/-Y so that the mesh's own
      // rotation.x=-PI/2 (NOT a baked geometry rotation — Water derives its
      // reflection-plane normal from the mesh transform) lands it in world XZ.
      const shape = new THREE.Shape();
      lakePoly.forEach((p, i) => { if (i === 0) shape.moveTo(p[0], -p[1]); else shape.lineTo(p[0], -p[1]); });
      let waterGeo = new THREE.ShapeGeometry(shape);
      // Guard: if earcut chokes on the (slightly concave) real polygon and yields a
      // degenerate triangulation, fall back to an oval sized to the lake bbox.
      const triCount = waterGeo.index ? waterGeo.index.count / 3 : waterGeo.attributes.position.count / 3;
      if (!(triCount >= lakePoly.length - 6) || !isFinite(triCount)) {
        waterGeo.dispose();
        let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
        for (const p of lakePoly) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
        const ell = new THREE.Shape();
        ell.absellipse(lakeCx, -lakeCz, (bx1 - bx0) / 2, (bz1 - bz0) / 2, 0, Math.PI * 2, false, 0);
        waterGeo = new THREE.ShapeGeometry(ell, 64);
      }
      ownedGeoms.push(waterGeo);
      water = makeLakeWater(waterGeo);
      water.rotation.x = -Math.PI / 2; water.position.y = 0.18; scene.add(water);

      // Sunk lake-bed slab just under the water so the rim never reveals ground.
      const bedShape = new THREE.Shape();
      lakePoly.forEach((p, i) => { if (i === 0) bedShape.moveTo(p[0], -p[1]); else bedShape.lineTo(p[0], -p[1]); });
      const bedGeo = new THREE.ShapeGeometry(bedShape);
      bedGeo.rotateX(-Math.PI / 2);
      ownedGeoms.push(bedGeo);
      const bedMat = new THREE.MeshStandardMaterial({ color: hsl(150, 0.2, 0.1), roughness: 1, metalness: 0 });
      localMats.push(bedMat);
      const bed = new THREE.Mesh(bedGeo, bedMat);
      bed.position.y = -0.9; scene.add(bed);

      // Stone promenade ring — a band just OUTSIDE the water edge, built by
      // offsetting the polygon outward from the centroid (walkable shore).
      const promW = 7;
      const promPos = [];
      const promIdx = [];
      const n = lakePoly.length;
      for (let i = 0; i < n; i++) {
        const p = lakePoly[i];
        const ux = p[0] - lakeCx, uz = p[1] - lakeCz;
        const ul = Math.hypot(ux, uz) || 1;
        const ox = (ux / ul) * promW, oz = (uz / ul) * promW;
        // inner edge (at the water rim), outer edge (promW out)
        promPos.push(p[0], 0.10, p[1]);                 // inner
        promPos.push(p[0] + ox, 0.10, p[1] + oz);       // outer
      }
      for (let i = 0; i < n; i++) {
        const a = (i * 2), b = (i * 2 + 1);
        const c = (((i + 1) % n) * 2), d = (((i + 1) % n) * 2 + 1);
        promIdx.push(a, c, b,  b, c, d);
      }
      const promGeo = new THREE.BufferGeometry();
      promGeo.setAttribute('position', new THREE.Float32BufferAttribute(promPos, 3));
      promGeo.setIndex(promIdx);
      promGeo.computeVertexNormals();
      ownedGeoms.push(promGeo);
      const prom = new THREE.Mesh(promGeo, mats.paving);
      prom.receiveShadow = true; scene.add(prom);

      // LAKE COLLISION: a fence of blocker circles along the real water rim so the
      // player walks the shore but cannot step onto the water. Sample the polygon
      // edges at ~6 m spacing.
      const fr = 3.0;
      for (let i = 0; i < n; i++) {
        const p = lakePoly[i], nx = lakePoly[(i + 1) % n];
        const segLen = Math.hypot(nx[0] - p[0], nx[1] - p[1]);
        const steps = Math.max(1, Math.round(segLen / 6));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          // pull slightly inward (toward the water) so the player can reach the rail
          const x = p[0] + (nx[0] - p[0]) * t;
          const z = p[1] + (nx[1] - p[1]) * t;
          // Leave a GAP at the bridge mouth so The Huc bridge corridor over the
          // water isn't fenced (the player can walk out to the temple island).
          if (Math.abs(x - lakeCx) < 3.0 && z > lakeNorthZ - 3 && z < lakeNorthZ + 11) continue;
          const ux = x - lakeCx, uz = z - lakeCz, ul = Math.hypot(ux, uz) || 1;
          circles.push({ x: x + (ux / ul) * 0.6, z: z + (uz / ul) * 0.6, r: fr });
        }
      }
    } else {
      // No water data: a nominal circular jade lake (still reflective Water).
      lakeR = 110;
      const wGeo = new THREE.CircleGeometry(lakeR, 96); ownedGeoms.push(wGeo);
      water = makeLakeWater(wGeo);
      water.rotation.x = -Math.PI / 2; water.position.set(lakeCx, 0.18, lakeCz); scene.add(water);
      const promGeo = new THREE.RingGeometry(lakeR, lakeR + 7, 96, 1); ownedGeoms.push(promGeo);
      const prom = new THREE.Mesh(promGeo, mats.paving);
      prom.rotation.x = -Math.PI / 2; prom.position.set(lakeCx, 0.10, lakeCz); prom.receiveShadow = true; scene.add(prom);
      lakeNorthZ = lakeCz - lakeR;
      const fenceN = 64;
      for (let i = 0; i < fenceN; i++) { const a = (i / fenceN) * Math.PI * 2; circles.push({ x: lakeCx + Math.cos(a) * (lakeR + 0.5), z: lakeCz + Math.sin(a) * (lakeR + 0.5), r: 3.0 }); }
    }

    // ───────────────── PHỐ CỔ (Old Quarter) — real footprints ─────────────
    // Each footprint becomes a TEXTURED façade: walls are a non-indexed quad soup
    // UV-mapped in METRES (u = perimeter distance, v = height) so the tileable
    // Hanoi façade textures (shopfront-at-street, repeating upper floors) land
    // correctly. Buildings are MERGED by façade material → ~14 wall draw calls.
    // A flat roof CAP closes each prism on top, and the nearest buildings get a
    // procedural rooftop topper (water tank / AC / laundry / parapet).
    const bucketGeoms = facades.materials.map(() => []);  // per-material wall geometry lists
    const roofGeoms = [];                                  // flat roof caps (one merged mesh)
    const roofMat = new THREE.MeshStandardMaterial({ color: hsl(28, 0.06, 0.34), roughness: 0.95, metalness: 0 });
    localMats.push(roofMat);
    // Pitched terracotta-tiled hip roofs (one merged mesh). Most low Hanoi
    // tube-houses get one of these instead of a flat cap; the rest stay flat.
    const roofTileMat = new THREE.MeshStandardMaterial({ color: hsl(14, 0.5, 0.34), roughness: 0.82, metalness: 0 });
    localMats.push(roofTileMat);
    const roofTileGeoms = [];                              // pitched hip roofs (one merged mesh)
    const pitchedSet = new Set();                          // polys given a pitched roof (skip flat detail)

    let buildList = (data && data.buildings) ? data.buildings : [];
    // LOW tier: cap to the ~350 buildings nearest the lake centre (keep the core).
    if (q.tier === 'low' && buildList.length > 350) {
      buildList = buildList
        .map((b) => {
          let x = 0, z = 0; for (const p of b.poly) { x += p[0]; z += p[1]; }
          const cx2 = x / b.poly.length, cz2 = z / b.poly.length;
          return { b, d: (cx2 - lakeCx) ** 2 + (cz2 - lakeCz) ** 2 };
        })
        .sort((a, c) => a.d - c.d)
        .slice(0, 350)
        .map((e) => e.b);
    }

    let builtCount = 0;
    for (const b of buildList) {
      const poly = b.poly;
      if (!poly || poly.length < 3) continue;
      const h = b.h && b.h > 0 ? b.h : 7;

      // footprint centroid + radius (for collision + material hashing)
      let cx2 = 0, cz2 = 0;
      for (const p of poly) { cx2 += p[0]; cz2 += p[1]; }
      cx2 /= poly.length; cz2 /= poly.length;
      let rad = 0;
      for (const p of poly) rad = Math.max(rad, Math.hypot(p[0] - cx2, p[1] - cz2));

      // ── WALLS: a non-indexed quad soup with METRE UVs. Each edge becomes two
      // triangles; u = cumulative perimeter metres, v = height in metres (0 at the
      // street, h at the eaves). The repeat set in step 2 converts metres→tiles, so
      // the shopfront row of the texture sits exactly on the pavement.
      // Inset the footprint slightly toward the centroid before building walls +
      // roof cap, so abutting Old-Quarter neighbours no longer share a COPLANAR
      // wall (which z-fights with DoubleSide quads). Collision stays on the
      // ORIGINAL centroid + rad below.
      const inset = (p) => [p[0] + (cx2 - p[0]) * 0.04, p[1] + (cz2 - p[1]) * 0.04];

      const N = poly.length;
      const wpos = [];
      const wuv = [];
      let perim = 0;
      for (let i = 0; i < N; i++) {
        const a = inset(poly[i]), b2 = inset(poly[(i + 1) % N]);
        const ax = a[0], az = a[1], bx = b2[0], bz = b2[1];
        const segLen = Math.hypot(bx - ax, bz - az);
        const u0 = perim, u1 = perim + segLen;
        // four corners: a-bottom(a0), b-bottom(b0), b-top(b1), a-top(a1)
        // positions feed +z so the wall lands at true world z (matches the rest of
        // the world, which builds shapes from -poly[1]); here we use raw poly z and
        // since walls are flat quads + DoubleSide, winding is irrelevant.
        // a0
        const A0 = [ax, 0, az], B0 = [bx, 0, bz], B1 = [bx, h, bz], A1 = [ax, h, az];
        const uA0 = [u0, 0], uB0 = [u1, 0], uB1 = [u1, h], uA1 = [u0, h];
        // tri 1: a0, b0, b1
        wpos.push(...A0, ...B0, ...B1); wuv.push(...uA0, ...uB0, ...uB1);
        // tri 2: a0, b1, a1
        wpos.push(...A0, ...B1, ...A1); wuv.push(...uA0, ...uB1, ...uA1);
        perim = u1;
      }
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wgeo.computeVertexNormals();
      bucketGeoms[facades.pickVariant(hash01(cx2 + 3.1, cz2 - 1.7), h)].push(wgeo);

      // ── ROOF TYPE: seeded choice between a pitched terracotta hip roof and a
      // flat cap. Most low tube-houses (and a few mid ones) get a tiled hip roof
      // tracing the true footprint; everything tall stays flat (with clutter).
      const rseed = hash01(cx2 * 1.7 + 9.1, cz2 * 1.3 - 4.2);
      const pitched = (h <= 16 && rseed < 0.62) || (h > 16 && h <= 24 && rseed < 0.22);

      if (pitched) {
        // footprint bbox → roof height (capped, scaled by the smaller span)
        let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
        for (const p of poly) {
          if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
          if (p[1] < minz) minz = p[1]; if (p[1] > maxz) maxz = p[1];
        }
        const bw = maxx - minx, bd = maxz - minz;
        if (bw > 0 && bd > 0) {
          const roofH = Math.max(1.6, Math.min(4, Math.min(bw, bd) * 0.32));
          // eave ring = ORIGINAL footprint at y=h, expanded ~6% outward for a small
          // overhang past the walls. Each footprint edge → one triangle to the apex
          // at the centroid (h + roofH). Positions are world-space (x, y, z).
          const apexX = cx2, apexY = h + roofH, apexZ = cz2;
          const tpos = [];
          for (let i = 0; i < N; i++) {
            const a = poly[(i - 1 + N) % N], b3 = poly[i];
            const aX = a[0] + (a[0] - cx2) * 0.06, aZ = a[1] + (a[1] - cz2) * 0.06;
            const bX = b3[0] + (b3[0] - cx2) * 0.06, bZ = b3[1] + (b3[1] - cz2) * 0.06;
            tpos.push(aX, h, aZ, bX, h, bZ, apexX, apexY, apexZ);
          }
          const tg = new THREE.BufferGeometry();
          tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
          tg.computeVertexNormals();
          roofTileGeoms.push(tg);
          pitchedSet.add(poly);
          builtCount++;
          // collision: accurate footprint polygon (narrow alleys stay walkable)
          addBldgCollision(poly);
          continue;   // pitched roof replaces the flat cap; walls already pushed
        }
        // degenerate bbox → fall through to the flat cap below
      }

      // ── FLAT ROOF CAP: fill the (inset) footprint at y=h (seen from above).
      // ShapeGeometry faces +Y after the -PI/2 rotation. UVs are dropped so it
      // merges with the other caps (no texture on roofs).
      const cap = new THREE.Shape();
      { const ip0 = inset(poly[0]); cap.moveTo(ip0[0], -ip0[1]); }
      for (let i = 1; i < poly.length; i++) { const ip = inset(poly[i]); cap.lineTo(ip[0], -ip[1]); }
      let cg;
      try { cg = new THREE.ShapeGeometry(cap); } catch (_) { builtCount++; addBldgCollision(poly); continue; }
      if (!cg.attributes.position || cg.attributes.position.count < 3) { cg.dispose(); builtCount++; addBldgCollision(poly); continue; }
      cg.rotateX(-Math.PI / 2);
      cg.translate(0, h, 0);
      cg.deleteAttribute('uv');
      roofGeoms.push(cg);

      builtCount++;
      // collision: accurate footprint polygon (narrow alleys stay walkable)
      addBldgCollision(poly);
    }

    // Merge each façade bucket → one mesh per material (~14 wall draw calls total).
    let drawCalls = 0;
    for (let m = 0; m < facades.materials.length; m++) {
      const list = bucketGeoms[m];
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      // free the per-building source geometries now that they're baked in
      for (const g of list) g.dispose();
      if (!merged) continue;
      // normals/uv already computed per-building — mergeGeometries preserves them.
      ownedGeoms.push(merged);
      const mesh = new THREE.Mesh(merged, facades.materials[m]);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
      drawCalls++;
    }
    // Merge all roof caps → one flat-roof mesh.
    if (roofGeoms.length) {
      const roofMerged = mergeGeometries(roofGeoms, false);
      for (const g of roofGeoms) g.dispose();
      if (roofMerged) {
        ownedGeoms.push(roofMerged);
        const roofMesh = new THREE.Mesh(roofMerged, roofMat);
        roofMesh.castShadow = false; roofMesh.receiveShadow = true;
        scene.add(roofMesh);
      }
    }
    // Merge all pitched hip roofs → one terracotta-tiled mesh.
    if (roofTileGeoms.length) {
      const tileMerged = mergeGeometries(roofTileGeoms, false);
      for (const g of roofTileGeoms) g.dispose();
      if (tileMerged) {
        ownedGeoms.push(tileMerged);
        const tileMesh = new THREE.Mesh(tileMerged, roofTileMat);
        tileMesh.castShadow = true; tileMesh.receiveShadow = true;
        scene.add(tileMesh);
      }
    }

    // ── ROOF DETAIL on the buildings nearest the lake centre. Rank a copy of
    // buildList by centroid distance to (lakeCx,lakeCz) and add a procedural
    // topper to the closest few. Capped on LOW tier for the budget.
    if (buildList.length) {
      const detailCap = q.tier === 'low' ? 80 : Math.min(250, buildList.length);
      const ranked = buildList
        .map((b) => {
          let x = 0, z = 0; for (const p of b.poly) { x += p[0]; z += p[1]; }
          const cx2 = x / b.poly.length, cz2 = z / b.poly.length;
          return { b, d: (cx2 - lakeCx) ** 2 + (cz2 - lakeCz) ** 2 };
        })
        .sort((a, c) => a.d - c.d)
        .slice(0, detailCap);
      for (const e of ranked) {
        const b = e.b;
        // Rooftop clutter (water tank / AC) only reads on FLAT roofs — skip the
        // buildings that got a pitched tiled roof.
        if (pitchedSet.has(b.poly)) continue;
        const rd = facades.buildRoofDetail(b.poly, b.h || 7, hash01(b.poly[0][0], b.poly[0][1]));
        if (rd) { scene.add(rd); itemGroups.push(rd); }
      }
    }
    // (drawCalls === number of non-empty façade buckets, ≤ 14, for all buildings.)

    // ──────────── GREATER-HANOI SKYLINE — procedural surroundings ─────────
    // Beyond the real OSM core the city must continue to the horizon, not end in
    // empty grass. We scatter low-detail extruded box "buildings" on a jittered
    // grid across the annulus [extentR+20, SKYLINE_OUTER], DENSER near the core and
    // thinning toward the horizon, tinted with the same muted Hanoi façade hues.
    // They're MERGED by material (a few draw calls), static (matrixAutoUpdate off),
    // and carry NO collision + NO shadow — pure backdrop framing the playable core.
    (function proceduralSkyline() {
      // Own cheap plaster mats — the far backdrop staying flat-coloured is fine.
      const SKY_HUES = [40, 205, 20, 120, 350];
      const skylineMats = SKY_HUES.map((h) => mats.plaster(h));
      localMats.push(...skylineMats);
      const cap = q.tier === 'low' ? 80 : q.tier === 'mid' ? 250 : 500;
      // Start the backdrop a clean band OUTSIDE the fence so the guest's
      // outside-the-gate apron (≤ fenceR+30) stays clear of skyline boxes.
      const inner = MAXR + 40;
      const outer = SKYLINE_OUTER;
      const cell = 26;                       // grid pitch (metres)
      const half = Math.ceil(outer / cell);
      const sbuckets = SKY_HUES.map(() => []);
      let placed = 0;
      const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // base at y=0
      for (let gx = -half; gx <= half && placed < cap; gx++) {
        for (let gz = -half; gz <= half && placed < cap; gz++) {
          // jittered cell centre
          const jx = (hash01(gx * 1.3 + 0.7, gz * 2.1) - 0.5) * cell * 0.7;
          const jz = (hash01(gz * 1.7 + 4.4, gx * 0.9) - 0.5) * cell * 0.7;
          const x = gx * cell + jx, z = gz * cell + jz;
          const r = Math.hypot(x, z);
          if (r < inner || r > outer) continue;
          // density thins toward the horizon: keep-probability falls from 1 → ~0.18.
          const tt = (r - inner) / (outer - inner);            // 0 at core edge, 1 at horizon
          const keepP = 0.92 * (1 - tt) + 0.12;
          if (hash01(x * 0.31, z * 0.27) > keepP) continue;
          // varied footprint + height (shorter on average toward the edge)
          const w = 8 + hash01(x + 1.1, z) * 18;
          const dpt = 8 + hash01(x, z + 2.3) * 18;
          const h = (8 + hash01(x * 2.2, z * 1.4) * 30) * (1 - tt * 0.45);
          const g = unit.clone();
          g.scale(w, h, dpt);
          g.translate(x, 0, z);
          const bk = Math.floor(hash01(x + 5.5, z - 3.3) * SKY_HUES.length) % SKY_HUES.length;
          sbuckets[bk].push(g);
          placed++;
        }
      }
      unit.dispose();
      for (let m = 0; m < SKY_HUES.length; m++) {
        const list = sbuckets[m];
        if (!list.length) continue;
        const merged = mergeGeometries(list, false);
        for (const g of list) g.dispose();
        if (!merged) continue;
        ownedGeoms.push(merged);
        const mesh = new THREE.Mesh(merged, skylineMats[m]);
        mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        scene.add(mesh);
      }
      skylinePlaced = placed;
    })();

    // ───────────────── ROADS — the real street network ───────────────────
    // Each polyline + width → a flat triangle strip (each segment offset ±w/2
    // perpendicular). All roads merge into ONE asphalt geometry at y=0.04.
    const roadList = (data && data.roads) ? data.roads : [];
    const roadGeoms = [];
    for (const r of roadList) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const hw = (r.w && r.w > 0 ? r.w : 4) / 2;
      const pos = [];
      const idx = [];
      let base = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len; // unit perpendicular
        // quad: a-left, a-right, b-left, b-right (y handled by mesh position)
        pos.push(a[0] + nx * hw, 0, a[1] + nz * hw);
        pos.push(a[0] - nx * hw, 0, a[1] - nz * hw);
        pos.push(b[0] + nx * hw, 0, b[1] + nz * hw);
        pos.push(b[0] - nx * hw, 0, b[1] - nz * hw);
        idx.push(base, base + 2, base + 1,  base + 1, base + 2, base + 3);
        base += 4;
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      roadGeoms.push(g);
    }
    if (roadGeoms.length) {
      const roadMerged = mergeGeometries(roadGeoms, false);
      for (const g of roadGeoms) g.dispose();
      if (roadMerged) {
        roadMerged.computeVertexNormals();
        ownedGeoms.push(roadMerged);
        // polygonOffset so the asphalt never z-fights against greens/ground below.
        mats.asphalt.polygonOffset = true; mats.asphalt.polygonOffsetFactor = -2; mats.asphalt.polygonOffsetUnits = -2;
        const roadMesh = new THREE.Mesh(roadMerged, mats.asphalt);
        roadMesh.position.y = 0.14; roadMesh.receiveShadow = true;
        scene.add(roadMesh);
      }
    }

    // ─────────────── STREET LIFE — Hanoi items along the roads ────────────
    scatterItems(roadList, buildList, lakeCx, lakeCz, lakeNorthZ);

    // ───────────────────── TREES — ~832 real positions ───────────────────
    // Every real tree position becomes ONE instance in just TWO InstancedMeshes —
    // one for trunks, one for foliage blobs — so all 832 trees cost ~2 draw calls.
    // Per instance: varied height/scale, random Y-rotation, slight foliage tint
    // variation. NO collision (trees are thin → streets stay walkable). Shadows
    // only on the high tier (and only near the core), off on mid/low for the budget.
    let treeList = (data && data.trees) ? data.trees : [];
    const treeCap = q.tier === 'low' ? 150 : q.tier === 'mid' ? 450 : treeList.length;
    if (treeList.length > treeCap) {
      treeList = treeList
        .map((t) => ({ t, d: (t[0] - lakeCx) ** 2 + (t[1] - lakeCz) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, treeCap)
        .map((e) => e.t);
    }
    if (treeList.length) {
     const castShadowsT = q.tier === 'high';
     const readyTreeUrls = TREE_GLBS.filter((u) => kit.hasUrl(u));
     const builtGlbTrees = readyTreeUrls.length ? buildGltfTrees(treeList, readyTreeUrls, castShadowsT) : false;
     if (!builtGlbTrees) {
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0); // unit-height, base at 0
      const foliageGeo = new THREE.IcosahedronGeometry(1, 1);
      ownedGeoms.push(trunkGeo, foliageGeo);
      // dedicated foliage material; per-instance tint comes from setColorAt below
      // (InstancedMesh.instanceColor — no vertexColors flag needed).
      const treeFoliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
      localMats.push(treeFoliageMat);
      // Wind sway: displace foliage verts along the wind direction, stronger
      // toward the top, phased per-instance. Near-free (one vertex add); ties to
      // the real wind via swayUniforms (driven each frame).
      treeFoliageMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = swayUniforms.uTime;
        shader.uniforms.uWind = swayUniforms.uWind;
        shader.uniforms.uWindDir = swayUniforms.uWindDir;
        shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uWindDir;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float swayPhase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.15;
           float swayAmt = sin(uTime * 1.6 + swayPhase) * (0.06 + uWind * 0.22);
           transformed.x += cos(uWindDir) * swayAmt * (position.y * 0.5 + 0.5);
           transformed.z += sin(uWindDir) * swayAmt * (position.y * 0.5 + 0.5);`,
        );
      };
      const trunks = new THREE.InstancedMesh(trunkGeo, mats.bark, treeList.length);
      const foliage = new THREE.InstancedMesh(foliageGeo, treeFoliageMat, treeList.length);
      const castShadows = q.tier === 'high';
      trunks.castShadow = castShadows; trunks.receiveShadow = false;
      foliage.castShadow = castShadows; foliage.receiveShadow = false;
      const m = new THREE.Matrix4(), qrot = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      for (let i = 0; i < treeList.length; i++) {
        const tx = treeList[i][0], tz = treeList[i][1];
        circles.push({ x: tx, z: tz, r: 0.5 });   // trunk collision (walk under the canopy, not through)
        const r1 = hash01(tx + 1.7, tz - 2.3), r2 = hash01(tz * 1.3, tx * 0.7), r3 = hash01(tx * 2.1 + 5, tz);
        const height = 3.5 + r1 * 3.5;                 // ~3.5..7 m
        const trunkH = height * 0.45;
        const canopyR = 1.3 + r2 * 1.1;                // foliage blob radius
        const yaw = r3 * Math.PI * 2;
        qrot.setFromAxisAngle(up, yaw);
        // trunk: unit-height cylinder scaled to trunkH, slight radius variation
        pos.set(tx, 0, tz); scl.set(0.8 + r2 * 0.5, trunkH, 0.8 + r2 * 0.5);
        m.compose(pos, qrot, scl); trunks.setMatrixAt(i, m);
        // foliage blob centred near the top of the trunk
        pos.set(tx, trunkH + canopyR * 0.55, tz);
        scl.set(canopyR, canopyR * (0.85 + r1 * 0.3), canopyR);
        m.compose(pos, qrot, scl); foliage.setMatrixAt(i, m);
        // slight per-tree hue/lightness variation so the canopy isn't uniform
        col.setHSL((100 + r3 * 24) / 360, 0.34, 0.28 + r2 * 0.12);
        foliage.setColorAt(i, col);
      }
      trunks.instanceMatrix.needsUpdate = true;
      foliage.instanceMatrix.needsUpdate = true;
      if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
      // static — no per-frame matrix recompute
      trunks.matrixAutoUpdate = false; trunks.updateMatrix();
      foliage.matrixAutoUpdate = false; foliage.updateMatrix();
      scene.add(trunks); scene.add(foliage);
      ownedInstanced.push(trunks, foliage);
     }
    }

    // ──────────────────────── LANDMARKS at the lake ──────────────────────
    // Scale the landmark cluster to the real lake. Turtle Tower at the lake
    // centroid; the red bridge + Ngoc Son temple toward the north shore.
    buildTurtleTower(lakeCx, lakeCz);
    buildBridgeAndTemple(lakeCx, lakeCz, lakeNorthZ);

    // ───────────────── SHOPS — on real buildings fronting the north shore ──
    // Pick the buildings closest to the lake's north water edge and attach the
    // floating enter-marker + interactable to each (like world.ts).
    placeShopsNearNorthShore(buildList, lakeCx, lakeNorthZ);

    // Pulsing additive ground glow ring under each interactable marker.
    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (!it.pos) continue;
      const ringGeo = new THREE.RingGeometry(0.6, 0.95, 28); ownedGeoms.push(ringGeo);
      const ringMat = new THREE.MeshBasicMaterial({
        color: it.type === 'shop' ? hsl(it.hue || 184, 0.5, 0.62) : 0x66e0d0,
        transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      localMats.push(ringMat);
      const glow = new THREE.Mesh(ringGeo, ringMat);
      glow.rotation.x = -Math.PI / 2; glow.position.set(it.pos.x, 0.08, it.pos.z);
      scene.add(glow);
      it.glow = glow; it.glowMat = ringMat;
    }

    // (Quests + Cart kiosks intentionally NOT placed in the world — both remain
    //  reachable from the bottom navigation dock.)

    // ─────────────── Promenade dressing: lamps + a few benches ────────────
    dressPromenade(lakePoly, lakeCx, lakeCz);

    // ─────────────── Lakeside lantern string (warm emissive at dusk) ──────
    const lanternP = [];
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (i / 24 - 0.5) * 1.4;
      lanternP.push({ x: lakeCx + Math.cos(a) * (lakeR * 0.9), z: lakeNorthZ - 3 + Math.sin(a) * 4, y: 4.0 + (i % 2) * 0.3 });
    }
    const lanternGroup = items.lanterns(lanternP);
    if (lanternGroup) { lanternGroup.matrixAutoUpdate = false; lanternGroup.updateMatrix(); scene.add(lanternGroup); itemGroups.push(lanternGroup); }

    // ─────────────── Birds: a few low-poly gulls looping over the lake ────
    if (q.tier !== 'low') {
      const BIRDS = q.tier === 'high' ? 14 : 8;
      const birdGeo = new THREE.ConeGeometry(0.18, 0.6, 4); birdGeo.rotateX(Math.PI / 2);
      ownedGeoms.push(birdGeo);
      const birdMat = new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.7, metalness: 0 });
      localMats.push(birdMat);
      birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, BIRDS);
      birdMesh.frustumCulled = false; birdMesh.castShadow = false;
      for (let i = 0; i < BIRDS; i++) {
        birdParams.push({
          r: lakeR * (0.5 + hash01(i * 2.7, 1.3) * 0.5),
          h: 14 + hash01(i, 5) * 10,
          sp: 0.15 + hash01(i, 6) * 0.2,
          ph: hash01(i, 7) * Math.PI * 2,
          cx: lakeCx + (hash01(i, 8) - 0.5) * 40,
          cz: lakeCz + (hash01(i, 9) - 0.5) * 40,
        });
      }
      scene.add(birdMesh); ownedInstanced.push(birdMesh);
    }

    // ───────────────────────────── Player ────────────────────────────────
    // Spawn on a road by the lake's north shore, facing the lake/Turtle Tower.
    player = buildAvatar({ hue: playerHue, style: opts.playerStyle });
    if (entered) {
      // Signed in: spawn on a road by the lake's north shore, facing the lake.
      const spawnRoad = findNorthShoreSpawn(roadList, lakeCx, lakeNorthZ);
      SPAWN = new THREE.Vector3(spawnRoad.x, 0, spawnRoad.z);
      spawnYaw = Math.atan2(lakeCx - SPAWN.x, lakeCz - SPAWN.z); // face lake centre
    } else {
      // Guest: stand just OUTSIDE the North gate, facing in toward the city.
      SPAWN = new THREE.Vector3(0, 0, -(fenceR + 16));
      spawnYaw = Math.atan2(0 - SPAWN.x, 0 - SPAWN.z);          // face the gate / centre
    }
    player.group.position.copy(SPAWN);
    player.group.rotation.y = spawnYaw;
    scene.add(player.group);
    parts = player.parts;
    // Guests look INWARD at the built city (the gate is between them and it);
    // signed-in players keep the lake-facing framing.
    camYaw = entered ? spawnYaw : Math.PI;

    blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);
    setNameTag(opts.playerName || '');   // float the username above the player (if signed in)

    // ── Animated hero NPCs (Kenney Mini-Characters, CC0): a handful of real,
    //    idle-animated people along the lakeside promenade + near spawn. The dense
    //    distant crowd stays the cheap procedural `people`. Skipped on low tier and
    //    fully guarded so a missing GLB never breaks the world. ──
    if (q.tier !== 'low') {
      try {
        const [{ GLTFLoader }, skUtils] = await Promise.all([
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/utils/SkeletonUtils.js'),
        ]);
        const loader = new GLTFLoader();
        const CHAR_URLS = [
          '/models/people/character-male-a.glb', '/models/people/character-male-c.glb', '/models/people/character-male-e.glb',
          '/models/people/character-female-a.glb', '/models/people/character-female-c.glb', '/models/people/character-female-e.glb',
        ];
        const gltfs = (await Promise.all(CHAR_URLS.map((u) =>
          new Promise((res) => loader.load(u, (g) => res(g), undefined, () => res(null)))))).filter(Boolean);
        if (!disposed && gltfs.length) {
          const npcCount = q.tier === 'high' ? 18 : 11;
          const pts = [];
          // lakeside promenade arc on the north shore
          const arcN = Math.round(npcCount * 0.7);
          for (let i = 0; i < arcN; i++) {
            const a = -Math.PI / 2 + (i / Math.max(1, arcN - 1) - 0.5) * 1.3;
            pts.push({ x: lakeCx + Math.cos(a) * (lakeR * 0.95), z: lakeNorthZ - 2 + Math.sin(a) * 3 });
          }
          // a few milling near the spawn
          for (let i = arcN; i < npcCount; i++) {
            pts.push({ x: SPAWN.x + (hash01(i * 1.7, 7) - 0.5) * 10, z: SPAWN.z + (hash01(i * 2.3, 9) - 0.5) * 10 });
          }
          const box = new THREE.Box3();
          for (let i = 0; i < pts.length; i++) {
            const g = gltfs[i % gltfs.length];
            const root = skUtils.clone(g.scene);
            box.setFromObject(root);
            const h = (box.max.y - box.min.y) || 1;
            const s = (1.6 + hash01(i, 3) * 0.25) / h;
            root.scale.setScalar(s);
            root.position.set(pts[i].x, -box.min.y * s, pts[i].z);
            root.rotation.y = hash01(i * 2 + 1, 5) * Math.PI * 2;
            root.traverse((o) => { if (o.isMesh) { o.castShadow = q.tier === 'high'; o.receiveShadow = false; } });
            scene.add(root); charRoots.push(root);
            if (g.animations && g.animations.length) {
              const mixer = new THREE.AnimationMixer(root);
              const clip = THREE.AnimationClip.findByName(g.animations, 'idle')
                || g.animations.find((c) => /idle|stand/i.test(c.name)) || g.animations[0];
              const act = mixer.clipAction(clip); act.time = hash01(i, 11) * 2; act.play();
              charMixers.push(mixer);
            }
          }
        }
      } catch (_) { /* characters are optional — never break the world */ }
    }

    // ── PERIMETER FENCE + four cardinal ticket gates (Đông/Tây/Nam/Bắc) + NPCs.
    //    Rings the playable core just beyond the clamp radius, broken by four
    //    labelled gates with guards/bystanders milling around them. Pushes its
    //    blocker circles BEFORE buildGrid() so they enter the collision hash. ──
    buildFenceAndGates();

    // ── Build the collision spatial hash now that every circle has been pushed
    //    (buildings + lake rim + landmarks + furniture + fence). ──
    buildGrid();

    // ── Done: reveal. Guard disposed-before-ready. ──
    if (disposed) return;
    ready = true;
    if (opts.onReady) opts.onReady();
  }

  // ═══════════ PERIMETER FENCE + CARDINAL TICKET GATES (+ NPCs) ═══════════════
  // A low iron fence rings the playable core just beyond the player's clamp
  // radius, broken by four labelled gates at the cardinal points — Đông/East,
  // Tây/West, Nam/South, Bắc/North — with guards + bystanders milling about.
  // Visual + a ring of blocker circles; later phases spawn unauthenticated
  // players OUTSIDE this fence and only open a gate once the ticket checks out.
  const fenceGates = [];   // { key, label, a, x, z, hue } — used by later phases
  function makeLabelTexture(text, hue) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const cx = cv.getContext('2d');
    cx.fillStyle = 'rgba(9,24,26,0.92)'; cx.fillRect(0, 0, 256, 128);
    cx.fillStyle = 'hsl(' + hue + ',72%,60%)'; cx.fillRect(0, 0, 256, 10);
    cx.fillStyle = '#eafcf8'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.font = 'bold 60px system-ui, sans-serif';
    cx.fillText(text, 128, 74);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = q.anisotropy || 1;
    ownedTextures.push(tex);
    return tex;
  }
  // A floating name-tag sprite (always faces the camera) — the player's username
  // and the named NPCs. Texture + material are tracked for disposal.
  function makeTag(text, accent) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const cx = cv.getContext('2d');
    cx.fillStyle = 'rgba(8,22,24,0.82)'; cx.fillRect(6, 16, 244, 38);
    cx.fillStyle = accent || 'rgba(21,214,180,0.95)'; cx.fillRect(6, 16, 244, 3);
    cx.fillStyle = '#eafcf8'; cx.font = 'bold 28px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
    const s = String(text == null ? '' : text);
    cx.fillText(s.length > 18 ? s.slice(0, 17) + '…' : s, 128, 37);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = q.anisotropy || 1;
    ownedTextures.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    localMats.push(mat);
    const spr = new THREE.Sprite(mat); spr.scale.set(2.4, 0.6, 1);
    return spr;
  }
  // The player's username tag (recreated on sign-in, cleared on sign-out).
  function setNameTag(name) {
    if (!player) return;
    if (nameTag) { player.group.remove(nameTag); nameTag = null; }
    if (!name) return;
    nameTag = makeTag(name, 'rgba(21,214,180,0.97)');
    nameTag.scale.set(2.9, 0.72, 1);
    nameTag.position.set(0, 2.25, 0);
    nameTag.material.depthTest = false; nameTag.renderOrder = 12;
    player.group.add(nameTag);
  }
  function buildFenceAndGates() {
    const gated = !opts.authed;               // guests face closed gates until a ticket clears
    const FENCE_R = MAXR + 4;                 // just beyond the player's clamp radius
    const segN = Math.max(64, Math.round((2 * Math.PI * FENCE_R) / 11));
    const GAP_HALF = 13 / FENCE_R;            // ~13 m half-gap at each gate
    const GATES = [
      { key: 'E', label: 'ĐÔNG', a: 0,             hue: 22 },
      { key: 'S', label: 'NAM',  a: Math.PI / 2,   hue: 140 },
      { key: 'W', label: 'TÂY',  a: Math.PI,       hue: 275 },
      { key: 'N', label: 'BẮC',  a: -Math.PI / 2,  hue: 205 },
    ];
    const angDiff = (a, b) => Math.abs(((a - b + Math.PI) % (Math.PI * 2)) - Math.PI);
    const inGap = (a) => GATES.some((g) => angDiff(a, g.a) < GAP_HALF);
    const STYLES = ['minimal', 'street', 'soft'];
    const LABELS = opts.labels || { security: 'Bảo an', checker: 'Soát vé', visitor: 'Khách' };

    const postMat = new THREE.MeshStandardMaterial({ color: hsl(212, 0.08, 0.30), roughness: 0.55, metalness: 0.45 });
    const railMat = new THREE.MeshStandardMaterial({ color: hsl(212, 0.06, 0.24), roughness: 0.5, metalness: 0.55 });
    const pillarMat = new THREE.MeshStandardMaterial({ color: hsl(28, 0.10, 0.42), roughness: 0.8, metalness: 0.05 });
    localMats.push(postMat, railMat, pillarMat);

    // ── fence ring: posts + two rails, broken at the four gates ──
    const postUnit = new THREE.BoxGeometry(0.16, 2.3, 0.16).translate(0, 1.15, 0);
    const samples = [];
    for (let i = 0; i < segN; i++) {
      const a = (i / segN) * Math.PI * 2;
      samples.push({ a, x: Math.cos(a) * FENCE_R, z: Math.sin(a) * FENCE_R, gap: inGap(a) });
    }
    const postGeoms = [], railGeoms = [];
    for (let i = 0; i < segN; i++) {
      const s = samples[i];
      if (s.gap) continue;
      const pg = postUnit.clone(); pg.translate(s.x, 0, s.z); postGeoms.push(pg);
      const nx = samples[(i + 1) % segN];
      if (!nx.gap) {
        const mx = (s.x + nx.x) / 2, mz = (s.z + nx.z) / 2;
        const len = Math.hypot(nx.x - s.x, nx.z - s.z);
        const ang = Math.atan2(nx.z - s.z, nx.x - s.x);
        for (const [yy, hh, dd] of [[1.72, 0.12, 0.07], [0.95, 0.10, 0.06]]) {
          const rg = new THREE.BoxGeometry(len, hh, dd); rg.rotateY(-ang); rg.translate(mx, yy, mz); railGeoms.push(rg);
        }
      }
    }
    postUnit.dispose();
    const addMerged = (list, mat, cast) => {
      if (!list.length) return;
      const m = mergeGeometries(list, false); for (const g of list) g.dispose();
      if (!m) return; ownedGeoms.push(m);
      const mesh = new THREE.Mesh(m, mat); mesh.castShadow = !!cast; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix(); scene.add(mesh);
    };
    addMerged(postGeoms, postMat, true);
    addMerged(railGeoms, railMat, false);

    // Continuous collision along the fence line — fine spacing so the player can't
    // slip BETWEEN the visual posts. Broken only at the gate gaps.
    const colN = Math.max(segN, Math.round((2 * Math.PI * FENCE_R) / 2.2));
    for (let i = 0; i < colN; i++) {
      const a = (i / colN) * Math.PI * 2;
      if (inGap(a)) continue;
      circles.push({ x: Math.cos(a) * FENCE_R, z: Math.sin(a) * FENCE_R, r: 1.4 });
    }

    // Two guard liveries: navy "patrol" (perimeter) vs teal "checker" (ticket
    // gate), a shared cap, and a warm lantern glow for the gates. Guards are SOLID
    // (a collision circle) so the player can't walk through them.
    const capGeo = new THREE.CylinderGeometry(0.27, 0.3, 0.2, 12); ownedGeoms.push(capGeo);
    const capPatrol = new THREE.MeshStandardMaterial({ color: hsl(212, 0.22, 0.18), roughness: 0.85 });
    const capChecker = new THREE.MeshStandardMaterial({ color: hsl(168, 0.5, 0.2), roughness: 0.7, metalness: 0.15 });
    const lanternMat = new THREE.MeshStandardMaterial({ color: hsl(42, 0.7, 0.5), emissive: hsl(42, 0.9, 0.45), emissiveIntensity: 0.9, roughness: 0.5 });
    localMats.push(capPatrol, capChecker, lanternMat);
    const faceOut = (a) => Math.atan2(Math.cos(a), Math.sin(a));   // look radially outward
    const placeGuard = (x, z, ry, checker) => {
      const c = buildAvatar({ hue: checker ? 168 : 212, style: 'minimal' });
      c.group.position.set(x, 0, z);
      c.group.rotation.y = ry != null ? ry : 0;
      if (c.setStyle) c.setStyle('minimal');
      if (c.mats) {
        if (c.mats.clothMat) c.mats.clothMat.color = checker ? hsl(168, 0.5, 0.42) : hsl(212, 0.2, 0.34);
        if (c.mats.pantsMat) c.mats.pantsMat.color = checker ? hsl(168, 0.32, 0.22) : hsl(212, 0.1, 0.2);
      }
      const cap = new THREE.Mesh(capGeo, checker ? capChecker : capPatrol); cap.position.y = 1.86; c.group.add(cap);
      const tag = makeTag(checker ? LABELS.checker : LABELS.security, checker ? 'rgba(21,214,180,0.95)' : 'rgba(90,150,230,0.92)');
      tag.position.set(0, 2.15, 0); c.group.add(tag);
      scene.add(c.group);
      circles.push({ x, z, r: 0.45 });   // solid — no walking through a guard
      liveGuards.push({ g: c, ph: liveGuards.length * 0.7 });   // idle-animate in the loop
    };

    // ── the four cardinal gates: pillars + lintel + label banner + NPCs ──
    for (const g of GATES) {
      const cxg = Math.cos(g.a) * FENCE_R, czg = Math.sin(g.a) * FENCE_R;
      fenceGates.push({ key: g.key, label: g.label, a: g.a, x: cxg, z: czg, hue: g.hue });
      const tan = g.a + Math.PI / 2, tx = Math.cos(tan), tz = Math.sin(tan);
      const halfGapM = GAP_HALF * FENCE_R;
      // Stone pillars (base + shaft + capital), a timber lintel, a terracotta roof
      // canopy, glowing lanterns + the name banner — a proper Hanoi-style gateway.
      for (const sgn of [-1, 1]) {
        const px = cxg + tx * sgn * halfGapM, pz = czg + tz * sgn * halfGapM;
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), mossStone);
        base.position.set(px, 0.35, pz); base.castShadow = true; base.receiveShadow = true; scene.add(base); ownedGeoms.push(base.geometry);
        const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.74, 4.4, 0.74), mossStone);
        shaft.position.set(px, 2.7, pz); shaft.castShadow = true; shaft.receiveShadow = true; scene.add(shaft); ownedGeoms.push(shaft.geometry);
        const capit = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.42, 1.0), mossStone);
        capit.position.set(px, 5.05, pz); capit.castShadow = true; scene.add(capit); ownedGeoms.push(capit.geometry);
        circles.push({ x: px, z: pz, r: 0.7 });
        const lant = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), lanternMat);
        lant.position.set(px - tx * sgn * 0.55, 3.7, pz - tz * sgn * 0.55); scene.add(lant); ownedGeoms.push(lant.geometry);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(halfGapM * 2 + 1.3, 0.62, 0.72), darkWood);
      beam.position.set(cxg, 5.0, czg); beam.rotation.y = -tan; beam.castShadow = true; scene.add(beam); ownedGeoms.push(beam.geometry);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(halfGapM * 2 + 3.0, 0.3, 2.0), roofTile);
      roof.position.set(cxg, 5.5, czg); roof.rotation.y = -tan; roof.castShadow = true; scene.add(roof); ownedGeoms.push(roof.geometry);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(halfGapM * 2 + 3.2, 0.24, 0.5), roofTile);
      ridge.position.set(cxg, 5.74, czg); ridge.rotation.y = -tan; scene.add(ridge); ownedGeoms.push(ridge.geometry);
      const bannerMat = new THREE.MeshBasicMaterial({ map: makeLabelTexture(g.label, g.hue), side: THREE.DoubleSide });
      localMats.push(bannerMat);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.0), bannerMat);
      banner.position.set(cxg, 4.05, czg); banner.rotation.y = Math.PI / 2 - g.a;
      scene.add(banner); ownedGeoms.push(banner.geometry);
      const rec = fenceGates[fenceGates.length - 1];
      // Two solid TIMBER GATE LEAVES fill the opening (only for guests). They
      // slide apart when openGate(key) accepts the ticket; their shared collision
      // is skipped once open. rec.openT animates 0 (shut) → 1 (open) in the loop.
      if (gated) {
        const barLen = halfGapM * 2;
        const leafW = halfGapM;                 // each leaf covers half the gap
        rec.leaves = [];
        for (const sgn of [-1, 1]) {
          const cx = cxg + tx * sgn * (leafW / 2), cz = czg + tz * sgn * (leafW / 2);
          const leaf = new THREE.Group();
          leaf.position.set(cx, 0, cz); leaf.rotation.y = -tan;
          const panel = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.98, 3.1, 0.18), darkWood);
          panel.position.y = 1.65; panel.castShadow = true; panel.receiveShadow = true; leaf.add(panel); ownedGeoms.push(panel.geometry);
          for (const by of [0.9, 2.4]) {        // two iron braces (accent)
            const brace = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.98, 0.18, 0.22), redPaint);
            brace.position.set(0, by, 0); leaf.add(brace); ownedGeoms.push(brace.geometry);
          }
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 12), pillarMat);
          ring.position.set(-sgn * (leafW * 0.4), 1.6, 0.12); ring.rotation.x = Math.PI / 2; leaf.add(ring); ownedGeoms.push(ring.geometry);
          scene.add(leaf);
          rec.leaves.push({ grp: leaf, cx, cz, dx: tx * sgn, dz: tz * sgn, w: leafW });
        }
        rec.openT = 0;
        const steps = Math.max(4, Math.round(barLen / 2));
        for (let s2 = 0; s2 <= steps; s2++) {
          const tt2 = s2 / steps - 0.5;
          circles.push({ x: cxg + tx * tt2 * barLen, z: czg + tz * tt2 * barLen, r: 1.5, gate: g.key });
        }
      }
      // Two security guards flank each gate (just OUTSIDE, facing approaching
      // visitors) — they man the checkpoint. Plus a civilian or two queuing.
      const out = faceOut(g.a);
      for (const sgn of [-1, 1]) {
        placeGuard(cxg + Math.cos(g.a) * 4 + tx * sgn * (halfGapM - 2),
                   czg + Math.sin(g.a) * 4 + tz * sgn * (halfGapM - 2), out, true);
      }
      // (No civilian NPCs at the gate — the "guest" is the unauthenticated player.)
    }

    // Dense perimeter guard line — a security officer every few metres along the
    // WHOLE fence. Instanced (simplified body/head/cap) so hundreds of guards cost
    // only a few draw calls. Skips the gate gaps (those have detailed guards).
    (function perimeterGuards() {
      const spacing = q.tier === 'low' ? 12 : q.tier === 'mid' ? 7 : 4;
      const ringR = FENCE_R + 2.4;
      const slots = [];
      const gn = Math.max(8, Math.round((2 * Math.PI * ringR) / spacing));
      for (let i = 0; i < gn; i++) {
        const a = (i / gn) * Math.PI * 2;
        if (!inGap(a)) slots.push(a);
      }
      const N = slots.length;
      if (!N) return;
      const bodyGeo = new THREE.CylinderGeometry(0.18, 0.27, 1.5, 8).translate(0, 0.75, 0);
      const headGeo = new THREE.SphereGeometry(0.21, 10, 10).translate(0, 1.62, 0);
      const capG = new THREE.CylinderGeometry(0.24, 0.28, 0.18, 10).translate(0, 1.84, 0);
      ownedGeoms.push(bodyGeo, headGeo, capG);
      const bodyMat = new THREE.MeshStandardMaterial({ color: hsl(212, 0.2, 0.33), roughness: 0.7, metalness: 0.1 });
      const headMat = new THREE.MeshStandardMaterial({ color: hsl(28, 0.32, 0.6), roughness: 0.85 });
      const capM = new THREE.MeshStandardMaterial({ color: hsl(212, 0.25, 0.18), roughness: 0.8 });
      localMats.push(bodyMat, headMat, capM);
      const body = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
      const head = new THREE.InstancedMesh(headGeo, headMat, N);
      const capI = new THREE.InstancedMesh(capG, capM, N);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0),
            pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
      const labelEvery = Math.max(1, Math.round(N / (q.tier === 'low' ? 12 : q.tier === 'mid' ? 26 : 46)));
      for (let i = 0; i < N; i++) {
        const a = slots[i];
        qq.setFromAxisAngle(up, faceOut(a));
        pos.set(Math.cos(a) * ringR, 0, Math.sin(a) * ringR);
        m.compose(pos, qq, scl);
        body.setMatrixAt(i, m); head.setMatrixAt(i, m); capI.setMatrixAt(i, m);
        circles.push({ x: pos.x, z: pos.z, r: 0.45 });   // solid perimeter guards
        // Sparse "Bảo an" tags so the patrol reads as named without 100s of sprites.
        if (i % labelEvery === 0) {
          const tag = makeTag(LABELS.security, 'rgba(90,150,230,0.92)');
          tag.position.set(pos.x, 2.05, pos.z); scene.add(tag);
        }
      }
      for (const im of [body, head, capI]) {
        im.instanceMatrix.needsUpdate = true;
        im.matrixAutoUpdate = false; im.updateMatrix();
        im.frustumCulled = false;   // instances ring the whole map — don't cull the set as one
        scene.add(im); ownedInstanced.push(im);
      }
      const ph = new Float32Array(N);
      for (let i = 0; i < N; i++) ph[i] = (i * 1.7) % 6.283;
      perim = { body, head, capI, slots, ph, ringR, N, m, qq, up, scl, pos };
    })();
    // Guide the guest: a short file of guards in the apron north of the spawn,
    // shepherding new arrivals down to the North gate's checkpoint.
    if (gated) {
      for (let k = 0; k < 3; k++) {
        placeGuard(k % 2 ? 3.6 : -3.6, -(FENCE_R + 13 - k * 3), 0);   // face +z, toward the gate
      }
    }
    // A few civilians milling for life.
  }

  // ════════════════════════ Landmark builders ═══════════════════════════════

  // THÁP RÙA — Turtle Tower on a small island at the lake centre.
  function buildTurtleTower(ox, oz) {
    const g = new THREE.Group(); g.position.set(ox, 0, oz); scene.add(g);
    const island = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.5, 1.0, 32), mossStone);
    island.position.y = -0.1; island.castShadow = true; island.receiveShadow = true; g.add(island);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 0.3, 28), mats.foliage);
    grass.position.y = 0.45; grass.receiveShadow = true; g.add(grass);

    const tiers = [
      { w: 4.2, h: 3.0, y: 0.55 },
      { w: 3.2, h: 2.6, y: 3.55 },
      { w: 2.3, h: 2.2, y: 6.15 },
    ];
    let topY = 0;
    tiers.forEach((t, ti) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.w), ti % 2 ? mats.concrete : mossStone);
      body.position.y = t.y + t.h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.5, 0.3, t.w + 0.5), mats.curb);
      cap.position.y = t.y + t.h + 0.15; cap.castShadow = true; g.add(cap);
      const openH = t.h * 0.55, openW = t.w * 0.34;
      [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]].forEach(([dx, , dz]) => {
        const arch = new THREE.Mesh(new THREE.BoxGeometry(dz ? openW : 0.12, openH, dz ? 0.12 : openW), darkWood);
        arch.position.set(dx * (t.w / 2 - 0.05), t.y + t.h * 0.5, dz * (t.w / 2 - 0.05));
        g.add(arch);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(openW / 2, openW / 2, 0.12, 12, 1, false, 0, Math.PI), darkWood);
        top.rotation.z = Math.PI / 2;
        if (dz) { top.rotation.y = 0; top.position.set(dx * (t.w / 2 - 0.05), t.y + t.h * 0.5 + openH / 2, dz * (t.w / 2 - 0.05)); }
        else { top.rotation.y = Math.PI / 2; top.position.set(dx * (t.w / 2 - 0.05), t.y + t.h * 0.5 + openH / 2, 0); }
        g.add(top);
      });
      topY = t.y + t.h;
    });
    const crown = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.0, 1.4), mats.curb);
    crown.position.y = topY + 0.5; crown.castShadow = true; g.add(crown);
    const finial = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.0, 4), mossStone);
    finial.position.y = topY + 1.5; finial.rotation.y = Math.PI / 4; finial.castShadow = true; g.add(finial);
    // unreachable across the water — no collision needed.
  }

  // CẦU THÊ HÚC + ĐỀN NGỌC SƠN — red arched bridge to the temple island, set
  // near the lake's north shore (where the real temple sits). The bridge runs
  // from the north promenade (more negative z = north) inward toward the lake.
  function buildBridgeAndTemple(ox, oz, northZ) {
    // Place the temple island a little south of the north water edge so it sits
    // in the water; the bridge connects it to the north shore.
    const islandZ = northZ + 16;          // inside the lake from the north edge
    const islandR = 9;
    const bridgeStartZ = northZ - 1.0;          // north shore (promenade) end, LOW z
    const bridgeEndZ = islandZ - islandR + 1.5; // lands on the island's north edge, HIGH z
    const bridgeLen = Math.max(6, bridgeEndZ - bridgeStartZ); // +z span (shore → island, positive)

    // ── The Huc bridge ──
    (function theHucBridge() {
      const g = new THREE.Group(); g.position.set(ox, 0, 0); scene.add(g);
      const segs = 14, deckW = 3.2, archRise = 1.6;
      // Record the arched deck so step() can lift the player along it.
      bridgeInfo = { ox, startZ: bridgeStartZ, endZ: bridgeEndZ, len: bridgeLen, archRise, halfW: deckW / 2 };
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const z0 = bridgeStartZ + t0 * bridgeLen, z1 = bridgeStartZ + t1 * bridgeLen;
        const y0 = 0.4 + Math.sin(t0 * Math.PI) * archRise;
        const y1 = 0.4 + Math.sin(t1 * Math.PI) * archRise;
        const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2;
        const segLen = Math.hypot(z1 - z0, y1 - y0) + 0.05;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.22, segLen), redPaint);
        plank.position.set(0, yc, zc);
        plank.rotation.x = Math.atan2(y1 - y0, z0 - z1);
        plank.castShadow = true; plank.receiveShadow = true; g.add(plank);
        [-1, 1].forEach((sd) => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, segLen), redPaint);
          rail.position.set(sd * (deckW / 2 - 0.1), yc + 0.55, zc);
          rail.rotation.x = plank.rotation.x; rail.castShadow = true; g.add(rail);
          if (i % 2 === 0) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.16), redPaint);
            post.position.set(sd * (deckW / 2 - 0.1), yc + 0.45, zc); post.castShadow = true; g.add(post);
          }
        });
      }
      // bridge collision: side rails form a walkable corridor.
      const railSegs = 12;
      for (let i = 0; i <= railSegs; i++) {
        const t = i / railSegs;
        const z = bridgeStartZ + t * bridgeLen;
        [-1, 1].forEach((sd) => circles.push({ x: ox + sd * (deckW / 2 + 0.3), z, r: 0.55 }));
      }
    })();

    // ── Ngoc Son temple ──
    (function ngocSonTemple() {
      const g = new THREE.Group(); g.position.set(ox, 0, islandZ); scene.add(g);
      // Record the walkable island deck so step() can raise the player onto it.
      islandInfo = { x: ox, z: islandZ, r: islandR, deckY: 0.62 };
      // Island-edge fence so the player can't step off into the water, with a GAP
      // on the north side (lower z) where The Huc bridge lands.
      for (let ei = 0; ei < 30; ei++) {
        const ea = (ei / 30) * Math.PI * 2;
        const ex = Math.cos(ea) * (islandR + 0.2), ez = Math.sin(ea) * (islandR + 0.2);
        if (ez < -islandR * 0.5 && Math.abs(ex) < 2.4) continue;   // bridge-mouth gap (north)
        circles.push({ x: ox + ex, z: islandZ + ez, r: 1.0 });
      }
      const base = new THREE.Mesh(new THREE.CylinderGeometry(islandR, islandR + 1.2, 1.0, 40), mossStone);
      base.position.y = -0.05; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const lawn = new THREE.Mesh(new THREE.CylinderGeometry(islandR - 1, islandR - 0.5, 0.3, 36), mats.foliage);
      lawn.position.y = 0.5; lawn.receiveShadow = true; g.add(lawn);
      for (let i = 0; i < 3; i++) {
        const a = -1.2 + i * 1.2;
        const tr = props.tree(1.0 + (i % 2) * 0.3);
        const lxp = Math.cos(a) * (islandR - 2.5), lzp = Math.sin(a) * (islandR - 2.5) + 1.5;
        tr.position.set(lxp, 0.5, lzp);
        g.add(tr);
        circles.push({ x: ox + lxp, z: islandZ + lzp, r: 0.5 });
      }
      // Temple body faces the bridge/north shore (−Z).
      const t = new THREE.Group(); t.position.set(0, 0.6, 1.5); g.add(t);
      const wallMat = mats.plaster();
      const bodyW = 6.5, bodyD = 5.0, bodyH = 3.6;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), wallMat);
      body.position.y = bodyH / 2; body.castShadow = true; body.receiveShadow = true; t.add(body);
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 0.18), darkWood);
      door.position.set(0, 1.2, -bodyD / 2 - 0.02); t.add(door);
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.7, 0.1), redPaint);
      doorFrame.position.set(0, 1.35, -bodyD / 2 - 0.06); t.add(doorFrame);
      [-1, 1].forEach((sd) => {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, bodyH, 12), redPaint);
        col.position.set(sd * (bodyW / 2 - 0.5), bodyH / 2, -bodyD / 2 + 0.1); col.castShadow = true; t.add(col);
      });
      function tieredRoof(w, d, y, h) {
        const r = new THREE.Group(); r.position.y = y;
        const eave = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.22, d + 1.4), roofTile);
        eave.castShadow = true; eave.receiveShadow = true; r.add(eave);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4), roofTile);
        cap.rotation.y = Math.PI / 4; cap.position.y = h / 2 + 0.1; cap.castShadow = true; r.add(cap);
        const fy = 0.2;
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
          const curl = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.8, 6), roofTile);
          curl.position.set(sx * (w / 2 + 0.6), fy + 0.3, sz * (d / 2 + 0.6));
          curl.rotation.z = sx * -0.5; curl.rotation.x = sz * 0.5; r.add(curl);
        });
        t.add(r);
      }
      tieredRoof(bodyW, bodyD, bodyH, 1.6);
      tieredRoof(bodyW * 0.7, bodyD * 0.7, bodyH + 1.7, 1.4);
      // Only the temple BODY blocks now; the island deck is walkable (the player
      // arrives over the bridge). Smaller blocker so they can step onto the island.
      circles.push({ x: ox, z: islandZ + 1.5, r: 2.8 });
    })();
  }

  // ════════════════════════ Shops / POIs / dressing ═════════════════════════

  // Real shops take the buildings closest to the lake's north water edge: attach
  // a floating enter-marker + interactable, with the entrance pulled toward the lake.
  function placeShopsNearNorthShore(buildList, lakeCx, northZ) {
    const n = shopsIn.length;
    if (!n || !buildList.length) return;
    // target point: just north of the north water edge, on the lake's centre line.
    const tx = lakeCx, tz = northZ - 14;
    const ranked = buildList
      .map((b) => {
        let x = 0, z = 0; for (const p of b.poly) { x += p[0]; z += p[1]; }
        const cx2 = x / b.poly.length, cz2 = z / b.poly.length;
        return { cx2, cz2, d: Math.hypot(cx2 - tx, cz2 - tz) };
      })
      .filter((e) => e.cz2 <= northZ + 6)   // keep to the north-shore frontage
      .sort((a, c) => a.d - c.d);
    const chosen = ranked.slice(0, n);
    for (let i = 0; i < chosen.length; i++) {
      const info = shopsIn[i];
      const { cx2, cz2 } = chosen[i];
      // entrance: between the building and the lake (toward +z / the shore).
      const dirX = lakeCx - cx2, dirZ = (northZ) - cz2;
      const dl = Math.hypot(dirX, dirZ) || 1;
      const ex = cx2 + (dirX / dl) * 4.5, ez = cz2 + (dirZ / dl) * 4.5;
      const my = 13;
      const marker = new THREE.Mesh(
        new THREE.TorusGeometry(0.6, 0.07, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: hsl(info.hue, 0.5, 0.6), emissiveIntensity: 1.0, roughness: 0.4 }),
      );
      marker.position.set(cx2, my, cz2); scene.add(marker);
      interactables.push({ id: info.id, type: 'shop', name: info.name, hue: info.hue, pos: new THREE.Vector3(ex, 0, ez), trig: 5.2, marker, markerBaseY: my });
    }
  }

  function poiKiosk(x, z, faceX, faceZ, kind, accentHue) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.lookAt(faceX, 0, faceZ);
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

  // Quests + cart kiosks on the north-shore promenade, flanking the bridge mouth.
  function placeKiosks(lakeCx, lakeCz, northZ, lakeR) {
    const promZ = northZ - 4;     // just outside the north water edge (on the promenade)
    const qx = lakeCx - 10, qz = promZ;
    const cx = lakeCx + 10, cz = promZ;
    const qa = poiKiosk(qx, qz, lakeCx, lakeCz, 'quests', 45);
    interactables.push({ id: 'quests', type: 'quests', name: 'Quests', pos: new THREE.Vector3(qx, 0, qz), trig: 3.8, marker: qa.marker, markerBaseY: qa.markerBaseY });
    const ca = poiKiosk(cx, cz, lakeCx, lakeCz, 'cart', playerHue);
    interactables.push({ id: 'cart', type: 'cart', name: 'Cart', pos: new THREE.Vector3(cx, 0, cz), trig: 3.8, marker: ca.marker, markerBaseY: ca.markerBaseY });
  }

  // Lamps + benches along the real shore (sampled around the water polygon).
  function dressPromenade(lakePoly, lakeCx, lakeCz) {
    function placeProp(group, x, z, rotY) { group.position.set(x, 0, z); if (rotY != null) group.rotation.y = rotY; scene.add(group); }
    if (lakePoly && lakePoly.length >= 3) {
      const n = lakePoly.length;
      const lampStep = Math.max(1, Math.round(n / Math.max(8, Math.round(18 * density))));
      for (let i = 0; i < n; i += lampStep) {
        const p = lakePoly[i];
        const ux = p[0] - lakeCx, uz = p[1] - lakeCz, ul = Math.hypot(ux, uz) || 1;
        const x = p[0] + (ux / ul) * 4.0, z = p[1] + (uz / ul) * 4.0;
        placeProp(props.streetlight(), x, z, Math.atan2(ux, uz));
        circles.push({ x, z, r: 0.4 });
        if ((i / lampStep) % 2 === 0) {
          const bx = p[0] + (ux / ul) * 2.5, bz = p[1] + (uz / ul) * 2.5;
          placeProp(props.bench(), bx, bz, Math.atan2(ux, uz) + Math.PI / 2);
          circles.push({ x: bx, z: bz, r: 0.9 });
        }
      }
    } else {
      const lampN = Math.max(8, Math.round(16 * density));
      for (let i = 0; i < lampN; i++) {
        const a = (i / lampN) * Math.PI * 2;
        const lx = lakeCx + Math.cos(a) * 114, lz = lakeCz + Math.sin(a) * 114;
        placeProp(props.streetlight(), lx, lz, a + Math.PI / 2);
        circles.push({ x: lx, z: lz, r: 0.4 });
      }
    }
  }

  // ─────────────────── STREET LIFE — scatter Hanoi items ───────────────────
  // March the real road network and the north-shore promenade, sampling
  // placements for the instanced item builders (motorbikes, people, lamps,
  // poles+wires, awnings, signs, planters, stalls, cafés). Everything uses the
  // deterministic hash01 helper so the result is stable across rebuilds.
  function scatterItems(roadList, buildList, lakeCx, lakeCz, lakeNorthZ) {
    const dens = q.tier === 'low' ? 0.4 : q.tier === 'mid' ? 0.7 : 1;
    const add = (g) => { if (g) { g.matrixAutoUpdate = false; g.updateMatrix(); scene.add(g); itemGroups.push(g); } };

    // Awnings: instanced citykit GLB when loaded (self-scaled from its bbox so a
    // wrong native size can't make them huge/tiny), else the procedural builder.
    // awnP is façade-gated (Task 2) so neither path floats over open ground.
    const addAwnings = (places) => {
      if (!places || !places.length) return;
      let src = null;
      if (kit.has('build:detail-awning')) {
        const root = kit.get('build:detail-awning');
        root.traverse((o) => { if (o.isMesh && !src) src = o; });
      }
      if (src) {
        src.geometry.computeBoundingBox();
        const bb = src.geometry.boundingBox;
        const nativeW = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
        const s = 2.6 / nativeW;                 // normalize to ~2.6 m wide
        const lift = 2.4 - bb.min.y * s;          // seat ~2.4 m up the façade
        const inst = new THREE.InstancedMesh(src.geometry, src.material, places.length);
        inst.castShadow = true; inst.frustumCulled = false;
        const mm = new THREE.Matrix4(), p2 = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(s, s, s), ee = new THREE.Euler();
        for (let i = 0; i < places.length; i++) {
          const p = places[i];
          p2.set(p.x, lift, p.z); ee.set(0, p.ry, 0); qq.setFromEuler(ee);
          mm.compose(p2, qq, ss); inst.setMatrixAt(i, mm);
        }
        inst.instanceMatrix.needsUpdate = true; inst.matrixAutoUpdate = false; inst.updateMatrix();
        scene.add(inst); itemGroups.push(inst);
        return;
      }
      add(items.awnings(places));   // procedural fallback
    };

    const lampP = [], peopleP = [], signP = [], awnP = [], planterP = [], stallP = [], cafeP = [];
    const vendP = [], flagP = [], kumquatP = [];   // shoulder-pole vendors, VN flags, potted ornamental trees
    const birdcageP = [], bannerP = [];            // hanging birdcages, red propaganda banners
    const poleRuns = [];

    // ── Building lookups: reject placements that fall inside (or just inside the
    //    margin of) any real building footprint, and let dressing find a façade. ──
    const ptInPoly = (poly, x, z) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
      }
      return inside;
    };
    // Distance² from (x,z) to the nearest edge of poly (used for margin / façade).
    const edgeDist2 = (poly, x, z) => {
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const ax = poly[j][0], az = poly[j][1], ex = poly[i][0] - ax, ez = poly[i][1] - az;
        const L2 = ex * ex + ez * ez || 1;
        let tt = ((x - ax) * ex + (z - az) * ez) / L2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const dx = x - (ax + ex * tt), dz = z - (az + ez * tt);
        const d2 = dx * dx + dz * dz; if (d2 < best) best = d2;
      }
      return best;
    };
    // Inside a building, or within margin `m` of its wall? Cheap bbox pre-filter.
    const pointInBuildings = (x, z, m = 0.6) => {
      for (let b = 0; b < buildingPolys.length; b++) {
        const bp = buildingPolys[b];
        if (x < bp.minx - m || x > bp.maxx + m || z < bp.minz - m || z > bp.maxz + m) continue;
        if (ptInPoly(bp.poly, x, z)) return true;
        if (m > 0 && edgeDist2(bp.poly, x, z) < m * m) return true;
      }
      return false;
    };
    // Is there a building façade within `r` metres? Gates awnings / hanging signs
    // so they never float over open ground.
    const facadeWithin = (x, z, r = 3.5) => {
      const r2 = r * r;
      for (let b = 0; b < buildingPolys.length; b++) {
        const bp = buildingPolys[b];
        if (x < bp.minx - r || x > bp.maxx + r || z < bp.minz - r || z > bp.maxz + r) continue;
        if (edgeDist2(bp.poly, x, z) < r2) return true;
      }
      return false;
    };
    // ── Min-spacing grid: reject a placement too close to an already-placed
    //    sibling (kills double-dressing where roads share junction vertices). ──
    const SPACE_CELL = 3;
    const spaceGrid = new Map();
    const spacingOk = (x, z, minDist) => {
      const md2 = minDist * minDist;
      const gx = Math.floor(x / SPACE_CELL), gz = Math.floor(z / SPACE_CELL);
      for (let ax = gx - 1; ax <= gx + 1; ax++) for (let az = gz - 1; az <= gz + 1; az++) {
        const arr = spaceGrid.get(ax + '_' + az); if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const dx = x - arr[i][0], dz = z - arr[i][1];
          if (dx * dx + dz * dz < md2) return false;
        }
      }
      return true;
    };
    const spaceAdd = (x, z) => {
      const gx = Math.floor(x / SPACE_CELL), gz = Math.floor(z / SPACE_CELL);
      const k = gx + '_' + gz; let a = spaceGrid.get(k); if (!a) { a = []; spaceGrid.set(k, a); } a.push([x, z]);
    };

    for (const r of roadList) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const hw = (r.w && r.w > 0 ? r.w : 5) / 2;
      const polePts = [];
      let acc = 0;          // cumulative distance for ~2 m stepping
      let lampAcc = 0;      // distance since last lamp
      let poleAcc = 0;      // distance since last pole
      let signAcc = 0;      // distance since last awning/sign
      let flagAcc = 0;      // distance since last Vietnamese flag
      let bannerAcc = 0;    // distance since last red banner
      let lampSide = 1;     // alternating lamp side

      for (let si = 0; si < pts.length - 1; si++) {
        const a = pts[si], b = pts[si + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const tx = dx / segLen, tz = dz / segLen;   // unit tangent
        const nx = -tz, nz = tx;                     // left-normal
        const ry = Math.atan2(tx, tz);               // facing along the road

        const STEP = 2;
        let t = 0;
        while (t < segLen) {
          const px = a[0] + tx * t, pz = a[1] + tz * t;
          const hseed = hash01(px * 0.7 + 1.3, pz * 0.7 - 2.1);

          // lamp posts every ~34 m, alternating side; a planter by ~half of them.
          lampAcc += STEP;
          if (lampAcc >= 34) {
            lampAcc = 0; lampSide = -lampSide;
            const lx = px + nx * (hw + 0.8) * lampSide, lz = pz + nz * (hw + 0.8) * lampSide;
            if (!pointInBuildings(lx, lz, 0.4) && spacingOk(lx, lz, 6)) {
              lampP.push({ x: lx, z: lz }); spaceAdd(lx, lz);
              if (hash01(px + 7.1, pz - 4.4) < 0.5) {
                const plx = px + nx * (hw + 0.5) * lampSide + tx * 1.4, plz = pz + nz * (hw + 0.5) * lampSide + tz * 1.4;
                if (!pointInBuildings(plx, plz, 0.4) && spacingOk(plx, plz, 1.5)) { planterP.push({ x: plx, z: plz }); spaceAdd(plx, plz); }
              }
            }
          }

          // power poles every ~42 m on the +normal side; collected into a run.
          poleAcc += STEP;
          if (poleAcc >= 42) {
            poleAcc = 0;
            polePts.push({ x: px + nx * (hw + 1.3), z: pz + nz * (hw + 1.3) });
          }

          // VIETNAMESE FLAGS (cờ đỏ sao vàng) on building façades, ~every 26 m.
          flagAcc += STEP;
          if (flagAcc >= 26) {
            flagAcc = 0;
            const side = hash01(px + 5.1, pz + 2.2) < 0.5 ? 1 : -1;
            const fx = px + nx * (hw + 0.3) * side, fz = pz + nz * (hw + 0.3) * side;
            if (facadeWithin(fx, fz, 3.5)) flagP.push({ x: fx, z: fz, ry: ry + (Math.PI / 2) * side });
          }

          // pedestrians: rare per step on a sidewalk side, random facing.
          if (hseed < 0.05 * dens) {
            const side = hash01(px - 2.2, pz + 6.6) < 0.5 ? 1 : -1;
            peopleP.push({ x: px + nx * (hw + 0.6) * side, z: pz + nz * (hw + 0.6) * side, ry: hash01(px + 9.9, pz) * Math.PI * 2 });
          }

          // awnings + hanging signs every ~22 m on a building-front side.
          signAcc += STEP;
          if (signAcc >= 22) {
            signAcc = 0;
            const side = hash01(px + 3.3, pz - 1.1) < 0.5 ? 1 : -1;
            const sx = px + nx * (hw + 0.4) * side, sz = pz + nz * (hw + 0.4) * side;
            const sry = ry + (Math.PI / 2) * side;
            // Only attach when an actual building wall is close behind this point.
            if (facadeWithin(sx, sz, 3.5)) {
              awnP.push({ x: sx, z: sz, ry: sry, w: 2 + hash01(px, pz + 1.7) * 2 });
              signP.push({ x: sx, z: sz, ry: sry, hue: hash01(px + 4.4, pz - 3.3) * 360 });
            }
          }

          // potted ornamental tree (cây cảnh / quất) on the sidewalk, occasionally.
          if (hw >= 2 && hash01(px * 1.3 + 4.1, pz * 1.3 - 6.2) < 0.09 * dens) {
            const kside = hash01(px + 2.1, pz) < 0.5 ? 1 : -1;
            const kx = px + nx * (hw + 0.4) * kside, kz = pz + nz * (hw + 0.4) * kside;
            if (!pointInBuildings(kx, kz, 0.3) && spacingOk(kx, kz, 2.0)) { kumquatP.push({ x: kx, z: kz }); spaceAdd(kx, kz); }
          }
          // rare shoulder-pole VENDOR on a sidewalk (Task 7).
          if (hseed > 0.965 && hseed < 0.985) {
            const vside = hash01(px + 1.1, pz - 1.1) < 0.5 ? 1 : -1;
            const vx = px + nx * (hw + 0.7) * vside, vz = pz + nz * (hw + 0.7) * vside;
            if (!pointInBuildings(vx, vz, 0.4) && spacingOk(vx, vz, 3)) { vendP.push({ x: vx, z: vz, ry: hash01(vx, vz) * Math.PI * 2 }); spaceAdd(vx, vz); }
          }
          // rare hanging BIRDCAGE on a café-ish façade (lồng chim).
          if (hseed > 0.95 && hseed < 0.962) {
            const cside = hash01(px + 3.7, pz - 1.3) < 0.5 ? 1 : -1;
            const cgx = px + nx * (hw + 0.3) * cside, cgz = pz + nz * (hw + 0.3) * cside;
            if (facadeWithin(cgx, cgz, 3.2)) birdcageP.push({ x: cgx, z: cgz, ry: ry + (Math.PI / 2) * cside });
          }
          // red propaganda BANNER on façades, ~every 60 m (băng rôn).
          bannerAcc += STEP;
          if (bannerAcc >= 60) {
            bannerAcc = 0;
            const side = hash01(px - 4.4, pz + 1.9) < 0.5 ? 1 : -1;
            const bnx = px + nx * (hw + 0.25) * side, bnz = pz + nz * (hw + 0.25) * side;
            if (facadeWithin(bnx, bnz, 3.0)) bannerP.push({ x: bnx, z: bnz, ry: ry + (Math.PI / 2) * side });
          }

          t += STEP;
        }
        acc += segLen;
      }
      if (polePts.length >= 2) poleRuns.push(polePts);
    }

    // stalls + cafés: walk wider roads sparsely (~70 m) — stall one side, café cluster the other.
    for (const r of roadList) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const hw = (r.w && r.w > 0 ? r.w : 5) / 2;
      if (hw < 3) continue;
      let acc = 0, vendAcc = 0;
      for (let si = 0; si < pts.length - 1; si++) {
        const a = pts[si], b = pts[si + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.001) continue;
        const tx = dx / segLen, tz = dz / segLen;
        const nx = -tz, nz = tx;
        const ry = Math.atan2(tx, tz);
        let t = 0;
        while (t < segLen) {
          vendAcc += 4;
          if (vendAcc >= 70) {
            vendAcc = 0;
            const px = a[0] + tx * t, pz = a[1] + tz * t;
            if (hash01(px * 0.5 + 2.7, pz * 0.5 - 5.1) < 0.6 * dens) {
              const stx = px + nx * (hw + 0.8), stz = pz + nz * (hw + 0.8);
              const cfx = px - nx * (hw + 1.0), cfz = pz - nz * (hw + 1.0);
              if (!pointInBuildings(stx, stz, 0.8) && spacingOk(stx, stz, 4)) { stallP.push({ x: stx, z: stz, ry: ry - Math.PI / 2 }); spaceAdd(stx, stz); }
              if (!pointInBuildings(cfx, cfz, 0.8) && spacingOk(cfx, cfz, 4)) { cafeP.push({ x: cfx, z: cfz, ry: ry + Math.PI / 2 }); spaceAdd(cfx, cfz); }
            }
          }
          t += 4;
        }
        acc += segLen;
      }
    }
    // a few cafés/stalls on the north-shore promenade near (lakeCx, lakeNorthZ-5).
    for (let i = 0; i < 4; i++) {
      const ox = (hash01(i * 3.1, 1.9) - 0.5) * 60;
      const px = lakeCx + ox, pz = lakeNorthZ - 5 - hash01(i * 2.3, 7.7) * 10;
      if (!spacingOk(px, pz, 3)) continue;
      if (i % 2 === 0) cafeP.push({ x: px, z: pz, ry: hash01(px, pz) * Math.PI * 2 });
      else stallP.push({ x: px, z: pz, ry: hash01(px + 1, pz) * Math.PI * 2 });
      spaceAdd(px, pz);
    }

    // Caps by tier before building.
    const peopleCap = q.tier === 'low' ? 150 : q.tier === 'mid' ? 450 : 750;
    if (peopleP.length > peopleCap) peopleP.length = peopleCap;
    if (lampP.length > 450) lampP.length = 450;
    if (signP.length > 500) signP.length = 500;
    if (awnP.length > 500) awnP.length = 500;
    if (planterP.length > 400) planterP.length = 400;
    if (stallP.length > 120) stallP.length = 120;
    if (cafeP.length > 120) cafeP.length = 120;
    const vendCap = q.tier === 'low' ? 12 : q.tier === 'mid' ? 30 : 50;
    if (vendP.length > vendCap) vendP.length = vendCap;
    const flagCap = q.tier === 'low' ? 80 : q.tier === 'mid' ? 220 : 380;
    if (flagP.length > flagCap) flagP.length = flagCap;
    const kumquatCap = q.tier === 'low' ? 60 : q.tier === 'mid' ? 160 : 300;
    if (kumquatP.length > kumquatCap) kumquatP.length = kumquatCap;
    const birdcageCap = q.tier === 'low' ? 30 : q.tier === 'mid' ? 90 : 160;
    if (birdcageP.length > birdcageCap) birdcageP.length = birdcageCap;
    const bannerCap = q.tier === 'low' ? 40 : q.tier === 'mid' ? 120 : 220;
    if (bannerP.length > bannerCap) bannerP.length = bannerCap;

    // Furniture collision (so the player can't walk THROUGH solid items). Pushed
    // here; the spatial grid is built once at the end of build() after these.
    for (const p of lampP) circles.push({ x: p.x, z: p.z, r: 0.35 });
    for (const run of poleRuns) for (const p of run) circles.push({ x: p.x, z: p.z, r: 0.5 });
    for (const p of stallP) circles.push({ x: p.x, z: p.z, r: 1.4 });
    for (const p of cafeP) circles.push({ x: p.x, z: p.z, r: 1.3 });
    for (const p of planterP) circles.push({ x: p.x, z: p.z, r: 0.5 });
    for (const p of vendP) circles.push({ x: p.x, z: p.z, r: 0.6 });
    for (const p of kumquatP) circles.push({ x: p.x, z: p.z, r: 0.4 });

    // Build + add (each builder returns a Group). Awnings use a GLB path when the
    // citykit detail is loaded; otherwise the procedural builder. (No vehicles.)
    add(items.lampPosts(lampP));
    for (const run of poleRuns) add(items.powerLines(run));
    add(items.people(peopleP));
    addAwnings(awnP);
    add(items.hangingSigns(signP));
    add(items.planters(planterP));
    add(items.stalls(stallP));
    add(items.cafes(cafeP));
    add(items.vendors(vendP));
    add(items.flags(flagP));
    add(items.kumquat(kumquatP));
    add(items.birdcages(birdcageP));
    add(items.banners(bannerP));
  }

  // Find a road vertex near the lake's north shore to spawn on (real street).
  function findNorthShoreSpawn(roadList, lakeCx, northZ) {
    let best = null, bestD = Infinity;
    const tx = lakeCx, tz = northZ - 12;
    for (const r of roadList) {
      if (!r.pts) continue;
      for (const p of r.pts) {
        if (p[1] > northZ + 4) continue;          // must be north of (or at) the shore
        const d = Math.hypot(p[0] - tx, p[1] - tz);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    if (best && bestD < 120) return { x: best[0], z: best[1] };
    return { x: lakeCx, z: northZ - 16 };          // fallback: just off the north shore
  }

  // ── Input: keyboard + joystick (shared) ──────────────────
  const kb = createKeyboard();
  const stick = createJoystick(container);
  const keys = kb.keys, joy = stick.joy;

  // ── Orbit camera (drag rotate, pinch / wheel zoom) ───────
  // camDist range is set wide in build() (CAM_MIN..CAM_MAX ≈ 12..extentR*0.7) so the
  // player can survey the whole city from above or drop to street level. The zoom
  // step scales with distance so it stays pleasant across the huge range.
  let camYaw = 0, camElev = 0.42, camDist = 46, camDcur = 46;
  // Cinematic smoothing state: damped orbit angles, a trailing look target, and a
  // player-speed estimate feeding a subtle dynamic FOV.
  let camYawCur = camYaw, camElevCur = camElev;
  const lookTarget = new THREE.Vector3(); let lookInit = false;
  const baseFov = camera.fov;
  let prevPx = 0, prevPz = 0, camSpeed = 0;
  const clampDist = (d) => Math.max(CAM_MIN, Math.min(CAM_MAX, d));
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
      if (orbit.lastDist) camDist = clampDist(camDist - (d - orbit.lastDist) * 0.01 * Math.max(8, camDist));
      orbit.lastDist = d;
    } else {
      camYaw -= dx * 0.007;
      camElev = Math.max(0.12, Math.min(CAM_ELEV_MAX, camElev + dy * 0.005));
    }
  };
  const camUp = (e) => { orbit.pointers.delete(e.pointerId); if (orbit.pointers.size < 2) orbit.lastDist = 0; };
  dom.addEventListener('pointerdown', camDown); dom.addEventListener('pointermove', camMove);
  dom.addEventListener('pointerup', camUp); dom.addEventListener('pointercancel', camUp);
  const onWheel = (e) => { camDist = clampDist(camDist + e.deltaY * 0.0016 * Math.max(8, camDist)); e.preventDefault(); };
  dom.addEventListener('wheel', onWheel, { passive: false });

  // ── Minimap ──────────────────────────────────────────────
  const mini = document.createElement('canvas');
  mini.className = 'v-minimap'; mini.width = 120; mini.height = 120;
  container.appendChild(mini); mini.style.display = 'none';
  const mctx = mini.getContext('2d');
  const dotColor = (it) => it.type === 'shop' ? '#' + hsl(it.hue, 0.5, 0.62).getHexString()
    : it.type === 'quests' ? '#f0c860' : '#7fe0d0';
  function drawMinimap() {
    if (!player) return;
    const px = player.group.position.x, pz = player.group.position.z;
    mctx.clearRect(0, 0, 120, 120);
    mctx.save();
    mctx.beginPath(); mctx.arc(60, 60, 57, 0, 7); mctx.closePath();
    mctx.fillStyle = 'rgba(9,26,26,.62)'; mctx.fill(); mctx.clip();
    const sc = 57 / 200;
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
  // Falling rain Points. We carry a per-frame horizontal SLANT (driven by the real
  // wind speed) so a windy downpour visibly leans; the points are reused as they
  // fall below y=0.
  const rainN = q.tier === 'low' ? 0 : Math.round(420 * density);
  let rainPts = null;
  if (rainN) {
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(rainN * 3);
    for (let i = 0; i < rainN; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 52; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainPts = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xc4d2d6, size: 0.5, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    rainPts.visible = false; scene.add(rainPts);
  }

  // ── REAL weather + REAL time-of-day (Open-Meteo, keyless) ──
  // Time-of-day comes from the real Hanoi clock (recomputed ~every 60 s). Weather
  // comes from Open-Meteo's current conditions (re-fetched ~every 10 min). No
  // synthetic day/weather cycle — the world reflects the real Hanoi sky.
  let wet = 0, rainAmt = 0;
  // Current target weather (updated by the fetch; mild default until it resolves).
  let curOvercast = 0.25, curRain = 0, windAmt = 0;
  // Fog distances (set to extentR-relative values in build()). We tie fog density
  // gently to overcast: more cloud → fog rolls a bit nearer, but never grey soup.
  let fogNear = 480, fogFar = 1860;

  // Apply the current overcast to the fog distances on top of whatever the
  // environment.setWeather() already did, keeping the world readable.
  function applyFog(overcast) {
    if (!scene.fog) return;
    const o = Math.max(0, Math.min(1, overcast));
    scene.fog.near = fogNear * THREE.MathUtils.lerp(1.0, 0.6, o);
    scene.fog.far = fogFar * THREE.MathUtils.lerp(1.0, 0.62, o);
  }

  // Map a WMO weather_code (+ cloud cover) → engine weather + a HUD descriptor.
  function mapWeatherCode(code, cloudPct) {
    const cc = Math.max(0, Math.min(1, (cloudPct || 0) / 100));
    if (code === 0 || code === 1) return { overcast: cc * 0.5, rain: 0, vi: 'Quang đãng', en: 'Clear', icon: 'sun' };
    if (code === 2) return { overcast: 0.45, rain: 0, vi: 'Có mây', en: 'Partly cloudy', icon: 'cloud' };
    if (code === 3) return { overcast: 0.8, rain: 0, vi: 'Nhiều mây', en: 'Overcast', icon: 'cloud' };
    if (code === 45 || code === 48) return { overcast: 0.75, rain: 0.1, vi: 'Sương mù', en: 'Fog', icon: 'cloud' };
    if (code >= 51 && code <= 57) return { overcast: 0.7, rain: 0.4, vi: 'Mưa phùn', en: 'Drizzle', icon: 'rain' };
    if (code >= 61 && code <= 67) return { overcast: 0.8, rain: 0.65, vi: 'Mưa', en: 'Rain', icon: 'rain' };
    if (code >= 71 && code <= 77) return { overcast: 0.8, rain: 0.6, vi: 'Tuyết', en: 'Snow', icon: 'rain' };
    if (code >= 80 && code <= 82) return { overcast: 0.8, rain: 0.7, vi: 'Mưa rào', en: 'Showers', icon: 'rain' };
    if (code >= 85 && code <= 86) return { overcast: 0.8, rain: 0.6, vi: 'Mưa tuyết', en: 'Snow showers', icon: 'rain' };
    if (code >= 95 && code <= 99) return { overcast: 0.9, rain: 0.9, vi: 'Dông', en: 'Thunderstorm', icon: 'rain' };
    return { overcast: 0.25, rain: 0, vi: 'Quang đãng', en: 'Clear', icon: 'sun' };
  }

  // Notify the HUD with the current weather descriptor.
  function emitWeather(tempC, m, windKmh) {
    if (disposed || !opts.onWeather) return;
    opts.onWeather({ tempC: Math.round(tempC), label: m.vi, labelEn: m.en, icon: m.icon, wind: Math.round(windKmh) });
  }

  // One fetch from Open-Meteo (FREE, NO API KEY). On any failure we keep the
  // real-time tod + the mild default weather already set.
  function fetchWeather() {
    if (disposed) return;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=21.0287&longitude=105.8524&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,is_day&timezone=Asia%2FHo_Chi_Minh')
      .then((r) => { if (!r.ok) throw new Error('open-meteo ' + r.status); return r.json(); })
      .then((j) => {
        if (disposed) return;
        const c = j && j.current;
        if (!c) return;
        const tempC = c.temperature_2m ?? 28;
        const code = c.weather_code ?? 0;
        const windKmh = c.wind_speed_10m ?? 0;
        const cloud = c.cloud_cover ?? 0;
        const m = mapWeatherCode(code, cloud);
        curOvercast = m.overcast; curRain = m.rain;
        windAmt = Math.max(0, Math.min(1, windKmh / 40));
        const windDeg = c.wind_direction_10m;
        if (typeof windDeg === 'number') windDir = (windDeg * Math.PI) / 180;
        environment.setWeather({ overcast: curOvercast, rain: curRain });
        applyFog(curOvercast);
        emitWeather(tempC, m, windKmh);
      })
      .catch(() => { /* keep real-time tod + mild default weather */ });
  }
  // Kick off the first fetch + the ~10 min refresh interval.
  fetchWeather();
  const weatherTimer = setInterval(fetchWeather, 10 * 60 * 1000);
  // Re-compute the real Hanoi time-of-day ~every 60 s.
  const timeTimer = setInterval(() => {
    if (disposed) return;
    environment.setTimeOfDay(hanoiHour() / 24);
  }, 60 * 1000);

  // ── Loop ─────────────────────────────────────────────────
  const SPEED = 6.2;
  const camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), camPos = new THREE.Vector3();
  // Hoisted scratch for the per-frame bird flock (no per-frame allocation).
  const _birdPos = new THREE.Vector3(), _birdFwd = new THREE.Vector3(), _birdQuat = new THREE.Quaternion();
  const _birdMat = new THREE.Matrix4(), _birdScl = new THREE.Vector3(1, 1, 1), _birdZ = new THREE.Vector3(0, 0, 1);
  let phase = 0, near = null, last = performance.now(), miniAccum = 0;

  function step(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // Until the async build finishes, just keep the (empty) scene rendering so the
    // first frames are warm by the time the loader clears.
    if (!ready || !player) {
      environment.update(dt, camPos);
      post.render(dt);
      raf = requestAnimationFrame(step);
      return;
    }

    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz);
    let moving = mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    // After a ticket is accepted the guard opens the gate and the player walks IN
    // automatically — steer toward a point just inside the gate, overriding input
    // until they're past the fence.
    let mvx = 0, mvz = 0;
    if (autoEnter && !entered) {
      const tgX = Math.cos(autoEnter.a) * (fenceR - 14), tgZ = Math.sin(autoEnter.a) * (fenceR - 14);
      const dx = tgX - pp.x, dz = tgZ - pp.z, dl = Math.hypot(dx, dz) || 1;
      mvx = dx / dl; mvz = dz / dl; moving = true;
    } else if (moving) {
      const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
      const rgtX = Math.cos(camYaw), rgtZ = -Math.sin(camYaw);
      mvx = rgtX * ix + fwdX * (-iz);
      mvz = rgtZ * ix + fwdZ * (-iz);
    }
    if (moving) {
      const SP = SPEED * (keys['shift'] && !autoEnter ? 1.9 : 1);   // shift = run
      pp.x += mvx * SP * dt; pp.z += mvz * SP * dt;

      const pr = Math.hypot(pp.x, pp.z);
      if (entered) {
        if (pr > MAXR) { const s = MAXR / pr; pp.x *= s; pp.z *= s; }
      } else {
        // Guest: kept in the clean apron just OUTSIDE the fence. The fence + the
        // closed gate barriers (collision circles below) stop them crossing in
        // anywhere except a gate whose ticket has been accepted.
        const OUTER = fenceR + 30;
        if (pr > OUTER) { const s = OUTER / pr; pp.x *= s; pp.z *= s; }
        // Walked inward through an opened gate → now inside the city for good.
        if (pr < fenceR - 6) { entered = true; autoEnter = null; }
      }

      const rad = 0.5;
      if (grid) {
        const pgx = Math.floor(pp.x / GCELL), pgz = Math.floor(pp.z / GCELL);
        for (let gx = pgx - 1; gx <= pgx + 1; gx++) for (let gz = pgz - 1; gz <= pgz + 1; gz++) {
          const arr = grid.get(gx + '_' + gz); if (!arr) continue;
          for (let n = 0; n < arr.length; n++) {
            const b = circles[arr[n]];
            if (b.gate && openGates[b.gate]) continue;   // this gate's ticket cleared — let them pass
            const dx = pp.x - b.x, dz = pp.z - b.z; const dd = Math.hypot(dx, dz) || 1;
            if (dd < b.r + rad) { pp.x = b.x + dx / dd * (b.r + rad); pp.z = b.z + dz / dd * (b.r + rad); }
          }
        }
      }
      // Buildings: accurate footprint-POLYGON collision so the narrow alleys
      // (ngõ ngách) stay walkable. The player centre is kept `rad` OUTSIDE every
      // nearby wall — handling both inside-penetration AND outside-grazing in one
      // pass — so motion slides smoothly along façades instead of jittering.
      if (gridB) {
        const pgx = Math.floor(pp.x / GCELL), pgz = Math.floor(pp.z / GCELL);
        const seen = new Set();
        for (let gx = pgx - 1; gx <= pgx + 1; gx++) for (let gz = pgz - 1; gz <= pgz + 1; gz++) {
          const arr = gridB.get(gx + '_' + gz); if (!arr) continue;
          for (let n = 0; n < arr.length; n++) {
            const bi = arr[n]; if (seen.has(bi)) continue; seen.add(bi);
            const bp = buildingPolys[bi];
            if (pp.x < bp.minx - rad || pp.x > bp.maxx + rad || pp.z < bp.minz - rad || pp.z > bp.maxz + rad) continue;
            const poly = bp.poly;
            let inside = false, bX = pp.x, bZ = pp.z, bD = Infinity;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
              if (((zi > pp.z) !== (zj > pp.z)) && (pp.x < (xj - xi) * (pp.z - zi) / (zj - zi) + xi)) inside = !inside;
              const ex = xi - xj, ez = zi - zj, L2 = ex * ex + ez * ez || 1;
              let t = ((pp.x - xj) * ex + (pp.z - zj) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
              const qx = xj + ex * t, qz = zj + ez * t, d = (pp.x - qx) * (pp.x - qx) + (pp.z - qz) * (pp.z - qz);
              if (d < bD) { bD = d; bX = qx; bZ = qz; }
            }
            if (inside) {                       // penetrated — push out toward nearest wall
              const dx = bX - pp.x, dz = bZ - pp.z, dl = Math.hypot(dx, dz) || 1;
              pp.x = bX + (dx / dl) * rad; pp.z = bZ + (dz / dl) * rad;
            } else if (bD < rad * rad) {         // grazing the wall from outside — keep a gap
              const dx = pp.x - bX, dz = pp.z - bZ, dl = Math.hypot(dx, dz) || 1;
              pp.x = bX + (dx / dl) * rad; pp.z = bZ + (dz / dl) * rad;
            }
          }
        }
      }

      const targetRot = Math.atan2(mvx, mvz);
      let diff = ((targetRot - player.group.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      player.group.rotation.y += diff * Math.min(1, dt * 12);
    }

    // Height-follow: lift the player along the arched Huc bridge deck + onto the
    // temple island. Eased so the climb reads smoothly.
    let targetY = 0;
    if (bridgeInfo) {
      const bi = bridgeInfo;
      if (Math.abs(pp.x - bi.ox) <= bi.halfW + 0.6 && pp.z >= bi.startZ - 0.9 && pp.z <= bi.endZ + 0.6) {
        const tb = Math.max(0, Math.min(1, (pp.z - bi.startZ) / bi.len));
        targetY = 0.4 + Math.sin(tb * Math.PI) * bi.archRise + 0.12;
      }
    }
    if (islandInfo) { const di = islandInfo; if (Math.hypot(pp.x - di.x, pp.z - di.z) <= di.r - 0.4) targetY = Math.max(targetY, di.deckY); }
    // Jump (space) + gravity. Grounded → smooth-follow terrain (bridge/island);
    // airborne → integrate vertical velocity.
    const baseY = targetY;
    if (keys[' '] && vy === 0 && pp.y <= baseY + 0.06) vy = 6.4;
    if (vy !== 0 || pp.y > baseY + 0.02) {
      vy -= 18 * dt; pp.y += vy * dt;
      if (pp.y <= baseY) { pp.y = baseY; vy = 0; }
    } else {
      pp.y += (baseY - pp.y) * Math.min(1, dt * 9);
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
    blob.position.set(pp.x, pp.y + 0.05, pp.z);

    // Camera-wall occlusion: keep the third-person camera from passing through
    // buildings — in narrow alleys that let you see into the hollow interiors.
    // Cast a 2D ray from the player back along the orbit direction; if it hits a
    // façade before camDist, pull the camera in to just before that wall. Only at
    // street/alley angles (high survey angles sit safely above the rooftops).
    const hCos = Math.max(0.22, Math.cos(camElev));
    let wantD = camDist;
    if (gridB && camElev < 0.95) {
      const sx = Math.sin(camYaw), sz = Math.cos(camYaw);   // horizontal player→camera dir
      const hd = camDist * hCos;
      let hit = hd;
      const steps = Math.min(8, Math.ceil(hd / GCELL) + 1);
      const seenC = new Set();
      for (let s = 0; s <= steps; s++) {
        const sxp = pp.x + sx * s * GCELL, szp = pp.z + sz * s * GCELL;
        const cgx = Math.floor(sxp / GCELL), cgz = Math.floor(szp / GCELL);
        for (let gx = cgx - 1; gx <= cgx + 1; gx++) for (let gz = cgz - 1; gz <= cgz + 1; gz++) {
          const arr = gridB.get(gx + '_' + gz); if (!arr) continue;
          for (let m = 0; m < arr.length; m++) {
            const bi = arr[m]; if (seenC.has(bi)) continue; seenC.add(bi);
            const poly = buildingPolys[bi].poly;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const ax = poly[j][0], az = poly[j][1], ex = poly[i][0] - ax, ez = poly[i][1] - az;
              const det = ex * sz - sx * ez; if (det < 1e-6 && det > -1e-6) continue;
              const dx0 = ax - pp.x, dz0 = az - pp.z;
              const tt = (ex * dz0 - ez * dx0) / det;
              const uu = (sx * dz0 - sz * dx0) / det;
              if (uu >= 0 && uu <= 1 && tt > 0.5 && tt < hit) hit = tt;
            }
          }
        }
      }
      if (hit < hd) wantD = Math.max(2.4, (hit - 0.5) / hCos);
    }
    // Frame-rate-independent damping helper.
    const damp = (cur, target, lambda) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

    // Pull in fast (prevent clipping), ease back out slowly (no pop).
    camDcur += (wantD - camDcur) * Math.min(1, dt * (wantD < camDcur ? 18 : 3));
    // Damp the orbit angles so drags feel weighty, not twitchy.
    camYawCur = damp(camYawCur, camYaw, 10);
    camElevCur = damp(camElevCur, camElev, 10);
    // Player planar speed → a subtle dynamic FOV kick when moving fast.
    const instSpeed = Math.hypot(pp.x - prevPx, pp.z - prevPz) / Math.max(dt, 1e-3);
    prevPx = pp.x; prevPz = pp.z;
    camSpeed = damp(camSpeed, instSpeed, 6);
    const fovTarget = baseFov + Math.min(4, camSpeed * 0.5);
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();

    const offX = camDcur * Math.cos(camElevCur) * Math.sin(camYawCur);
    const offZ = camDcur * Math.cos(camElevCur) * Math.cos(camYawCur);
    const offY = camDcur * Math.sin(camElevCur);
    camTarget.set(pp.x + offX, pp.y + offY + 1.2, pp.z + offZ);
    if (camTarget.y < 0.8) camTarget.y = 0.8;     // ground/lake clamp
    camera.position.lerp(camTarget, Math.min(1, dt * 6));
    if (camera.position.y < 0.8) camera.position.y = 0.8;
    // Smoothed look target trails the player slightly for a cinematic feel.
    tmp.set(pp.x, pp.y + 1.5, pp.z);
    if (!lookInit) { lookTarget.copy(tmp); lookInit = true; }
    lookTarget.x = damp(lookTarget.x, tmp.x, 12);
    lookTarget.y = damp(lookTarget.y, tmp.y, 12);
    lookTarget.z = damp(lookTarget.z, tmp.z, 12);
    camera.lookAt(lookTarget);
    camPos.copy(camera.position);

    // Lake ripples (speed/chop tied to the real wind), tree sway, night glow, birds.
    if (water) {
      const u = water.material.uniforms;
      u.time.value += dt * (0.4 + windAmt * 1.6);
      // Drift the whole ripple field downwind (windDir → world XZ). Speed scales with
      // wind; a gentle baseline keeps calm water alive. Wrapped to avoid float drift.
      const driftSpeed = 0.5 + windAmt * 6.0;
      waterWindShift.x += Math.sin(windDir) * driftSpeed * dt;
      waterWindShift.y += Math.cos(windDir) * driftSpeed * dt;
      if (Math.abs(waterWindShift.x) > 1e4) waterWindShift.x = waterWindShift.x % 1e4;
      if (Math.abs(waterWindShift.y) > 1e4) waterWindShift.y = waterWindShift.y % 1e4;
      u.distortionScale.value = 1.2 + windAmt * 3.0;
      if (environment.sunDir) u.sunDirection.value.copy(environment.sunDir);
    }
    swayUniforms.uTime.value = t;
    swayUniforms.uWind.value = windAmt;
    swayUniforms.uWindDir.value = windDir;
    items.setWind && items.setWind(t, windAmt, windDir);   // flutter the Vietnamese flags
    // Night factor from real sun elevation: street lamps, lanterns, signs AND the
    // city's windows light up as the sun sets, dim out after sunrise.
    const sunElev = environment.getSunElevation ? environment.getSunElevation() : 1;
    const night = Math.max(0, Math.min(1, 1 - sunElev / 0.5));
    items.setNightFactor && items.setNightFactor(night);
    setFacadeNight(night);
    if (birdMesh) {
      for (let i = 0; i < birdParams.length; i++) {
        const bp = birdParams[i];
        const ang = t * bp.sp + bp.ph;
        const bx = bp.cx + Math.cos(ang) * bp.r, bz = bp.cz + Math.sin(ang) * bp.r;
        const by = bp.h + Math.sin(t * 1.3 + bp.ph) * 1.2;
        _birdPos.set(bx, by, bz);
        _birdFwd.set(-Math.sin(ang), 0, Math.cos(ang));
        _birdQuat.setFromUnitVectors(_birdZ, _birdFwd);
        _birdMat.compose(_birdPos, _birdQuat, _birdScl);
        birdMesh.setMatrixAt(i, _birdMat);
      }
      birdMesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < charMixers.length; i++) charMixers[i].update(dt);   // animate hero NPCs

    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (it.marker) {
        it.marker.rotation.z = t * 1.0 + i;
        it.marker.position.y = it.markerBaseY + Math.sin(t * 1.4 + i) * 0.12;
      }

      // Gate leaves sliding open + lively guards (idle bob / look-around / sway).
      for (const fg of fenceGates) {
        if (!fg.leaves) continue;
        const tgt = fg.openTarget || 0;
        if (Math.abs(fg.openT - tgt) > 0.001) {
          fg.openT += (tgt - fg.openT) * Math.min(1, dt * 2.6);
          for (const lf of fg.leaves) lf.grp.position.set(lf.cx + lf.dx * lf.w * fg.openT, 0, lf.cz + lf.dz * lf.w * fg.openT);
        }
      }
      for (let gi = 0; gi < liveGuards.length; gi++) {
        const gp = liveGuards[gi].g.parts, p2 = liveGuards[gi].ph;
        gp.torso.position.y = 1.05 + Math.abs(Math.sin(t * 1.7 + p2)) * 0.03;
        gp.head.rotation.y = Math.sin(t * 0.5 + p2) * 0.45;
        gp.armL.rotation.x = Math.sin(t * 1.3 + p2) * 0.12;
        gp.armR.rotation.x = -Math.sin(t * 1.3 + p2) * 0.12;
      }
      if (perim) {
        const P = perim;
        for (let pi = 0; pi < P.N; pi++) {
          const a = P.slots[pi], pp2 = P.ph[pi];
          P.qq.setFromAxisAngle(P.up, Math.atan2(Math.cos(a), Math.sin(a)) + Math.sin(t * 0.6 + pp2) * 0.25);
          P.pos.set(Math.cos(a) * P.ringR, Math.abs(Math.sin(t * 2.2 + pp2)) * 0.05, Math.sin(a) * P.ringR);
          P.m.compose(P.pos, P.qq, P.scl);
          P.body.setMatrixAt(pi, P.m); P.head.setMatrixAt(pi, P.m); P.capI.setMatrixAt(pi, P.m);
        }
        P.body.instanceMatrix.needsUpdate = true; P.head.instanceMatrix.needsUpdate = true; P.capI.instanceMatrix.needsUpdate = true;
      }
      if (it.glow) {
        it.glowMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2 + i));
        const gs = 1 + 0.08 * Math.sin(t * 2.2 + i);
        it.glow.scale.set(gs, gs, gs);
      }
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

    // Gate proximity for guests (outside the fence): present the ticket when the
    // player reaches a gate guard. Cleared once they're inside.
    if (!entered && fenceGates.length) {
      let gBest = null, gBestD = 999;
      for (const fg of fenceGates) {
        const d = Math.hypot(pp.x - fg.x, pp.z - fg.z);
        if (d < 11 && d < gBestD) { gBestD = d; gBest = fg; }
      }
      const gk = gBest ? gBest.key : null;
      if (gk !== (nearGate && nearGate.key)) {
        nearGate = gBest;
        opts.onGate && opts.onGate(gBest ? { key: gBest.key, label: gBest.label } : null);
      }
    } else if (entered && nearGate) {
      nearGate = null;
      opts.onGate && opts.onGate(null);
    }

    // Time-of-day + weather are driven by REAL data (the intervals above call
    // environment.setTimeOfDay/setWeather). Here we only ease the wetness/rain toward
    // the real targets and animate the rain. Bloom is kept subtle (no day/night ramp).
    const targetRain = curRain;
    wet += (targetRain - wet) * Math.min(1, dt * 0.6);
    rainAmt += (targetRain - rainAmt) * Math.min(1, dt * 0.8);
    mats.setWetness && mats.setWetness(wet);
    if (rainPts) {
      rainPts.visible = rainAmt > 0.04;
      if (rainPts.visible) {
        const arr = rainPts.geometry.attributes.position.array;
        // Wind slants the rain: drift each drop horizontally as it falls. windAmt is
        // 0..1 from the real wind speed; keep the lean subtle.
        const slant = dt * 46 * windAmt * 0.9;
        for (let i = 0; i < rainN; i++) {
          arr[i * 3] += slant;
          arr[i * 3 + 1] -= dt * 46;
          if (arr[i * 3 + 1] < 0 || arr[i * 3] > 60) {
            arr[i * 3 + 1] = 52;
            arr[i * 3] = (Math.random() - 0.5) * 120;
            arr[i * 3 + 2] = (Math.random() - 0.5) * 120;
          }
        }
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

  // ── ASYNC: fetch the real Hanoi data, then build. On failure, still build a
  //    fallback (ground + nominal lake + landmarks) so onReady always fires. ──
  fetch('/data/hanoi.json')
    .then((res) => { if (!res.ok) throw new Error('hanoi.json ' + res.status); return res.json(); })
    .then((data) => build(data))      // build() is async now — return it so failures propagate
    .catch(() => build(null))         // fetch/json OR build failure → minimal fallback build
    .catch(() => { /* even the fallback failed; never throw out of the loader */ });

  // ── API ──────────────────────────────────────────────────
  return {
    dispose() {
      disposed = true;
      running = false; cancelAnimationFrame(raf);
      clearInterval(weatherTimer); clearInterval(timeTimer);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
      kb.dispose(); stick.dispose();
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      post.dispose();
      environment.dispose();
      mats.dispose();
      facades.dispose(); items.dispose();
      // External-asset loaders + the reflective lake (its reflection RT + material).
      if (water) {
        scene.remove(water);
        water.geometry?.dispose?.();
        water.material?.dispose?.();
        water.getRenderTarget?.()?.dispose?.();
        water = null;
      }
      if (waterNormals) { waterNormals.dispose(); waterNormals = null; }
      // Animated NPCs: stop mixers + free their cloned skinned meshes.
      for (const mx of charMixers) mx.stopAllAction();
      charMixers.length = 0;
      for (const root of charRoots) {
        scene.remove(root);
        root.traverse((o) => { if (o.isMesh && o.geometry) { try { o.geometry.dispose(); } catch (_) {} } });
      }
      charRoots.length = 0;
      texer.dispose();
      kit.dispose();
      for (const m of localMats) m.dispose();
      for (const im of ownedInstanced) im.dispose();   // frees instance attribute buffers
      for (const g of ownedGeoms) g.dispose();
      for (const tx of ownedTextures) tx.dispose();
      for (const g of itemGroups) g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposeScene(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    // Ticket accepted at gate `key`: drop its barrier so the guest can walk in.
    openGate(key) {
      openGates[key] = true;
      let a = null;
      for (const fg of fenceGates) if (fg.key === key) { fg.openTarget = 1; a = fg.a; }
      if (a != null) autoEnter = { a };   // guard opens the gate → auto-walk the player inside
    },
    recenter() {
      if (!player) return;
      player.group.position.copy(SPAWN);
      player.group.rotation.y = spawnYaw;
    },
    setPlayerName(name) { setNameTag(name); },
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
