// @ts-nocheck -- Veyra walkable 3D world: HANOI, VIETNAM — Hoan Kiem / Old Quarter,
// rebuilt from REAL OpenStreetMap data and rendered hyper-realistic (PBR).
//
// createVeyraWorld(container, opts) -> { dispose, recenter, setLang }
// opts: { playerHue, lite, shops:[{id,hue,name}], onProximity(poi|null), onCoin(n),
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
  const camera = new THREE.PerspectiveCamera(52, W() / H(), 0.1, 4500);
  camera.position.set(0, 40, 120);

  // ── Environment (sky/sun/IBL/tonemap/fog) ────────────────
  // REALISTIC Hanoi: the sun is driven by the REAL current Hanoi local time and the
  // sky/weather by REAL Open-Meteo data (see the loop below). No forced-bright
  // overrides — environment.setTimeOfDay()/setWeather() carry the look naturally so
  // night is night and noon is bright, soft and never blown out.
  const environment = createEnvironment(renderer, scene, { quality: q });

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
  let CAM_MIN = 12, CAM_MAX = 420, CAM_ELEV_MAX = 1.42;
  let skylinePlaced = 0;                       // count of procedural backdrop boxes
  const coins = [];

  // ─────────────────────────────────────────────────────────────────────────
  //  BUILD — runs after the data fetch resolves (or after a fallback on error).
  //  `data` may be null; we then render just ground + a nominal lake + landmarks
  //  so the world never hangs.
  // ─────────────────────────────────────────────────────────────────────────
  function build(data) {
    if (disposed) return;

    const extentR = data && data.extentR ? data.extentR : 457;
    MAXR = extentR + 30;
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

      // Water surface — jade-green reflective ShapeGeometry from the REAL ~120-pt
      // Hoan Kiem polygon (shape in X/-Z so it lies flat after the -PI/2 rotation).
      const lakeWaterMat = mats.water.clone();
      lakeWaterMat.color = hsl(188, 0.42, 0.47);
      lakeWaterMat.roughness = 0.06;
      lakeWaterMat.metalness = 0.0;
      lakeWaterMat.envMap = mats.water.envMap;
      localMats.push(lakeWaterMat);
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
      waterGeo.rotateX(-Math.PI / 2);
      ownedGeoms.push(waterGeo);
      const lake = new THREE.Mesh(waterGeo, lakeWaterMat);
      lake.position.y = 0.18; lake.receiveShadow = false; scene.add(lake);

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
          if (Math.abs(x - lakeCx) < 3.0 && z > lakeNorthZ - 3 && z < lakeNorthZ + 26) continue;
          const ux = x - lakeCx, uz = z - lakeCz, ul = Math.hypot(ux, uz) || 1;
          circles.push({ x: x + (ux / ul) * 0.6, z: z + (uz / ul) * 0.6, r: fr });
        }
      }
    } else {
      // No water data: a nominal circular jade lake so the scene still reads.
      lakeR = 110;
      const lakeWaterMat = mats.water.clone();
      lakeWaterMat.color = hsl(188, 0.42, 0.47); lakeWaterMat.roughness = 0.06; lakeWaterMat.metalness = 0.0; lakeWaterMat.envMap = mats.water.envMap;
      localMats.push(lakeWaterMat);
      const wGeo = new THREE.CircleGeometry(lakeR, 96); ownedGeoms.push(wGeo);
      const lake = new THREE.Mesh(wGeo, lakeWaterMat);
      lake.rotation.x = -Math.PI / 2; lake.position.set(lakeCx, 0.18, lakeCz); scene.add(lake);
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
      const inner = extentR + 20;
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
      const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0); // unit-height, base at 0
      const foliageGeo = new THREE.IcosahedronGeometry(1, 1);
      ownedGeoms.push(trunkGeo, foliageGeo);
      // dedicated foliage material; per-instance tint comes from setColorAt below
      // (InstancedMesh.instanceColor — no vertexColors flag needed).
      const treeFoliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
      localMats.push(treeFoliageMat);
      const trunks = new THREE.InstancedMesh(trunkGeo, mats.bark, treeList.length);
      const foliage = new THREE.InstancedMesh(foliageGeo, treeFoliageMat, treeList.length);
      const castShadows = q.tier === 'high';
      trunks.castShadow = castShadows; trunks.receiveShadow = false;
      foliage.castShadow = castShadows; foliage.receiveShadow = false;
      const m = new THREE.Matrix4(), qrot = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
      for (let i = 0; i < treeList.length; i++) {
        const tx = treeList[i][0], tz = treeList[i][1];
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

    // ──────────────────────── LANDMARKS at the lake ──────────────────────
    // Scale the landmark cluster to the real lake. Turtle Tower at the lake
    // centroid; the red bridge + Ngoc Son temple toward the north shore.
    buildTurtleTower(lakeCx, lakeCz);
    buildBridgeAndTemple(lakeCx, lakeCz, lakeNorthZ);

    // ───────────────── SHOPS — on real buildings fronting the north shore ──
    // Pick the buildings closest to the lake's north water edge and attach the
    // floating enter-marker + interactable to each (like world.ts).
    placeShopsNearNorthShore(buildList, lakeCx, lakeNorthZ);

    // (Quests + Cart kiosks intentionally NOT placed in the world — both remain
    //  reachable from the bottom navigation dock.)

    // ─────────────── Promenade dressing: lamps + a few benches ────────────
    dressPromenade(lakePoly, lakeCx, lakeCz);

    // ───────────────────────────── Player ────────────────────────────────
    // Spawn on a road by the lake's north shore, facing the lake/Turtle Tower.
    const spawnRoad = findNorthShoreSpawn(roadList, lakeCx, lakeNorthZ);
    SPAWN = new THREE.Vector3(spawnRoad.x, 0, spawnRoad.z);
    player = buildAvatar({ hue: playerHue, style: opts.playerStyle });
    player.group.position.copy(SPAWN);
    spawnYaw = Math.atan2(lakeCx - SPAWN.x, lakeCz - SPAWN.z); // face lake centre
    player.group.rotation.y = spawnYaw;
    scene.add(player.group);
    parts = player.parts;
    camYaw = spawnYaw;

    blob = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.05; scene.add(blob);

    // ─────────────── Collectible coins along the north shore street ───────
    const coinMatLocal = coinMat;
    const coinN = Math.round(22 * density);
    for (let i = 0; i < coinN; i++) {
      const a = -Math.PI / 2 + (hash01(i * 3.3, 1.7) - 0.5) * 1.6;
      const rr = lakeR * 0.55 + hash01(i * 1.9, 4.2) * 40;
      const cxp = lakeCx + Math.cos(a) * rr;
      const czp = lakeNorthZ - 6 - hash01(i * 2.7, 9.1) * 30 + Math.sin(a) * 4;
      spawnCoin(cxp, czp, coinMatLocal);
    }

    // ── Build the collision spatial hash now that every circle has been pushed
    //    (buildings + lake rim + landmarks + furniture from scatterItems). ──
    buildGrid();

    // ── Done: reveal. Guard disposed-before-ready. ──
    if (disposed) return;
    ready = true;
    if (opts.onReady) opts.onReady();
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
    const bridgeStartZ = northZ - 1.5;    // north shore (promenade) end
    const bridgeEndZ = islandZ + islandR - 1.5;
    const bridgeLen = Math.max(6, bridgeStartZ - bridgeEndZ); // north→south span (positive)

    // ── The Huc bridge ──
    (function theHucBridge() {
      const g = new THREE.Group(); g.position.set(ox, 0, 0); scene.add(g);
      const segs = 14, deckW = 3.2, archRise = 1.6;
      // Record the arched deck so step() can lift the player along it.
      bridgeInfo = { ox, startZ: bridgeStartZ, endZ: bridgeEndZ, len: bridgeLen, archRise, halfW: deckW / 2 };
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs;
        const z0 = bridgeStartZ - t0 * bridgeLen, z1 = bridgeStartZ - t1 * bridgeLen;
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
        const z = bridgeStartZ - t * bridgeLen;
        [-1, 1].forEach((sd) => circles.push({ x: ox + sd * (deckW / 2 + 0.3), z, r: 0.55 }));
      }
    })();

    // ── Ngoc Son temple ──
    (function ngocSonTemple() {
      const g = new THREE.Group(); g.position.set(ox, 0, islandZ); scene.add(g);
      // Record the walkable island deck so step() can raise the player onto it.
      islandInfo = { x: ox, z: islandZ, r: islandR, deckY: 0.62 };
      const base = new THREE.Mesh(new THREE.CylinderGeometry(islandR, islandR + 1.2, 1.0, 40), mossStone);
      base.position.y = -0.05; base.castShadow = true; base.receiveShadow = true; g.add(base);
      const lawn = new THREE.Mesh(new THREE.CylinderGeometry(islandR - 1, islandR - 0.5, 0.3, 36), mats.foliage);
      lawn.position.y = 0.5; lawn.receiveShadow = true; g.add(lawn);
      for (let i = 0; i < 3; i++) {
        const a = -1.2 + i * 1.2;
        const tr = props.tree(1.0 + (i % 2) * 0.3);
        tr.position.set(Math.cos(a) * (islandR - 2.5), 0.5, Math.sin(a) * (islandR - 2.5) + 1.5);
        g.add(tr);
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
        if ((i / lampStep) % 2 === 0) {
          const bx = p[0] + (ux / ul) * 2.5, bz = p[1] + (uz / ul) * 2.5;
          placeProp(props.bench(), bx, bz, Math.atan2(ux, uz) + Math.PI / 2);
        }
      }
    } else {
      const lampN = Math.max(8, Math.round(16 * density));
      for (let i = 0; i < lampN; i++) {
        const a = (i / lampN) * Math.PI * 2;
        placeProp(props.streetlight(), lakeCx + Math.cos(a) * 114, lakeCz + Math.sin(a) * 114, a + Math.PI / 2);
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

    const lampP = [], bikeP = [], peopleP = [], signP = [], awnP = [], planterP = [], stallP = [], cafeP = [];
    const poleRuns = [];

    for (const r of roadList) {
      const pts = r.pts;
      if (!pts || pts.length < 2) continue;
      const hw = (r.w && r.w > 0 ? r.w : 5) / 2;
      const polePts = [];
      let acc = 0;          // cumulative distance for ~2 m stepping
      let lampAcc = 0;      // distance since last lamp
      let poleAcc = 0;      // distance since last pole
      let signAcc = 0;      // distance since last awning/sign
      let bikeAcc = 0;      // distance since last bike row
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
            lampP.push({ x: px + nx * (hw + 0.8) * lampSide, z: pz + nz * (hw + 0.8) * lampSide });
            if (hash01(px + 7.1, pz - 4.4) < 0.5) {
              planterP.push({ x: px + nx * (hw + 0.5) * lampSide + tx * 1.4, z: pz + nz * (hw + 0.5) * lampSide + tz * 1.4 });
            }
          }

          // power poles every ~42 m on the +normal side; collected into a run.
          poleAcc += STEP;
          if (poleAcc >= 42) {
            poleAcc = 0;
            polePts.push({ x: px + nx * (hw + 1.3), z: pz + nz * (hw + 1.3) });
          }

          // parked MOTORBIKES along wider curbs, BOTH sides, in short rows.
          bikeAcc += STEP;
          if (hw >= 2.5 && bikeAcc >= 7) {
            bikeAcc = 0;
            for (const side of [1, -1]) {
              if (hash01(px * 1.1 + side * 3.7, pz * 1.1 - 2.9) < 0.7 * dens) {
                const rowLen = 1 + Math.floor(hash01(px + side * 5.5, pz + 2.2) * 3); // 2..4 bikes
                for (let k = 0; k <= rowLen; k++) {
                  bikeP.push({
                    x: px + nx * (hw - 0.6) * side + tx * k * 0.85,
                    z: pz + nz * (hw - 0.6) * side + tz * k * 0.85,
                    ry: ry + (Math.PI / 2) * side,
                  });
                }
              }
            }
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
            awnP.push({ x: sx, z: sz, ry: sry, w: 2 + hash01(px, pz + 1.7) * 2 });
            signP.push({ x: sx, z: sz, ry: sry, hue: hash01(px + 4.4, pz - 3.3) * 360 });
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
              stallP.push({ x: px + nx * (hw + 0.8), z: pz + nz * (hw + 0.8), ry: ry - Math.PI / 2 });
              cafeP.push({ x: px - nx * (hw + 1.0), z: pz - nz * (hw + 1.0), ry: ry + Math.PI / 2 });
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
      if (i % 2 === 0) cafeP.push({ x: px, z: pz, ry: hash01(px, pz) * Math.PI * 2 });
      else stallP.push({ x: px, z: pz, ry: hash01(px + 1, pz) * Math.PI * 2 });
    }

    // Caps by tier before building.
    const bikeCap = q.tier === 'low' ? 350 : q.tier === 'mid' ? 900 : 1600;
    const peopleCap = q.tier === 'low' ? 150 : q.tier === 'mid' ? 450 : 750;
    if (bikeP.length > bikeCap) bikeP.length = bikeCap;
    if (peopleP.length > peopleCap) peopleP.length = peopleCap;
    if (lampP.length > 450) lampP.length = 450;
    if (signP.length > 500) signP.length = 500;
    if (awnP.length > 500) awnP.length = 500;
    if (planterP.length > 400) planterP.length = 400;
    if (stallP.length > 120) stallP.length = 120;
    if (cafeP.length > 120) cafeP.length = 120;

    // Furniture collision (so the player can't walk THROUGH solid items). Pushed
    // here; the spatial grid is built once at the end of build() after these.
    for (const p of lampP) circles.push({ x: p.x, z: p.z, r: 0.35 });
    for (const run of poleRuns) for (const p of run) circles.push({ x: p.x, z: p.z, r: 0.5 });
    for (const p of stallP) circles.push({ x: p.x, z: p.z, r: 1.4 });
    for (const p of cafeP) circles.push({ x: p.x, z: p.z, r: 1.3 });
    for (const p of planterP) circles.push({ x: p.x, z: p.z, r: 0.5 });
    for (const p of bikeP) circles.push({ x: p.x, z: p.z, r: 0.6 });

    // Build + add (each builder returns a Group).
    add(items.lampPosts(lampP));
    for (const run of poleRuns) add(items.powerLines(run));
    add(items.motorbikes(bikeP));
    add(items.people(peopleP));
    add(items.awnings(awnP));
    add(items.hangingSigns(signP));
    add(items.planters(planterP));
    add(items.stalls(stallP));
    add(items.cafes(cafeP));
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

  // ─────────────── coins (helpers used by both build + loop) ───────────────
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
  localMats.push(coinMat);
  function spawnCoin(x, z, mat) {
    const g = new THREE.Group(); g.position.set(x, 0.95, z);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 18), mat || coinMat); c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
    scene.add(g); coins.push({ g, base: 0.95, x, z });
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
    fetch('https://api.open-meteo.com/v1/forecast?latitude=21.0287&longitude=105.8524&current=temperature_2m,weather_code,wind_speed_10m,cloud_cover,is_day&timezone=Asia%2FHo_Chi_Minh')
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
      if (pr > MAXR) { const s = MAXR / pr; pp.x *= s; pp.z *= s; }

      const rad = 0.5;
      if (grid) {
        const pgx = Math.floor(pp.x / GCELL), pgz = Math.floor(pp.z / GCELL);
        for (let gx = pgx - 1; gx <= pgx + 1; gx++) for (let gz = pgz - 1; gz <= pgz + 1; gz++) {
          const arr = grid.get(gx + '_' + gz); if (!arr) continue;
          for (let n = 0; n < arr.length; n++) {
            const b = circles[arr[n]];
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
      if (Math.abs(pp.x - bi.ox) <= bi.halfW + 0.7 && pp.z <= bi.startZ + 0.5 && pp.z >= bi.endZ - 0.5) {
        const tb = Math.max(0, Math.min(1, (bi.startZ - pp.z) / bi.len));
        targetY = 0.4 + Math.sin(tb * Math.PI) * bi.archRise + 0.12;
      }
    }
    if (islandInfo) { const di = islandInfo; if (Math.hypot(pp.x - di.x, pp.z - di.z) <= di.r - 0.4) targetY = Math.max(targetY, di.deckY); }
    pp.y += (targetY - pp.y) * Math.min(1, dt * 9);

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
    // Pull in fast (prevent clipping), ease back out slowly (no pop).
    camDcur += (wantD - camDcur) * Math.min(1, dt * (wantD < camDcur ? 18 : 3));
    const offX = camDcur * Math.cos(camElev) * Math.sin(camYaw);
    const offZ = camDcur * Math.cos(camElev) * Math.cos(camYaw);
    const offY = camDcur * Math.sin(camElev);
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
    .then((data) => { build(data); })
    .catch(() => { build(null); });

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
      for (const m of localMats) m.dispose();
      for (const im of ownedInstanced) im.dispose();   // frees instance attribute buffers
      for (const g of ownedGeoms) g.dispose();
      for (const g of itemGroups) g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposeScene(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (mini.parentNode) mini.parentNode.removeChild(mini);
    },
    recenter() {
      if (!player) return;
      player.group.position.copy(SPAWN);
      player.group.rotation.y = spawnYaw;
    },
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
