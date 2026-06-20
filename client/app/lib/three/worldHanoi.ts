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
import { createAvatar } from './shared/avatarFactory';
import { createKeyboard, createJoystick } from './shared/controls';
import { disposeScene } from './shared/dispose';
import { detectQuality, applyQualityToRenderer } from './shared/quality';
import { createEnvironment } from './shared/environment';
import { createMaterials } from './shared/materials';
import { createComposer } from './shared/postfx';
import { createBuildings } from './shared/buildings';
import { createStreetProps } from './shared/streetprops';
import { buildSocialBenches, benchSlots, occupiedSeats } from './shared/benches';
import { createHanoiFacades } from './shared/hanoiFacades';
import { createHanoiItems } from './shared/hanoiItems';
import { createHanoiAmbience } from './shared/hanoiAmbience';

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
  // PERF: the city is static (merged buildings/roads); only the player (fake blob
  // shadow) and a few NPCs move. Drive shadow-map re-bakes on a fixed ~30Hz cadence
  // from the loop instead of every frame — see `shadowAccum` below.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
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
  // Atmospheric life on the lake (dawn mist, leaves, koi, fireflies). Self-contained
  // module: owns its geom/mat/texture pools + the roots it adds; freed in dispose().
  const ambience = createHanoiAmbience(THREE, { quality: q });
  const itemGroups = [];  // item root groups (geometry freed by items.dispose())

  // ── External CC0 assets (textures + GLB), all with procedural fallbacks ──
  const texer = createTextureLoader({ anisotropy: q.anisotropy });
  const kit = createKitLoader();
  // Trees are now fully procedural (realistic alpha-leaf cards — see buildRealisticTrees),
  // so we no longer preload the low-poly Kenney tree GLBs. The kit still supplies a
  // couple of rooftop detail props on mid/high.
  const kitReady = q.tier === 'low'
    ? Promise.resolve()
    : kit.preloadUrls(['build:detail-awning', 'build:detail-parasol-a']);

  // Configure façade material tiling ONCE: walls are UV-mapped in METRES, so each
  // map repeats every (tileWidth × tileHeight) metres. DoubleSide because the walls
  // are single-quad soups (winding-agnostic) — this fixes shading + visibility.
  const FW = facades.tileWidth, FH = facades.tileHeight;
  for (const fm of facades.materials) {
    fm.side = THREE.FrontSide;             // wall winding is now outward-correct (see WALLS build) → cull interior faces so the camera never sees inside the hollow shell
    fm.vertexColors = true;                // per-building tint (set below) multiplies the shared map → kills the "copy-paste" look
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
  const redPaint = new THREE.MeshStandardMaterial({ color: 0xcf3b29, roughness: 0.6, metalness: 0.0 });   // The Huc vermilion (đỏ son tươi)
  const roofTile = new THREE.MeshStandardMaterial({ color: hsl(17, 0.55, 0.37), roughness: 0.78, metalness: 0.0 }); // temple terracotta
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

  // Procedural GRASS albedo: a tileable mottle of many green shades + a scatter of
  // short blade strokes and a few dry/brown flecks, so the lawns read as real grass
  // instead of a flat fill. Seamless (draws wrap-around). Repeat is set by the caller.
  function makeGrassTexture(size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4f6a33'; ctx.fillRect(0, 0, size, size);
    // Soft clumps of varied green (and a few earthy patches) for large-scale variation.
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 26;
      const dry = Math.random() < 0.12;
      const h = dry ? 52 + Math.random() * 22 : 88 + Math.random() * 22;
      const s = dry ? 30 : 34 + Math.random() * 16;
      const l = (dry ? 30 : 24) + Math.random() * 18;
      ctx.fillStyle = `hsla(${h},${s}%,${l}%,0.22)`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // Fine blade strokes for close-up detail.
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const len = 2 + Math.random() * 5, ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.7;
      ctx.strokeStyle = `hsla(${88 + Math.random() * 22},${38 + Math.random() * 16}%,${20 + Math.random() * 22}%,0.5)`;
      ctx.lineWidth = Math.random() < 0.5 ? 1 : 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (q.anisotropy) tex.anisotropy = q.anisotropy;
    return tex;
  }

  // Procedural LEAF-CLUSTER card (RGBA, alpha-cut): a soft blob of many small leaf
  // ellipses on a transparent ground. Parametrised so each tree SPECIES gets its own
  // foliage look (leaf size, density, hue, and an optional warm flowering mix for
  // phượng / lộc vừng). Drawn onto crossed billboard quads it reads as organic foliage.
  function makeLeafTexture(o = {}) {
    const size = o.size || 256;
    const count = o.count || 320, lmin = o.leafMin || 6, lmax = o.leafMax || 15;
    const hueBase = o.hueBase != null ? o.hueBase : 96, hueSpread = o.hueSpread != null ? o.hueSpread : 34;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, R = size * 0.46;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = (Math.random() ** 0.5) * R * (0.6 + Math.random() * 0.4);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.92;
      const w = lmin + Math.random() * (lmax - lmin), h = w * (0.5 + Math.random() * 0.4);
      const shade = 1 - (y / size) * 0.35;
      let hue = hueBase + Math.random() * hueSpread, sat = 46 + Math.random() * 24, light = (20 + Math.random() * 22) * shade;
      // Flowering species: scatter warm blossom dabs (vermilion / pink) among the green.
      if (o.warm && Math.random() < 0.42) { hue = Math.random() < 0.5 ? 4 + Math.random() * 18 : 330 + Math.random() * 22; sat = 70 + Math.random() * 22; light = (40 + Math.random() * 18) * shade; }
      ctx.save();
      ctx.translate(x, y); ctx.rotate(Math.random() * Math.PI);
      ctx.fillStyle = `hsla(${hue},${sat}%,${light}%,0.92)`;
      ctx.beginPath(); ctx.ellipse(0, 0, w, h, 0, 0, 7); ctx.fill();
      ctx.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (q.anisotropy) tex.anisotropy = q.anisotropy;
    return tex;
  }

  // Procedural PALM FROND card (RGBA, alpha-cut): a FILLED tapered blade with a
  // serrated (pinnate) edge + midrib/veins, drawn tip-UP. Filled — NOT thin lines —
  // so the card reads as solid foliage rather than a see-through "glass" pane.
  function makePalmFrondTexture(w = 128, h = 256) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const midX = w / 2, N = 16;
    const widthAt = (t) => (w * 0.42) * (Math.sin(t * Math.PI) * 0.85 + 0.1) + w * 0.03;
    const yAt = (t) => (h - 6) - t * (h - 14);
    // Filled blade outline with the leaflet serration baked into the edge as bumps.
    ctx.beginPath(); ctx.moveTo(midX, yAt(0));
    for (let i = 0; i <= N; i++) { const t = i / N; const bump = (i % 2 ? 0.82 : 1.0); ctx.lineTo(midX + widthAt(t) * bump, yAt(t)); }
    for (let i = N; i >= 0; i--) { const t = i / N; const bump = (i % 2 ? 0.82 : 1.0); ctx.lineTo(midX - widthAt(t) * bump, yAt(t)); }
    ctx.closePath();
    ctx.fillStyle = 'hsla(108,42%,30%,1)'; ctx.fill();          // solid green blade
    // Midrib + a few veins for depth.
    ctx.strokeStyle = 'hsla(100,38%,22%,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(midX, yAt(0)); ctx.lineTo(midX, yAt(1)); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let i = 1; i < N; i++) {
      const t = i / N, y = yAt(t), len = widthAt(t) * 0.8;
      ctx.strokeStyle = `hsla(104,40%,${20 + Math.random() * 10}%,0.7)`;
      [-1, 1].forEach((sd) => { ctx.beginPath(); ctx.moveTo(midX, y); ctx.lineTo(midX + sd * len, y - 8); ctx.stroke(); });
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (q.anisotropy) tex.anisotropy = q.anisotropy;
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
      waterColor: new THREE.Color().setHSL(150 / 360, 0.46, 0.22).getHex(), // "lục thủy" — the green Hoan Kiem water
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

  // Build the alpha-leaf-card material for a species (shared sway shader + alphaTest).
  // FULLY MATTE: roughness 1 + envMapIntensity 0 so the flat cards don't mirror the
  // sky IBL — that sheen is what read as a glassy / glass-pane look on the foliage.
  function makeLeafMaterial(tex) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex, color: 0xffffff, roughness: 1.0, metalness: 0,
      alphaTest: 0.5, side: THREE.DoubleSide,    // alphaTest (not transparent) → no sort issues
      transparent: false, depthWrite: true,
    });
    mat.envMapIntensity = 0;                      // kill the sky reflection (no glass sheen)
    localMats.push(mat);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = swayUniforms.uTime;
      shader.uniforms.uWind = swayUniforms.uWind;
      shader.uniforms.uWindDir = swayUniforms.uWindDir;
      shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uWindDir;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         float swayPhase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.15;
         float swayAmt = sin(uTime * 1.5 + swayPhase) * (0.06 + uWind * 0.24) * (position.y * 0.5 + 0.5);
         transformed.x += cos(uWindDir) * swayAmt;
         transformed.z += sin(uWindDir) * swayAmt;`);
    };
    return mat;
  }

  // Realistic instanced trees with MULTIPLE SPECIES (broadleaf shade tree, tall
  // slender tree, flowering phượng/lộc vừng, and fan palms) so the greenery is as
  // varied as the real Hoan Kiem shore. Each species has its own foliage texture,
  // crown shape (volume canopy vs. radiating palm fronds), trunk + size band; trees
  // are assigned by a weighted hash of their real position. Per species: one trunk
  // InstancedMesh + one card InstancedMesh (a handful of draw calls total). Cards sway
  // in the wind; trunks cast shadow on high; alpha cards never cast shadow.
  function buildRealisticTrees(treeList, castShadows) {
    const lod = q.tier === 'high' ? 1 : q.tier === 'mid' ? 0.8 : 0.6;   // fewer cards on weaker tiers
    const palmTrunkMat = new THREE.MeshStandardMaterial({ color: hsl(32, 0.2, 0.4), roughness: 0.9, metalness: 0 });
    localMats.push(palmTrunkMat);

    // Species table. `mode`: 'volume' = rounded broadleaf crown of fanned cards;
    // 'palm' = a slim trunk topped by radiating frond cards. `cards` is per-tree.
    const SPECIES = [
      { key: 'broadleaf', weight: 0.42, mode: 'volume', cards: Math.round(6 * lod),
        tex: makeLeafTexture({ hueBase: 96, hueSpread: 24, leafMin: 6, leafMax: 15, count: 340 }),
        trunkMat: mats.bark, trunkTop: 0.12, trunkBot: 0.30, hMin: 5.0, hMax: 8.5, canMin: 1.8, canMax: 3.1, vstretch: 1.0, tint: [104, 0.34, 0.35] },
      { key: 'slender', weight: 0.24, mode: 'volume', cards: Math.round(5 * lod),
        tex: makeLeafTexture({ hueBase: 110, hueSpread: 22, leafMin: 5, leafMax: 11, count: 300 }),
        trunkMat: mats.bark, trunkTop: 0.10, trunkBot: 0.22, hMin: 7.0, hMax: 11.0, canMin: 1.2, canMax: 2.0, vstretch: 1.6, tint: [112, 0.32, 0.36] },
      { key: 'flower', weight: 0.14, mode: 'volume', cards: Math.round(6 * lod),
        tex: makeLeafTexture({ hueBase: 92, hueSpread: 26, leafMin: 6, leafMax: 14, count: 340, warm: true }),
        trunkMat: mats.bark, trunkTop: 0.14, trunkBot: 0.30, hMin: 5.0, hMax: 8.0, canMin: 1.9, canMax: 3.0, vstretch: 0.9, tint: [104, 0.38, 0.37] },
      { key: 'palm', weight: 0.20, mode: 'palm', cards: Math.round(9 * lod),
        tex: makePalmFrondTexture(), trunkMat: palmTrunkMat, trunkTop: 0.16, trunkBot: 0.28,
        hMin: 7.0, hMax: 12.0, canMin: 2.2, canMax: 3.2, vstretch: 1.0, tint: [110, 0.4, 0.4] },
    ];
    // Cumulative weights for assignment.
    let acc = 0; for (const s of SPECIES) { s._c0 = acc; acc += s.weight; s._c1 = acc; }

    // Assign every real tree to a species (seeded by position) + count per species.
    const cardGeo = new THREE.PlaneGeometry(1, 1); ownedGeoms.push(cardGeo);
    const assign = new Array(treeList.length);
    for (const s of SPECIES) s._n = 0;
    for (let i = 0; i < treeList.length; i++) {
      const tx = treeList[i][0], tz = treeList[i][1];
      const h = hash01(tx * 1.7 + 11, tz * 0.9 - 4) * acc;
      let s = SPECIES[0];
      for (const sp of SPECIES) { if (h >= sp._c0 && h < sp._c1) { s = sp; break; } }
      assign[i] = s; s._n++;
    }

    // Allocate the per-species instanced meshes + their own trunk geometry.
    for (const s of SPECIES) {
      if (!s._n) continue;
      s._trunkGeo = new THREE.CylinderGeometry(s.trunkTop, s.trunkBot, 1, 7).translate(0, 0.5, 0);
      ownedGeoms.push(s._trunkGeo);
      s._leafMat = makeLeafMaterial(s.tex); ownedTextures.push(s.tex);
      s._trunks = new THREE.InstancedMesh(s._trunkGeo, s.trunkMat, s._n);
      s._cards = new THREE.InstancedMesh(cardGeo, s._leafMat, s._n * s.cards);
      s._trunks.castShadow = castShadows; s._trunks.receiveShadow = false; s._trunks.frustumCulled = false;
      s._cards.castShadow = false; s._cards.receiveShadow = false; s._cards.frustumCulled = false;
      s._cards.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(s._n * s.cards * 3), 3);
      s._ti = 0; s._ci = 0;
    }

    const m = new THREE.Matrix4(), e = new THREE.Euler(), quat = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (let i = 0; i < treeList.length; i++) {
      const s = assign[i];
      const tx = treeList[i][0], tz = treeList[i][1];
      circles.push({ x: tx, z: tz, r: 0.5 });   // trunk collision
      const r1 = hash01(tx + 1.7, tz - 2.3), r2 = hash01(tz * 1.3, tx * 0.7), r3 = hash01(tx * 2.1 + 5, tz);
      const height = s.hMin + r1 * (s.hMax - s.hMin);
      const trunkH = height * (s.mode === 'palm' ? 0.82 : 0.42);   // palms = tall bare trunk
      const canopyR = s.canMin + r2 * (s.canMax - s.canMin);
      const yaw = r3 * Math.PI * 2;
      const ti = s._ti++;

      // Trunk.
      quat.setFromAxisAngle(up, yaw);
      pos.set(tx, 0, tz); scl.set(0.85 + r2 * 0.5, trunkH, 0.85 + r2 * 0.5);
      m.compose(pos, quat, scl); s._trunks.setMatrixAt(ti, m);

      // Per-tree tint (multiplies the foliage texture).
      col.setHSL((s.tint[0] + (r3 - 0.5) * 16) / 360, s.tint[1], s.tint[2] + r2 * 0.1);

      if (s.mode === 'palm') {
        // A crown of fronds radiating from the trunk top, arcing up-and-out then down.
        const cy = trunkH;
        for (let k = 0; k < s.cards; k++) {
          const kr = hash01(tx + k * 3.3, tz - k * 1.9);
          const fyaw = yaw + (k / s.cards) * Math.PI * 2 + (kr - 0.5) * 0.3;
          const tilt = -0.55 - kr * 0.5;                 // arc outward then droop
          const len = canopyR * (1.6 + kr * 0.7);
          const ox = Math.cos(fyaw) * canopyR * 0.5, oz = Math.sin(fyaw) * canopyR * 0.5;
          e.set(tilt, fyaw, 0); quat.setFromEuler(e);
          pos.set(tx + ox, cy + 0.3, tz + oz); scl.set(len * 0.5, len, len);
          m.compose(pos, quat, scl);
          const ci = s._ci++;
          s._cards.setMatrixAt(ci, m); s._cards.setColorAt(ci, col);
        }
      } else {
        // Volume canopy: cards fanned + stacked to fill a rounded (or tall) crown.
        const cy = trunkH + canopyR * 0.7 * s.vstretch;
        for (let k = 0; k < s.cards; k++) {
          const kr = hash01(tx + k * 3.3, tz - k * 1.9);
          const cardYaw = yaw + (k / s.cards) * Math.PI * 2 + (kr - 0.5) * 0.5;
          const tilt = (k % 2 ? 0.5 : -0.35) + (kr - 0.5) * 0.4;
          const sz = canopyR * (1.7 + kr * 0.8);
          const oy = (kr - 0.5) * canopyR * 0.7 * s.vstretch;
          const ox = Math.cos(cardYaw) * canopyR * 0.25, oz = Math.sin(cardYaw) * canopyR * 0.25;
          e.set(tilt, cardYaw, 0); quat.setFromEuler(e);
          pos.set(tx + ox, cy + oy, tz + oz); scl.set(sz, sz * (0.8 + kr * 0.3) * s.vstretch, sz);
          m.compose(pos, quat, scl);
          const ci = s._ci++;
          s._cards.setMatrixAt(ci, m); s._cards.setColorAt(ci, col);
        }
      }
    }

    for (const s of SPECIES) {
      if (!s._n) continue;
      s._trunks.instanceMatrix.needsUpdate = true;
      s._cards.instanceMatrix.needsUpdate = true;
      s._cards.instanceColor.needsUpdate = true;
      s._trunks.matrixAutoUpdate = false; s._trunks.updateMatrix();
      s._cards.matrixAutoUpdate = false; s._cards.updateMatrix();
      scene.add(s._trunks); scene.add(s._cards);
      ownedInstanced.push(s._trunks, s._cards);
    }
  }

  // ── Runtime state shared between the async build and the API/loop ─────────
  let disposed = false;
  let ready = false;
  let raf = 0, running = true;
  let player = null, blob = null;   // player.parts is read directly (GLB swap-safe)
  let heldExpr = null, heldExprUntil = 0;   // a user-picked expression holds ~4 s over the auto neutral/surprised
  let SPAWN = new THREE.Vector3(0, 0, -300);   // overwritten once the lake is known
  let spawnYaw = 0;                            // facing-the-lake rotation at spawn
  let MAXR = 520;                              // player clamp radius (extentR + margin)
  // Orbit-zoom range. CAM_MAX is raised to ~extentR*0.7 in build() so the player can
  // pull WAY back to an aerial survey of the whole Old Quarter, then zoom to street level.
  let CAM_MIN = 5, CAM_MAX = 420, CAM_ELEV_MAX = 1.5;
  let skylinePlaced = 0;                       // count of procedural backdrop boxes

  // ── Lake (Three.js Water) + wind + GLB/anim state ─────────
  let water = null;            // reflective animated lake
  let waterNormals = null;     // normal texture (real or procedural fallback)
  let windDir = 0;             // radians; ripple drift direction (from weather)
  const waterWindShift = new THREE.Vector2(0, 0); // accumulated downwind drift of the ripples
  let birdMesh = null;         // instanced bird flock (built in build())
  const birdParams = [];       // per-bird orbit params
  // Wet-weather state: materials that gain a wet sheen in rain (roofs + façades),
  // scattered reflective puddles on the roads, and the last-applied wetness (throttle).
  const wetMats = [];          // [{ m, r0, e0 }] base roughness/envMapIntensity
  let puddles = null, puddleMat = null;
  let lampGlow = null, lampGlowMat = null;   // warm ground pools under street lamps (ramped at night)
  let lastWet = -1;
  // Dev weather override (press 'r' to cycle): -1 = real Open-Meteo, else an index
  // into FORCE_WX (clear / light rain / heavy rain) so the rain can be tested anytime.
  let forceWx = -1;
  const FORCE_WX = [{ o: 0, r: 0 }, { o: 0.55, r: 0.5 }, { o: 0.9, r: 1.0 }];
  const charMixers = [];       // AnimationMixers for the animated hero NPCs
  const charRoots = [];        // their root Object3Ds (cleaned up on dispose)
  // Ambient people INSIDE the city (procedural crowd + animated hero NPCs) are
  // disabled: they had no collision so the player walked straight through them.
  // The perimeter/gate guards (liveGuards) are functional and stay.
  const SHOW_CITY_NPCS = false;

  // ── Multiplayer presence + shared bench seating ──────────────────────────
  // Real players (signed-in + guests) appear here, synced via the realtime layer
  // that WorldScreen wires in. The engine renders REMOTE avatars from snapshots
  // and reports the LOCAL transform out each tick; seat claims are arbitrated by
  // the server. All of this is inert (single-player) if no realtime opts are set.
  const SELF_ID = opts.selfId || null;
  const remotePlayers = new Map();   // id -> { av, group, parts, tx,tz,tRotY, anim, seatId, tag, last }
  let socialBenches = [];            // canonical sittable benches (cross-client stable)
  const seatById = new Map();        // seatId -> { x, z, rotY }
  let occupiedRemote = new Set();    // seatIds held by OTHER players (from snapshot)
  let localSeatId = null;            // the seat this client currently sits in
  let pendingSeatId = null;          // a claim awaiting server grant
  let sitting = false;               // local player is seated
  let nearestFreeSeatId = null;      // nearest sittable seat for the prompt
  let lastSitSig = '';               // change-detector for opts.onSit
  const SEAT_Y = 0.46;               // avatar lift when sitting on a bench
  const SIT_REACH = 2.2;             // how close to a seat to offer "sit"
  // Chat: floating speech bubbles above heads (local + remote), auto-fading.
  const bubbles = new Map();         // id -> { sprite, group, until }
  const BUBBLE_MS = 6000;

  // Tree foliage wind-sway uniforms (bound in build() onBeforeCompile).
  const swayUniforms = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: 0 } };

  // ── Perimeter-gate / auth state ──────────────────────────
  // Unauthenticated players spawn OUTSIDE the fence and must clear a gate's
  // ticket check to come in. `entered` flips true once they're inside the ring.
  let fenceR = 0;                              // perimeter fence radius (set in build)
  // Inside the fence? Signed-in players start inside; a guest who previously
  // cleared a gate resumes inside too (the saved position carries an `entered`
  // flag so a reload doesn't kick them back out to the gate).
  let entered = !!opts.authed || !!(opts.startPos && opts.startPos.entered);
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

    // ── GROUND — a large earth plane under everything (covers the skyline) ──
    // Procedural packed-dirt so the open ground reads as real earth (mottled browns
    // + grit) instead of a flat default fill. Tiled over the huge ground disc.
    const dirtCanvas = document.createElement('canvas'); dirtCanvas.width = dirtCanvas.height = 256;
    {
      const g2 = dirtCanvas.getContext('2d');
      g2.fillStyle = '#6b5236'; g2.fillRect(0, 0, 256, 256);                       // base earth
      for (let i = 0; i < 900; i++) {                                              // soft mottling
        const x = Math.random() * 256, y = Math.random() * 256, r = 8 + Math.random() * 40;
        g2.fillStyle = `hsla(${28 + Math.random() * 16},${22 + Math.random() * 20}%,${16 + Math.random() * 22}%,0.18)`;
        g2.beginPath(); g2.arc(x, y, r, 0, 7); g2.fill();
      }
      for (let i = 0; i < 1400; i++) {                                            // grit / pebbles
        const x = Math.random() * 256, y = Math.random() * 256, r = 0.5 + Math.random() * 1.8;
        g2.fillStyle = Math.random() < 0.6 ? `hsla(30,20%,${10 + Math.random() * 10}%,0.5)` : `hsla(36,16%,${48 + Math.random() * 16}%,0.4)`;
        g2.beginPath(); g2.arc(x, y, r, 0, 7); g2.fill();
      }
    }
    const dirtTex = new THREE.CanvasTexture(dirtCanvas);
    dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping; dirtTex.colorSpace = THREE.SRGBColorSpace;
    // Modest tiling + full anisotropy so the dirt doesn't shimmer/moiré at distance.
    dirtTex.repeat.set(70, 70); dirtTex.anisotropy = Math.max(4, q.anisotropy || 4);
    ownedTextures.push(dirtTex);
    // The dirt is the BASE layer under everything; a positive polygonOffset pushes it
    // back in the depth buffer so the near-coplanar greens / roads / sidewalks always
    // win the z-test (no flicker) regardless of the tiny y-gaps between the layers.
    const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, map: dirtTex });
    groundMat.polygonOffset = true; groundMat.polygonOffsetFactor = 2; groundMat.polygonOffsetUnits = 2;
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
      // Tileable procedural grass albedo. ShapeGeometry UVs equal the shape's metre
      // coordinates, so a RepeatWrapping map with repeat = 1/tileMetres tiles cleanly
      // across every park patch. color stays near-white so the texture's own greens
      // (and blade detail) read true; pitch gets a cooler turf tint.
      const grassTex = makeGrassTexture(); grassTex.repeat.set(0.3, 0.3); ownedTextures.push(grassTex);
      const lawnMat = new THREE.MeshStandardMaterial({ color: hsl(96, 0.13, 0.50), roughness: 1, metalness: 0, map: grassTex });
      const pitchMat = new THREE.MeshStandardMaterial({ color: hsl(120, 0.2, 0.5), roughness: 1, metalness: 0, map: grassTex });
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
        // Keep the UVs (= metre coords) so the tiling grass map lands seamlessly.
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
    const roofMat = new THREE.MeshStandardMaterial({ color: hsl(30, 0.05, 0.32), roughness: 0.95, metalness: 0 });
    localMats.push(roofMat);
    // Pitched terracotta-tiled hip roofs (one merged mesh). Most low Hanoi
    // tube-houses get one of these instead of a flat cap; the rest stay flat.
    const roofTileMat = new THREE.MeshStandardMaterial({ color: hsl(17, 0.55, 0.37), roughness: 0.82, metalness: 0 });
    localMats.push(roofTileMat);
    // These (and every façade material) gain a wet sheen when it rains — record their
    // dry roughness / env intensity so the loop can lerp them by the wetness factor.
    for (const wm of [roofMat, roofTileMat, ...facades.materials]) {
      wetMats.push({ m: wm, r0: wm.roughness, e0: wm.envMapIntensity != null ? wm.envMapIntensity : 1 });
    }
    const roofTileGeoms = [];                              // pitched hip roofs (one merged mesh)
    const pitchedSet = new Set();                          // polys given a pitched roof (skip flat detail)

    // ── FAÇADE RELIEF — protruding cornices + floor-line string courses ──────
    // Buildings are extruded flat prisms, so every window/balcony is painted on the
    // texture and walls read dead-flat at grazing angles. For the houses around the
    // lake we trace a thin ledge ribbon (gờ tường) around the footprint at the
    // roofline and at each upper floor line: real geometry that throws a horizontal
    // shadow line and gives the wall depth. All ledges → ONE merged mesh. Skipped on
    // LOW tier and for buildings far from the lake (the playable core), for budget.
    const ledgePos = [], ledgeIdx = [];
    const LEDGE_R2 = 210 * 210;                            // only within ~210 m of the lake
    const pushLedge = (poly, ccx, ccz, y0, prot, hgt) => {
      const N = poly.length;
      const v = (arr) => { for (const p of arr) ledgePos.push(p[0], p[1], p[2]); };
      for (let i = 0; i < N; i++) {
        const a = poly[i], b = poly[(i + 1) % N];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        let nx = -dz, nz = dx;                              // edge normal
        const mxe = (a[0] + b[0]) / 2, mze = (a[1] + b[1]) / 2;
        if ((mxe - ccx) * nx + (mze - ccz) * nz < 0) { nx = -nx; nz = -nz; }   // force outward
        const ox = nx * prot, oz = nz * prot;
        const yb = y0, yt = y0 + hgt;
        const iAb = [a[0], yb, a[1]], iBb = [b[0], yb, b[1]], iAt = [a[0], yt, a[1]], iBt = [b[0], yt, b[1]];
        const oAb = [a[0] + ox, yb, a[1] + oz], oBb = [b[0] + ox, yb, b[1] + oz];
        const oAt = [a[0] + ox, yt, a[1] + oz], oBt = [b[0] + ox, yt, b[1] + oz];
        const base = ledgePos.length / 3;
        v([oAb, oBb, oBt, oAt]);   // outer vertical face
        v([iAt, iBt, oBt, oAt]);   // top of the ledge
        v([iAb, oAb, oBb, iBb]);   // underside (catches the shadow line)
        for (let qd = 0; qd < 3; qd++) { const bq = base + qd * 4; ledgeIdx.push(bq, bq + 1, bq + 2, bq, bq + 2, bq + 3); }
      }
    };

    // Reserve enterable-landmark footprints on the lake promenade (facing the
    // lake) so the OSM footprints below can be cleared from those spots — otherwise
    // the landmark boxes would intersect real buildings. Each site's facade sits
    // just outside the promenade ring; the body extends back (−local z).
    landmarkSites = [
      { key: 'cathedral', ang: -Math.PI / 2, W: 11, D: 13, H: 8 },   // west
      { key: 'opera', ang: Math.PI / 4, W: 16, D: 12, H: 8 },        // south-east
      { key: 'post', ang: -Math.PI / 4, W: 14, D: 11, H: 7 },        // south-west
    ].map((s) => {
      const setback = 7;
      const fx = lakeCx + Math.sin(s.ang) * (lakeR + setback);
      const fz = lakeCz + Math.cos(s.ang) * (lakeR + setback);
      const yaw = Math.atan2(lakeCx - fx, lakeCz - fz);              // local +z faces the lake
      const cx = fx - Math.sin(yaw) * (s.D / 2), cz = fz - Math.cos(yaw) * (s.D / 2);
      return { ...s, fx, fz, yaw, cx, cz, clearR: Math.hypot(s.W, s.D) / 2 + 4 };
    });

    let buildList = (data && data.buildings) ? data.buildings : [];
    // Drop any OSM building whose FOOTPRINT reaches a reserved landmark plot
    // (centroid distance minus the building's own radius), so no real building
    // can poke an edge into a landmark.
    buildList = buildList.filter((b) => {
      if (!b.poly || b.poly.length < 3) return true;
      let x = 0, z = 0; for (const p of b.poly) { x += p[0]; z += p[1]; }
      x /= b.poly.length; z /= b.poly.length;
      let br = 0; for (const p of b.poly) br = Math.max(br, Math.hypot(p[0] - x, p[1] - z));
      return !landmarkSites.some((s) => Math.hypot(x - s.cx, z - s.cz) < s.clearR + br);
    });
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
      // ONE consistent winding for the whole footprint, from the signed area —
      // exact for CONCAVE footprints too (the old per-edge centroid test flipped
      // concave edges individually into see-through holes). The natural winding
      // (A0,B0,B1) has outward horizontal normal (-ez, ex); for a positive-area
      // (CCW) loop that points INWARD, so flip every edge.
      let area2 = 0;
      for (let i = 0; i < N; i++) { const p = poly[i], np = poly[(i + 1) % N]; area2 += p[0] * np[1] - np[0] * p[1]; }
      const keepNatural = area2 < 0;
      for (let i = 0; i < N; i++) {
        const a = inset(poly[i]), b2 = inset(poly[(i + 1) % N]);
        const ax = a[0], az = a[1], bx = b2[0], bz = b2[1];
        const segLen = Math.hypot(bx - ax, bz - az);
        const u0 = perim, u1 = perim + segLen;
        // four corners: a-bottom(a0), b-bottom(b0), b-top(b1), a-top(a1)
        const A0 = [ax, 0, az], B0 = [bx, 0, bz], B1 = [bx, h, bz], A1 = [ax, h, az];
        const uA0 = [u0, 0], uB0 = [u1, 0], uB1 = [u1, h], uA1 = [u0, h];
        if (keepNatural) {
          wpos.push(...A0, ...B0, ...B1); wuv.push(...uA0, ...uB0, ...uB1);
          wpos.push(...A0, ...B1, ...A1); wuv.push(...uA0, ...uB1, ...uA1);
        } else {
          wpos.push(...A0, ...B1, ...B0); wuv.push(...uA0, ...uB1, ...uB0);
          wpos.push(...A0, ...A1, ...B1); wuv.push(...uA0, ...uA1, ...uB1);
        }
        perim = u1;
      }
      const wgeo = new THREE.BufferGeometry();
      wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wgeo.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
      wgeo.computeVertexNormals();
      // Per-building tint: one constant colour over all of this house's walls so
      // neighbours sharing the SAME façade material still read as individual houses
      // (brighter/darker, a touch warmer/cooler). Multiplies the texture via
      // vertexColors — no extra material/draw call. Range stays near white so the
      // painted-plaster look is preserved; lit windows (emissiveMap) are untouched.
      const tA = hash01(cx2 * 0.13 + 5.7, cz2 * 0.17 - 3.1);
      const tB = hash01(cz2 * 0.11 - 2.3, cx2 * 0.19 + 7.9);
      const bright = 0.80 + tA * 0.34;          // 0.80 .. 1.14
      const warm = (tB - 0.5) * 0.12;           // ±0.06 warm/cool skew
      const tcR = Math.min(1.3, bright * (1 + warm));
      const tcG = bright;
      const tcB = Math.min(1.3, bright * (1 - warm));
      const vcount = wpos.length / 3;
      const cols = new Float32Array(vcount * 3);
      for (let k = 0; k < vcount; k++) { cols[k * 3] = tcR; cols[k * 3 + 1] = tcG; cols[k * 3 + 2] = tcB; }
      wgeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      bucketGeoms[facades.pickVariant(hash01(cx2 + 3.1, cz2 - 1.7), h)].push(wgeo);

      // Façade relief: a roofline cornice + upper floor-line bands for near-lake
      // houses, so the flat prism gains real horizontal shadow lines (see pushLedge).
      if (q.tier !== 'low' && h >= 6 && ((cx2 - lakeCx) ** 2 + (cz2 - lakeCz) ** 2) < LEDGE_R2) {
        pushLedge(poly, cx2, cz2, h - 0.4, 0.28, 0.34);                 // cornice just under the roof
        for (let fy = 3.3; fy <= h - 2.0; fy += 3.3) {
          pushLedge(poly, cx2, cz2, fy - 0.09, 0.12, 0.18);            // slim band at each floor line
        }
      }

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
    // Merge all façade-relief ledges (cornices + floor bands) → one trim mesh.
    if (ledgePos.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(ledgePos, 3));
      lg.setIndex(ledgeIdx); lg.computeVertexNormals();
      ownedGeoms.push(lg);
      // Weathered render/concrete trim, DoubleSide so winding never matters.
      const trimMat = new THREE.MeshStandardMaterial({ color: hsl(40, 0.05, 0.60), roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
      localMats.push(trimMat);
      wetMats.push({ m: trimMat, r0: trimMat.roughness, e0: 1 });
      const lm = new THREE.Mesh(lg, trimMat);
      lm.castShadow = true; lm.receiveShadow = true;
      lm.matrixAutoUpdate = false; lm.updateMatrix();
      scene.add(lm);
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
      const SKY_HUES = [40, 200, 12, 120, 210, 35, 180];
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
      const uv = [];
      const idx = [];
      let base = 0;
      const US = 0.12;   // planar UV scale (world metres → texture units) so asphalt tiles
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len; // unit perpendicular
        // quad: a-left, a-right, b-left, b-right (y handled by mesh position)
        const al = [a[0] + nx * hw, a[1] + nz * hw], ar = [a[0] - nx * hw, a[1] - nz * hw];
        const bl = [b[0] + nx * hw, b[1] + nz * hw], br = [b[0] - nx * hw, b[1] - nz * hw];
        pos.push(al[0], 0, al[1], ar[0], 0, ar[1], bl[0], 0, bl[1], br[0], 0, br[1]);
        // Planar XZ UVs → the asphalt grain actually tiles (was flat without UVs).
        uv.push(al[0] * US, al[1] * US, ar[0] * US, ar[1] * US, bl[0] * US, bl[1] * US, br[0] * US, br[1] * US);
        idx.push(base, base + 2, base + 1,  base + 1, base + 2, base + 3);
        base += 4;
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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

    // ── ROAD DETAILING — raised kerbs, stone pavements + dashed lane markings ──
    // Static realism for the carriageway: a vertical KERB face (đá vỉa) along each
    // road edge rising from the asphalt to the sidewalk, a flat PAVING slab (vỉa
    // hè) behind it, and dashed centre LANE markings on the wider streets. Any
    // pavement stretch whose centre falls inside a real building footprint is
    // skipped — Old-Quarter tube houses front straight onto the kerb, so the stone
    // never pokes through a wall (narrow alleys simply get no sidewalk). Each
    // category is merged into ONE mesh → only ~3 extra draw calls for the whole map.
    if (roadList.length) {
      const ROAD_Y = 0.14, KERB_Y = 0.205, LINE_Y = 0.158;   // asphalt < kerb-top; paint just above asphalt
      const SW = 2.2;                                          // sidewalk depth (m)

      // Point-in-building test (buildingPolys was filled during the building loop
      // above, so it's complete by now). bbox pre-filter keeps it cheap.
      const inBldg = (x, z) => {
        for (let b = 0; b < buildingPolys.length; b++) {
          const bp = buildingPolys[b];
          if (x < bp.minx || x > bp.maxx || z < bp.minz || z > bp.maxz) continue;
          const poly = bp.poly; let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
            if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
          }
          if (inside) return true;
        }
        return false;
      };

      const sPos = [], sIdx = [], sUV = [];   // sidewalk slabs (paving) + planar UVs for the stone map
      const kPos = [], kIdx = [];   // kerb faces (curb)
      const lPos = [], lIdx = [];   // lane markings (paint)
      const quad = (P, I, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
        const base = P.length / 3;
        P.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
        I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };

      for (const r of roadList) {
        const pts = r.pts; if (!pts || pts.length < 2) continue;
        const hw = (r.w && r.w > 0 ? r.w : 4) / 2;
        const wide = hw >= 3;        // centre dashes only on real carriageways, not alleys
        let arc = 0;                 // running arc-length for the dash pattern

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz); if (len < 0.001) continue;
          const tx = dx / len, tz = dz / len;   // unit tangent
          const nx = -tz, nz = tx;              // left normal

          // Kerb + pavement on BOTH sides of the segment.
          for (const s of [1, -1]) {
            const ix0 = a[0] + nx * hw * s, iz0 = a[1] + nz * hw * s;                 // road edge, A
            const ix1 = b[0] + nx * hw * s, iz1 = b[1] + nz * hw * s;                 // road edge, B
            const ox0 = a[0] + nx * (hw + SW) * s, oz0 = a[1] + nz * (hw + SW) * s;   // sidewalk outer, A
            const ox1 = b[0] + nx * (hw + SW) * s, oz1 = b[1] + nz * (hw + SW) * s;   // sidewalk outer, B
            const mx = (ix0 + ix1 + ox0 + ox1) * 0.25, mz = (iz0 + iz1 + oz0 + oz1) * 0.25;
            if (inBldg(mx, mz)) continue;       // pavement would sit inside a building → skip
            // Vertical kerb face (asphalt → kerb top) along the road edge.
            quad(kPos, kIdx, ix0, ROAD_Y, iz0, ix1, ROAD_Y, iz1, ix1, KERB_Y, iz1, ix0, KERB_Y, iz0);
            // Flat sidewalk slab behind the kerb (planar XZ UVs → ~2 m stone tiles).
            quad(sPos, sIdx, ix0, KERB_Y, iz0, ix1, KERB_Y, iz1, ox1, KERB_Y, oz1, ox0, KERB_Y, oz0);
            sUV.push(ix0 * 0.125, iz0 * 0.125, ix1 * 0.125, iz1 * 0.125, ox1 * 0.125, oz1 * 0.125, ox0 * 0.125, oz0 * 0.125);
          }

          // Dashed centre line: march the segment, ON for 2.4 m then OFF for 3.0 m.
          if (wide) {
            let t = 0;
            while (t < len) {
              const step = Math.min(0.6, len - t);
              if ((arc % 5.4) < 2.4) {
                const w2 = 0.09;
                const cx0 = a[0] + tx * t, cz0 = a[1] + tz * t;
                const cx1 = a[0] + tx * (t + step), cz1 = a[1] + tz * (t + step);
                quad(lPos, lIdx,
                  cx0 + nx * w2, LINE_Y, cz0 + nz * w2,
                  cx1 + nx * w2, LINE_Y, cz1 + nz * w2,
                  cx1 - nx * w2, LINE_Y, cz1 - nz * w2,
                  cx0 - nx * w2, LINE_Y, cz0 - nz * w2);
              }
              arc += step; t += step;
            }
          }
        }
      }

      const mkGeo = (P, I) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setIndex(I); g.computeVertexNormals();
        ownedGeoms.push(g);
        return g;
      };
      const addStatic = (mesh) => { mesh.matrixAutoUpdate = false; mesh.updateMatrix(); scene.add(mesh); };
      if (sPos.length) {
        const g = mkGeo(sPos, sIdx);
        g.setAttribute('uv', new THREE.Float32BufferAttribute(sUV, 2));
        const m = new THREE.Mesh(g, mats.paving);
        m.receiveShadow = true; addStatic(m);
      }
      if (kPos.length) {
        const m = new THREE.Mesh(mkGeo(kPos, kIdx), mats.curb);
        m.castShadow = false; m.receiveShadow = true; addStatic(m);
      }
      if (lPos.length) {
        // Worn off-white road paint; polygonOffset so it never z-fights the asphalt.
        const lineMat = new THREE.MeshStandardMaterial({ color: hsl(46, 0.10, 0.74), roughness: 0.7, metalness: 0 });
        lineMat.polygonOffset = true; lineMat.polygonOffsetFactor = -4; lineMat.polygonOffsetUnits = -4;
        localMats.push(lineMat);
        const m = new THREE.Mesh(mkGeo(lPos, lIdx), lineMat); addStatic(m);
      }
    }

    // ── Rain PUDDLES — reflective discs scattered on the carriageways (the low,
    // flat spots where water pools). One InstancedMesh; faded in by the wetness
    // factor in the loop. Dark + glossy so they mirror the sky/IBL like real water. ──
    const puddleN = q.tier === 'high' ? 90 : q.tier === 'mid' ? 56 : 26;
    if (roadList.length) {
      const pgeo = new THREE.CircleGeometry(1, 18); pgeo.rotateX(-Math.PI / 2);
      ownedGeoms.push(pgeo);
      puddleMat = new THREE.MeshStandardMaterial({
        color: hsl(205, 0.08, 0.16), roughness: 0.06, metalness: 0,
        transparent: true, opacity: 0, depthWrite: false,
      });
      puddleMat.envMapIntensity = 1.6;
      puddleMat.polygonOffset = true; puddleMat.polygonOffsetFactor = -3; puddleMat.polygonOffsetUnits = -3;
      localMats.push(puddleMat);
      puddles = new THREE.InstancedMesh(pgeo, puddleMat, puddleN);
      puddles.frustumCulled = false; puddles.renderOrder = 2; puddles.visible = false;
      const m = new THREE.Matrix4(), e = new THREE.Euler(), qq = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
      for (let i = 0; i < puddleN; i++) {
        const r = roadList[Math.floor(hash01(i * 7.3, i * 2.1) * roadList.length) % roadList.length];
        const pts = r.pts;
        const segs = Math.max(1, pts.length - 1);
        const si = Math.floor(hash01(i * 1.7 + 3, i) * segs) % segs;
        const a = pts[si], b = pts[si + 1] || pts[si];
        const tt = hash01(i * 3.1, i * 5.7);
        const hw = (r.w && r.w > 0 ? r.w : 4) / 2;
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        const jitter = (hash01(i * 9.1, i + 1) - 0.5) * hw * 1.2;
        const x = a[0] + dx * tt + nx * jitter, z = a[1] + dz * tt + nz * jitter;
        const sx = 0.7 + hash01(i, i * 2) * 2.0, sz = sx * (0.6 + hash01(i, i * 3) * 0.6);
        e.set(0, hash01(i, i * 4) * Math.PI, 0); qq.setFromEuler(e);
        p.set(x, 0.155, z); s.set(sx, 1, sz); m.compose(p, qq, s);
        puddles.setMatrixAt(i, m);
      }
      puddles.instanceMatrix.needsUpdate = true;
      puddles.matrixAutoUpdate = false; puddles.updateMatrix();
      scene.add(puddles); ownedInstanced.push(puddles);
    }

    // ─────────────── STREET LIFE — Hanoi items along the roads ────────────
    scatterItems(roadList, buildList, lakeCx, lakeCz, lakeNorthZ, lakeR);

    // ───────────────────── TREES — REAL OSM positions ────────────────────
    // Use the real tree coordinates VERBATIM so the greenery sits exactly where it
    // does in Hoan Kiem (the lakeside rows, the boulevard lines, the courtyard trees)
    // — placed the same data-driven way as the buildings and roads. The realistic
    // alpha-card trees are a single InstancedMesh pair, so the whole ~832-tree set is
    // cheap; only the LOW tier trims to the nearest-to-lake for the GPU budget.
    let treeList = (data && data.trees) ? data.trees : [];
    const treeCap = q.tier === 'low' ? 450 : Infinity;   // hi/mid: every real tree
    if (treeList.length > treeCap) {
      treeList = treeList
        .map((t) => ({ t, d: (t[0] - lakeCx) ** 2 + (t[1] - lakeCz) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, treeCap)
        .map((e) => e.t);
    }
    if (treeList.length) {
      // Realistic MULTI-SPECIES trees (broadleaf, slender, flowering, palm) — each
      // species owns its foliage texture/material (freed in dispose()).
      buildRealisticTrees(treeList, q.tier === 'high');
    }

    // ──────────────────────── LANDMARKS at the lake ──────────────────────
    // Scale the landmark cluster to the real lake. Turtle Tower at the lake
    // centroid; the red bridge + Ngoc Son temple toward the north shore.
    buildTurtleTower(lakeCx, lakeCz);
    buildBridgeAndTemple(lakeCx, lakeCz, lakeNorthZ);
    buildHoanKiemMonuments(lakeCx, lakeCz, lakeNorthZ, lakeR);
    buildPublicLandmarks(lakeCx, lakeCz, lakeNorthZ, lakeR);

    // ───────────────── SHOPS — on real buildings fronting the north shore ──
    // Pick the buildings closest to the lake's north water edge and attach the
    // floating enter-marker + interactable to each (like world.ts).
    placeShopsNearNorthShore(buildList, lakeCx, lakeNorthZ);

    // Street wayfinding: blue "PHỐ …" name plates, "NGÕ" alley signs, a
    // directional fingerpost, and a few brand signboards along the lakeside.
    buildStreetSignage(roadList, lakeCx, lakeCz, lakeNorthZ, lakeR);

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

    // Canonical, sittable benches (multiplayer seat slots) — tier-independent so
    // every client agrees on positions + seat ids. Placed along the real lake
    // shore (lakePoly) so they hug the promenade instead of a naive circle.
    buildSeating(lakeCx, lakeCz, lakeR, lakePoly);

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

    // ─────────────── Lake ambience: mist + willows + koi + fireflies ──────
    // `lakePoly` lets the weeping willows trace the real shore; `circles` receives
    // their trunk collision (added before buildGrid() below).
    ambience.build({ scene, lakeCx, lakeCz, lakeR, lakeNorthZ, lakePoly, circles });

    // ───────────────────────────── Player ────────────────────────────────
    // Spawn on a road by the lake's north shore, facing the lake/Turtle Tower.
    // Ready Player Me rigged GLB when an avatar URL is configured/known, else the
    // procedural avatar (graceful, no 404 noise). The factory streams the GLB in and
    // falls back to procedural on any load error so the player is never invisible.
    const DEFAULT_RPM_URL = opts.playerAvatarUrl || (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_RPM_AVATAR_URL) || '';
    player = createAvatar({ url: DEFAULT_RPM_URL, hue: playerHue, style: opts.playerStyle, age: opts.playerAge });
    // Restore the last saved world position if we have one (works for both
    // signed-in players and guests who walked around / cleared a gate). Falls
    // back to a sensible spawn when there's nothing saved yet.
    const sp = opts.startPos;
    const hasSaved = sp && isFinite(sp.x) && isFinite(sp.z);
    if (hasSaved) {
      SPAWN = new THREE.Vector3(sp.x, 0, sp.z);
      // Inside the city → face the lake; still outside → face the gate/centre.
      spawnYaw = entered
        ? Math.atan2(lakeCx - SPAWN.x, lakeCz - SPAWN.z)
        : Math.atan2(0 - SPAWN.x, 0 - SPAWN.z);
    } else if (entered) {
      // Signed in, nothing saved: spawn on a road by the lake's north shore.
      const spawnRoad = findNorthShoreSpawn(roadList, lakeCx, lakeNorthZ);
      SPAWN = new THREE.Vector3(spawnRoad.x, 0, spawnRoad.z);
      spawnYaw = Math.atan2(lakeCx - SPAWN.x, lakeCz - SPAWN.z); // face lake centre
    } else {
      // Guest, nothing saved: stand just OUTSIDE the North gate, facing in.
      SPAWN = new THREE.Vector3(0, 0, -(fenceR + 16));
      spawnYaw = Math.atan2(0 - SPAWN.x, 0 - SPAWN.z);          // face the gate / centre
    }
    player.group.position.copy(SPAWN);
    player.group.rotation.y = spawnYaw;
    scene.add(player.group);
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
    if (SHOW_CITY_NPCS && q.tier !== 'low') {
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
  const shopDoors = [];    // { x, z, leaves, openT } — entrance doors that auto-open on approach
  const landmarks = [];    // { ranges, openT, leaves, glowMats, lights, signOpen, signClosed, clock } — real-time public buildings
  let landmarkSites = [];  // reserved enterable-landmark footprints (computed once the lake is known)
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
    const s = String(text == null ? '' : text);
    const label = s.length > 18 ? s.slice(0, 17) + '…' : s;
    // Small, clean label: a soft rounded pill sized to the text, a tiny accent
    // dot (keeps NPC role colour-coding) and a compact name. No harsh box/bar.
    const fontPx = 22, dotR = 4, gap = 9, padX = 15, padY = 7;
    cx.font = `600 ${fontPx}px system-ui, sans-serif`;
    cx.textBaseline = 'middle';
    const cyc = cv.height / 2;
    const tw = Math.min(cv.width - 64, cx.measureText(label).width);
    const bw = dotR * 2 + gap + tw + padX * 2, bh = fontPx + padY * 2;
    const bx = (cv.width - bw) / 2, by = cyc - bh / 2;
    cx.shadowColor = 'rgba(0,0,0,0.32)'; cx.shadowBlur = 5; cx.shadowOffsetY = 2;
    cx.fillStyle = 'rgba(12,24,30,0.60)';
    roundRectPath(cx, bx, by, bw, bh, bh / 2); cx.fill();
    cx.shadowColor = 'transparent'; cx.shadowBlur = 0; cx.shadowOffsetY = 0;
    const dotX = bx + padX + dotR;
    cx.fillStyle = accent || 'rgba(21,214,180,0.95)';
    cx.beginPath(); cx.arc(dotX, cyc, dotR, 0, Math.PI * 2); cx.fill();
    cx.fillStyle = '#eafcf8'; cx.textAlign = 'left';
    cx.fillText(label, dotX + dotR + gap, cyc + 1);
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
    nameTag.scale.set(2.3, 0.575, 1);
    nameTag.position.set(0, 2.2, 0);
    nameTag.material.depthTest = false; nameTag.renderOrder = 12;
    player.group.add(nameTag);
  }

  // ── Sit pose (shared by local + remote avatars) ──────────────────────────
  // POSE only — thighs rotate forward at the hip, arms rest, torso upright. The
  // seat-height LIFT is applied by the caller (local via the targetY follow,
  // remote via the position lerp) so it isn't snapped here.
  function applySitPose(parts, _group, on) {
    if (on) {
      parts.legL.rotation.x = -Math.PI / 2; parts.legR.rotation.x = -Math.PI / 2;
      parts.armL.rotation.x = -0.5; parts.armR.rotation.x = -0.5;
      parts.torso.position.y = 1.0;
    } else {
      parts.legL.rotation.x = 0; parts.legR.rotation.x = 0;
      parts.armL.rotation.x = 0; parts.armR.rotation.x = 0;
      parts.torso.position.y = 1.05;
    }
  }

  // ── Remote players ───────────────────────────────────────────────────────
  function makeRemote(state) {
    const av = createAvatar({ url: state.avatarUrl || '', hue: state.hue, style: state.style, age: state.age });
    av.group.position.set(state.x, 0, state.z);
    av.group.rotation.y = state.rotY || 0;
    scene.add(av.group);
    const tag = state.name ? makeTag(state.name, 'rgba(120,180,255,0.97)') : null;
    if (tag) { tag.scale.set(2.3, 0.575, 1); tag.position.set(0, 2.2, 0); tag.material.depthTest = false; tag.renderOrder = 12; av.group.add(tag); }
    const r = {
      av, group: av.group, parts: av.parts, tag,
      tx: state.x, tz: state.z, tRotY: state.rotY || 0,
      anim: state.anim || 'idle', seatId: state.seatId || null,
      phase: Math.random() * 6.28, last: performance.now(),
    };
    remotePlayers.set(state.id, r);
    return r;
  }
  function disposeRemote(id) {
    const r = remotePlayers.get(id); if (!r) return;
    removeBubble(id);
    scene.remove(r.group);
    r.group.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.geometry && o.geometry.dispose && o.geometry.dispose(); } });
    if (r.av && r.av.mats) for (const k in r.av.mats) { const m = r.av.mats[k]; m && m.dispose && m.dispose(); }
    r.av && r.av.dispose && r.av.dispose();   // GLB remotes: stop mixer + free materials
    remotePlayers.delete(id);
  }
  // Apply a fresh world snapshot: upsert every remote, retarget transforms.
  function applySnapshot(states) {
    if (!Array.isArray(states)) return;
    const now = performance.now();
    occupiedRemote = occupiedSeats(states, SELF_ID || '');
    for (const s of states) {
      if (!s || typeof s.id !== 'string') continue;
      if (SELF_ID && s.id === SELF_ID) continue;   // never render ourselves
      let r = remotePlayers.get(s.id);
      if (!r) r = makeRemote(s);
      r.tx = s.x; r.tz = s.z; r.tRotY = s.rotY || 0;
      r.anim = s.anim || 'idle'; r.seatId = s.seatId || null;
      r.last = now;
      // Chat arrives THROUGH the snapshot: show a bubble when this player's
      // message is new and still fresh (skip stale ones a late joiner sees).
      if (s.msg && s.msgAt && s.msgAt !== r.lastMsgAt && Date.now() - s.msgAt < BUBBLE_MS) {
        r.lastMsgAt = s.msgAt;
        say(s.id, s.msg);
      }
    }
  }
  function playerLeft(id) { disposeRemote(id); }
  // Per-frame: interpolate remote avatars toward their targets + pose them.
  function updateRemotes(dt, t) {
    const now = performance.now();
    for (const [id, r] of remotePlayers) {
      if (now - r.last > 5000) { disposeRemote(id); continue; }   // stale → drop
      let gx = r.tx, gz = r.tz, gy = 0, gRotY = r.tRotY;
      const seated = !!r.seatId && seatById.has(r.seatId);
      if (seated) { const st = seatById.get(r.seatId); gx = st.x; gz = st.z; gy = SEAT_Y; gRotY = st.rotY; }
      const g = r.group;
      g.position.x += (gx - g.position.x) * Math.min(1, dt * 10);
      g.position.z += (gz - g.position.z) * Math.min(1, dt * 10);
      g.position.y += (gy - g.position.y) * Math.min(1, dt * 10);
      let dy = ((gRotY - g.rotation.y + Math.PI) % (Math.PI * 2)) - Math.PI;
      g.rotation.y += dy * Math.min(1, dt * 10);
      const rp = r.av.parts;   // live getter — GLB→procedural fallback swaps parts under us
      if (seated) { applySitPose(rp, g, true); }
      else {
        applySitPose(rp, g, false);
        const mv = r.anim === 'walk';
        r.phase += dt * (mv ? 10 : 0);
        const sw = mv ? 0.6 : 0;
        const ez = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 12);
        ez(rp.legL, Math.sin(r.phase) * sw); ez(rp.legR, -Math.sin(r.phase) * sw);
        ez(rp.armL, -Math.sin(r.phase) * sw * 0.7); ez(rp.armR, Math.sin(r.phase) * sw * 0.7);
      }
      // Face life (blink / idle look) for remote avatars too.
      r.av.update && r.av.update(dt, { moving: !seated && r.anim === 'walk', sitting: seated });
      if (r.tag) r.tag.quaternion.copy(camera.quaternion);
    }
  }

  // ── Chat bubbles ─────────────────────────────────────────────────────────
  // A speech bubble drawn to a canvas sprite (sprites auto-billboard). Word-wraps
  // to ≤2 lines; overflow truncated with an ellipsis.
  // Word-wrap to fit `maxW`, breaking over-long unbroken tokens (e.g. a pasted
  // URL) mid-word so nothing ever spills past the bubble edge.
  function wrapBubbleLines(cx, text, maxW) {
    const tokens = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = []; let line = '';
    for (let t of tokens) {
      while (cx.measureText(t).width > maxW) {           // hard-break a too-long token
        let fit = 1;
        while (fit < t.length && cx.measureText(t.slice(0, fit + 1)).width <= maxW) fit++;
        if (line) { lines.push(line); line = ''; }
        lines.push(t.slice(0, fit)); t = t.slice(fit);
      }
      const test = line ? line + ' ' + t : t;
      if (cx.measureText(test).width > maxW && line) { lines.push(line); line = t; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function makeBubble(text) {
    const fontPx = 26, maxTextW = 300, padX = 22, padY = 13, lineH = 32, tailH = 16, tailW = 22, MAX_LINES = 24;
    const font = `600 ${fontPx}px system-ui, sans-serif`;
    // Measure + wrap on a throwaway context, THEN size the real canvas to fit.
    const m = document.createElement('canvas').getContext('2d'); m.font = font;
    let lines = wrapBubbleLines(m, text, maxTextW);
    if (lines.length > MAX_LINES) {                       // cap absurdly long messages
      lines = lines.slice(0, MAX_LINES);
      let last = lines[MAX_LINES - 1];
      while (last.length > 1 && m.measureText(last + '…').width > maxTextW) last = last.slice(0, -1);
      lines[MAX_LINES - 1] = last + '…';
    }
    const tw = Math.min(maxTextW, Math.max(1, ...lines.map((l) => m.measureText(l).width)));
    const bw = Math.ceil(tw) + padX * 2, bh = lines.length * lineH + padY * 2;
    const cv = document.createElement('canvas');
    cv.width = bw + 24;                                    // margin for the soft shadow
    cv.height = bh + tailH + 16;
    const cx = cv.getContext('2d');
    cx.font = font; cx.textBaseline = 'middle';
    const bx = (cv.width - bw) / 2, by = cv.height - tailH - bh - 8;
    const tcx = cv.width / 2;
    // Soft drop shadow under the whole bubble (body + tail share it).
    cx.shadowColor = 'rgba(8,20,26,0.30)'; cx.shadowBlur = 12; cx.shadowOffsetY = 4;
    cx.fillStyle = 'rgba(250,253,254,0.98)';
    roundRectPath(cx, bx, by, bw, bh, 18); cx.fill();
    cx.beginPath();                                   // little speech tail, pointing down
    cx.moveTo(tcx - tailW / 2, by + bh - 2);
    cx.lineTo(tcx, by + bh + tailH);
    cx.lineTo(tcx + tailW / 2, by + bh - 2);
    cx.closePath(); cx.fill();
    cx.shadowColor = 'transparent'; cx.shadowBlur = 0; cx.shadowOffsetY = 0;
    cx.lineWidth = 2; cx.strokeStyle = 'rgba(21,48,58,0.10)';   // hairline for definition
    roundRectPath(cx, bx, by, bw, bh, 18); cx.stroke();
    cx.fillStyle = '#16323d'; cx.textAlign = 'center';
    lines.forEach((l, i) => cx.fillText(l, tcx, by + padY + lineH * (i + 0.5)));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = q.anisotropy || 1;
    ownedTextures.push(tex);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    localMats.push(mat);
    const spr = new THREE.Sprite(mat);
    // 1 world unit = 100 canvas px, so glyph size stays constant no matter how
    // wide/tall the bubble grew (short messages → small, long ones → taller).
    spr.scale.set(cv.width / 100, cv.height / 100, 1);
    spr.center.set(0.5, 0);    // anchor at the tail tip so it points to the head
    spr.renderOrder = 14;
    return spr;
  }
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  // Attach/replace a chat bubble above the target avatar (local or remote).
  function say(id, text) {
    if (!text) return;
    const targetGroup = (SELF_ID && id === SELF_ID)
      ? (player && player.group)
      : (remotePlayers.get(id) && remotePlayers.get(id).group);
    if (!targetGroup) return;
    const prev = bubbles.get(id);
    if (prev) { prev.group.remove(prev.sprite); }
    const sprite = makeBubble(text);
    sprite.position.set(0, 2.5, 0);
    targetGroup.add(sprite);
    bubbles.set(id, { sprite, group: targetGroup, until: performance.now() + BUBBLE_MS });
  }
  function removeBubble(id) {
    const b = bubbles.get(id); if (!b) return;
    b.group.remove(b.sprite);
    if (b.sprite.material && b.sprite.material.map) b.sprite.material.map.dispose();
    if (b.sprite.material) b.sprite.material.dispose();
    bubbles.delete(id);
  }
  // Per-frame: fade each bubble in its final ~0.8s, then remove.
  function updateBubbles() {
    const now = performance.now();
    for (const [id, b] of bubbles) {
      const left = b.until - now;
      if (left <= 0) { removeBubble(id); continue; }
      b.sprite.material.opacity = left < 800 ? Math.max(0, left / 800) : 1;
    }
  }

  // ── Seating (local player) ───────────────────────────────────────────────
  // Build the canonical sittable benches from the (shared) lake geometry, render
  // them with collision, and register every seat anchor.
  function buildSeating(lakeCx, lakeCz, lakeR, poly) {
    socialBenches = buildSocialBenches(lakeCx, lakeCz, lakeR, poly);
    // Per-type materials (tracked for disposal). Seat surfaces sit at ~SEAT_Y so
    // the seated avatar (lifted to SEAT_Y) rests on them. Seat LENGTH runs along
    // local X (the slot axis benchSlots lays out), the sitter faces local +Z.
    const matStone = new THREE.MeshStandardMaterial({ color: hsl(210, 0.04, 0.62), roughness: 0.95 });
    const matWood = new THREE.MeshStandardMaterial({ color: hsl(28, 0.5, 0.42), roughness: 0.8 });
    const matWoodLeg = new THREE.MeshStandardMaterial({ color: hsl(210, 0.05, 0.26), roughness: 0.5, metalness: 0.55 });
    const matModern = new THREE.MeshStandardMaterial({ color: hsl(174, 0.4, 0.5), roughness: 0.5, metalness: 0.2 });
    localMats.push(matStone, matWood, matWoodLeg, matModern);

    function stoneBench(len) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.52), matStone);
      seat.position.y = 0.44; seat.castShadow = true; seat.receiveShadow = true; g.add(seat);
      [-len / 2 + 0.28, len / 2 - 0.28].forEach((sx) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.46), matStone);
        leg.position.set(sx, 0.22, 0); leg.castShadow = true; g.add(leg);
      });
      return g;
    }
    function woodBench(len) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.46), matWood);
      seat.position.y = 0.44; seat.castShadow = true; seat.receiveShadow = true; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42, 0.06), matWood);
      back.position.set(0, 0.68, -0.2); back.castShadow = true; g.add(back);   // backrest behind sitter
      [-len / 2 + 0.18, len / 2 - 0.18].forEach((sx) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.42), matWoodLeg);
        leg.position.set(sx, 0.22, 0); g.add(leg);
      });
      return g;
    }
    function modernBench(len) {
      const g = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.6), matModern);
      seat.position.y = 0.46; seat.castShadow = true; seat.receiveShadow = true; g.add(seat);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len * 0.7, 0.42, 0.34), matModern);
      base.position.y = 0.21; g.add(base);
      return g;
    }
    const builders = { stone: stoneBench, wood: woodBench, modern: modernBench };

    for (const b of socialBenches) {
      const g = (builders[b.type] || stoneBench)(b.len);
      g.position.set(b.x, 0, b.z); g.rotation.y = b.rotY;
      g.matrixAutoUpdate = false; g.updateMatrix();
      scene.add(g); itemGroups.push(g);
      // Collision sized to the bench length so you can't walk through it.
      circles.push({ x: b.x, z: b.z, r: Math.max(0.9, (b.len / 2) * 0.7) });
      for (const s of benchSlots(b)) seatById.set(s.seatId, { x: s.x, z: s.z, rotY: s.rotY });
    }
  }
  // Nearest free seat (not held by another player, not our own) within reach.
  function findNearestFreeSeat(px, pz) {
    let best = null, bestD = SIT_REACH;
    for (const [seatId, st] of seatById) {
      if (occupiedRemote.has(seatId)) continue;
      const d = Math.hypot(px - st.x, pz - st.z);
      if (d < bestD) { bestD = d; best = seatId; }
    }
    return best;
  }
  // Sit OPTIMISTICALLY: snap onto the seat immediately (so sitting never waits on
  // — or breaks because of — a socket round-trip), then ask the server to confirm.
  // If the server denies it (another player got there first), we stand back up.
  function sitAt(seatId) {
    const st = seatById.get(seatId); if (!st || !player) return;
    localSeatId = seatId; sitting = true;
    player.group.position.x = st.x; player.group.position.z = st.z;
    player.group.rotation.y = st.rotY;
  }
  function requestSit() {
    if (sitting || !player) return;
    const seatId = findNearestFreeSeat(player.group.position.x, player.group.position.z);
    if (!seatId) return;
    pendingSeatId = seatId;
    sitAt(seatId);                       // optimistic — sit right now
    if (opts.claimSeat) opts.claimSeat(seatId);   // server reconciles (may deny)
  }
  function requestStand() {
    if (!sitting) return;
    sitting = false; localSeatId = null; pendingSeatId = null;
    applySitPose(player.parts, player.group, false);
    if (opts.releaseSeat) opts.releaseSeat();
  }
  function seatGranted(seatId) {
    // We already sat optimistically; just confirm (snap again in case we drifted).
    if (seatId === pendingSeatId) { pendingSeatId = null; sitAt(seatId); }
  }
  function seatDenied(seatId) {
    if (seatId === pendingSeatId) pendingSeatId = null;
    // The seat we optimistically took is actually held by someone else → stand.
    if (localSeatId === seatId && sitting) {
      sitting = false; localSeatId = null;
      applySitPose(player.parts, player.group, false);
    }
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
      {
        const inwardYaw = Math.atan2(Math.sin(g.a), -Math.cos(g.a)); // local +x → map centre
        rec.leaves = [];
        rec.openT = 0; rec.openTarget = 0;
        for (const sgn of [-1, 1]) {
          const hinge = new THREE.Group();
          hinge.position.set(cxg + tx * sgn * halfGapM, 0, czg + tz * sgn * halfGapM); // at the pillar
          const closedYaw = Math.atan2(sgn * tz, -sgn * tx);
          hinge.rotation.y = closedYaw;
          const panel = new THREE.Mesh(new THREE.BoxGeometry(halfGapM * 0.94, 3.1, 0.18), darkWood);
          panel.position.set(halfGapM / 2, 1.65, 0); panel.castShadow = true; panel.receiveShadow = true;
          hinge.add(panel); ownedGeoms.push(panel.geometry);
          for (const by of [0.9, 2.4]) {       // two iron braces (accent)
            const brace = new THREE.Mesh(new THREE.BoxGeometry(halfGapM * 0.92, 0.16, 0.22), redPaint);
            brace.position.set(halfGapM / 2, by, 0); hinge.add(brace); ownedGeoms.push(brace.geometry);
          }
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 6, 12), pillarMat);
          ring.position.set(halfGapM * 0.9, 1.6, 0.12); ring.rotation.x = Math.PI / 2; hinge.add(ring); ownedGeoms.push(ring.geometry);
          scene.add(hinge);
          const d = inwardYaw - closedYaw;
          rec.leaves.push({ grp: hinge, closedYaw, delta: Math.atan2(Math.sin(d), Math.cos(d)) });
        }
        if (gated) {
          const barLen = halfGapM * 2;
          const steps = Math.max(4, Math.round(barLen / 2));
          for (let s2 = 0; s2 <= steps; s2++) {
            const tt2 = s2 / steps - 0.5;
            circles.push({ x: cxg + tx * tt2 * barLen, z: czg + tz * tt2 * barLen, r: 1.5, gate: g.key });
          }
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

  // ── Real-time "open to the public" helpers (shared by the landmarks below) ──
  // Is the current Hanoi hour within any [start,end) range?
  function isOpenNow(ranges) {
    const hr = hanoiHour();
    return ranges.some(([a, b]) => hr >= a && hr < b);
  }
  // Warm window-glow material — emissiveIntensity is driven 0→base by the open state.
  function glowMat(hue, baseEmissive) {
    const m = new THREE.MeshStandardMaterial({
      color: hsl(hue, 0.5, 0.66), emissive: new THREE.Color(hsl(hue, 0.75, 0.6)),
      emissiveIntensity: 0, roughness: 0.5, metalness: 0,
    });
    m.userData.baseEmissive = baseEmissive != null ? baseEmissive : 1.2;
    localMats.push(m);
    return m;
  }
  // "MỞ CỬA" (green) / "ĐÓNG CỬA" (red) status boards, added to `parent` at a local
  // offset. Toggled by the frame loop. Returns { signOpen, signClosed }.
  function statusSigns(parent, lx, ly, lz) {
    const so = mats.makeSign('MỞ CỬA', { width: 2.0, bg: '#1c7d3e' });
    const sc = mats.makeSign('ĐÓNG CỬA', { width: 2.0, bg: '#b62a1e' });
    [so, sc].forEach((s) => { s.position.set(lx, ly, lz); parent.add(s); });
    return { signOpen: so, signClosed: sc };
  }
  // Brass door furniture (handles / panel trim), shared.
  const doorBrass = new THREE.MeshStandardMaterial({ color: hsl(45, 0.5, 0.5), roughness: 0.4, metalness: 0.7 });
  localMats.push(doorBrass);
  // Two hinged leaves filling an opening width `w`/height `h`, centred at local
  // (cx,0,cz) on a +z-facing wall of `parent`. Leaves swing outward to +z when
  // open. Each leaf gets recessed panels + a brass handle for a real door read.
  function addDoubleDoor(parent, cx, cz, w, h, leafMat) {
    const half = w / 2, leafW = half - 0.04, hY = h / 2;
    const out = [];
    for (const sgn of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(cx + sgn * half, 0, cz);
      const lcx = -sgn * leafW / 2;                        // leaf centre (extends to mid)
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, h, 0.1), leafMat);
      leaf.position.set(lcx, hY, 0); leaf.castShadow = true; hinge.add(leaf); ownedGeoms.push(leaf.geometry);
      for (const py of [h * 0.3, h * 0.66]) {              // two recessed panels per leaf
        const trim = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.66, h * 0.26, 0.04), doorBrass);
        trim.position.set(lcx, py, 0.06); hinge.add(trim); ownedGeoms.push(trim.geometry);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(leafW * 0.56, h * 0.2, 0.05), leafMat);
        panel.position.set(lcx, py, 0.08); hinge.add(panel); ownedGeoms.push(panel.geometry);
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), doorBrass);
      handle.position.set(-sgn * (leafW - 0.16), hY, 0.13); hinge.add(handle); ownedGeoms.push(handle.geometry);
      parent.add(hinge);
      out.push({ grp: hinge, openYaw: sgn * Math.PI / 2 });   // left −90°, right +90°
    }
    return out;
  }
  // Register a landmark handle: snap it to the CURRENT open state (so the world
  // loads correctly), then the frame loop animates transitions.
  function registerLandmark(h) {
    h.openT = isOpenNow(h.ranges) ? 1 : 0;
    for (const lf of h.leaves || []) lf.grp.rotation.y = lf.openYaw * h.openT;
    for (const gm of h.glowMats || []) gm.emissiveIntensity = h.openT * gm.userData.baseEmissive;
    for (const li of h.lights || []) li.intensity = h.openT * li.userData.baseInt;
    if (h.signOpen) h.signOpen.visible = h.openT > 0.5;
    if (h.signClosed) h.signClosed.visible = h.openT <= 0.5;
    landmarks.push(h);
  }

  // ── Iconic Hanoi public buildings that open/close with real Hanoi time ──────
  // Higher-detail than the stone monuments; placed on the promenade ring facing
  // the lake (avoids the OSM footprints inland). Visual open state only.
  function buildPublicLandmarks() {
    if (!landmarkSites.length) return;
    const withLight = q.tier !== 'low';
    // Palette.
    const granite = new THREE.MeshStandardMaterial({ color: hsl(40, 0.04, 0.6), roughness: 0.92, metalness: 0 });
    const white = new THREE.MeshStandardMaterial({ color: hsl(42, 0.06, 0.84), roughness: 0.85, metalness: 0 });
    const slate = new THREE.MeshStandardMaterial({ color: hsl(220, 0.05, 0.32), roughness: 0.8, metalness: 0.05 });
    const gilt = new THREE.MeshStandardMaterial({ color: hsl(45, 0.6, 0.55), roughness: 0.4, metalness: 0.7 });
    const carpet = new THREE.MeshStandardMaterial({ color: hsl(2, 0.5, 0.28), roughness: 0.95, metalness: 0 });
    const yellow = mats.plaster(46);
    const paleY = mats.plaster(42);
    localMats.push(granite, white, slate, gilt, carpet);

    const bx = (parent, mat, w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m);
      ownedGeoms.push(m.geometry); return m;
    };
    // Local→world for a yaw-only group.
    const wpt = (g, lx, lz) => {
      const a = g.rotation.y, s = Math.sin(a), c = Math.cos(a);
      return [g.position.x + lx * c + lz * s, g.position.z - lx * s + lz * c];
    };
    const wrect = (g, cx, cz, w, d) =>
      [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]].map(([lx, lz]) => wpt(g, lx, lz));
    // Accurate box collision for an interior prop (so the player can't walk through it).
    const solidBox = (g, cx, cz, w, d) => addBldgCollision(wrect(g, cx, cz, w, d));
    const site = (k) => landmarkSites.find((s) => s.key === k);

    // Generic ENTERABLE shell: solid walls (footprint-polygon collision) with a
    // door GAP, an OPEN TOP (so the third-person camera can look in), a floor, a
    // perimeter parapet, glowing windows, an interior light, a status sign, a
    // plaza, and time-gated doors whose collision blocks ONLY while shut (so you
    // can walk in during opening hours and are blocked otherwise).
    function enterableShell(S, o) {
      const { W, D, H } = S, halfW = W / 2, halfD = D / 2, tw = 0.5;
      const doorW = o.doorW || 3.0, doorH = o.doorH || 4.2;
      const g = new THREE.Group(); g.position.set(S.cx, 0, S.cz); g.rotation.y = S.yaw; scene.add(g);
      bx(g, o.floorMat, W, 0.12, D, 0, 0.0, 0);                                       // floor (flush)
      bx(g, o.wallMat, W, H, tw, 0, H / 2, -halfD + tw / 2);                          // back wall
      bx(g, o.wallMat, tw, H, D, -halfW + tw / 2, H / 2, 0);                          // left wall
      bx(g, o.wallMat, tw, H, D, halfW - tw / 2, H / 2, 0);                           // right wall
      const side = (W - doorW) / 2;
      bx(g, o.wallMat, side, H, tw, -(doorW / 2 + side / 2), H / 2, halfD - tw / 2);  // front-left
      bx(g, o.wallMat, side, H, tw, doorW / 2 + side / 2, H / 2, halfD - tw / 2);     // front-right
      bx(g, o.wallMat, doorW, H - doorH, tw, 0, doorH + (H - doorH) / 2, halfD - tw / 2); // header
      // Perimeter parapet rim (open top, so no roof to hide the camera).
      const rimMat = o.rimMat || o.wallMat;
      bx(g, rimMat, W + 0.4, 0.5, 0.5, 0, H + 0.25, -halfD + 0.25);
      bx(g, rimMat, W + 0.4, 0.5, 0.5, 0, H + 0.25, halfD - 0.25);
      bx(g, rimMat, 0.5, 0.5, D + 0.4, -halfW + 0.25, H + 0.25, 0);
      bx(g, rimMat, 0.5, 0.5, D + 0.4, halfW - 0.25, H + 0.25, 0);
      // Wall collision (footprint polygons).
      addBldgCollision(wrect(g, 0, -halfD + tw / 2, W, tw));
      addBldgCollision(wrect(g, -halfW + tw / 2, 0, tw, D));
      addBldgCollision(wrect(g, halfW - tw / 2, 0, tw, D));
      addBldgCollision(wrect(g, -(doorW / 2 + side / 2), halfD - tw / 2, side, tw));
      addBldgCollision(wrect(g, doorW / 2 + side / 2, halfD - tw / 2, side, tw));
      // Glowing windows on the side walls + an interior light.
      const gw = glowMat(o.glowHue, o.glowE || 1.3);
      const n = Math.max(2, Math.round((D - 3) / 3));
      for (let i = 0; i < n; i++) {
        const z = -halfD + 2.2 + (i * (D - 4.4)) / Math.max(1, n - 1);
        bx(g, gw, 0.06, 2.0, 1.1, -halfW + 0.34, 2.7, z);
        bx(g, gw, 0.06, 2.0, 1.1, halfW - 0.34, 2.7, z);
      }
      const lights = [];
      if (withLight) {
        const pl = new THREE.PointLight(0xffe6c0, 0, Math.max(W, D) * 1.7, 2.0);
        pl.position.set(0, H - 1.0, -halfD * 0.2); pl.userData.baseInt = 18; g.add(pl); lights.push(pl);
      }
      const leaves = addDoubleDoor(g, 0, halfD - 0.02, doorW, doorH, o.doorMat || darkWood);
      const sg = statusSigns(g, doorW / 2 + 1.5, 2.6, halfD + 0.25);
      const plaza = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.62, W * 0.62, 0.16, 28), mats.paving);
      plaza.position.set(0, 0.07, halfD + W * 0.26); plaza.receiveShadow = true; g.add(plaza); ownedGeoms.push(plaza.geometry);
      const handle = { ranges: o.ranges, leaves, glowMats: [gw], lights, signOpen: sg.signOpen, signClosed: sg.signClosed, clock: null };
      // Door-gap collision: blocks while shut, skipped once the doors are open.
      for (let i = -1; i <= 1; i++) {
        const p = wpt(g, i * (doorW / 2 - 0.45), halfD - tw / 2);
        circles.push({ x: p[0], z: p[1], r: 0.85, lm: handle });
      }
      return { g, handle, gw, halfW, halfD };
    }

    // 1) NHÀ THỜ LỚN — neo-Gothic cathedral, twin bell towers (open-top nave).
    (function cathedral() {
      const S = site('cathedral'); if (!S) return;
      const r = enterableShell(S, { wallMat: granite, floorMat: mats.paving, rimMat: granite, glowHue: 40, glowE: 1.6, doorMat: darkWood, doorW: 3.0, doorH: 4.4, ranges: [[8, 20]] });
      const { g, handle, gw, halfW, halfD } = r;
      // Rose window on the facade above the door.
      const rose = new THREE.Mesh(new THREE.CircleGeometry(1.3, 24), gw);
      rose.position.set(0, S.H - 1.5, halfD + 0.03); g.add(rose); ownedGeoms.push(rose.geometry);
      // Twin square bell towers flanking the facade.
      const towerH = S.H + 8, tw = 3.0;
      for (const sgn of [-1, 1]) {
        const tx = sgn * (halfW - tw / 2 + 0.3);
        bx(g, granite, tw, towerH, tw, tx, towerH / 2, halfD - tw / 2);
        bx(g, gw, tw * 0.5, 2.0, 0.12, tx, towerH - 3, halfD - tw / 2 + 0.26);   // belfry glow
        bx(g, granite, tw + 0.5, 0.5, tw + 0.5, tx, towerH + 0.25, halfD - tw / 2);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(tw * 0.6, 3.4, 4), slate);
        spire.position.set(tx, towerH + 2.0, halfD - tw / 2); spire.rotation.y = Math.PI / 4; spire.castShadow = true; g.add(spire); ownedGeoms.push(spire.geometry);
        bx(g, gilt, 0.12, 1.0, 0.12, tx, towerH + 4.1, halfD - tw / 2);          // cross (vertical)
        bx(g, gilt, 0.6, 0.12, 0.12, tx, towerH + 4.15, halfD - tw / 2);         // cross (arms)
      }
      // Interior: pews flanking a central aisle + an altar at the back (solid).
      const pewW = S.W * 0.3, pewX = S.W * 0.3;   // two banks, clear centre aisle
      for (let i = 0; i < 4; i++) {
        const z = -halfD + 3.2 + i * 2.2;
        for (const sgn of [-1, 1]) {
          bx(g, darkWood, pewW, 0.5, 0.5, sgn * pewX, 0.7, z);
          solidBox(g, sgn * pewX, z, pewW, 0.5);
        }
      }
      bx(g, white, 2.4, 1.0, 1.0, 0, 0.6, -halfD + 1.6); solidBox(g, 0, -halfD + 1.6, 2.4, 1.0);   // altar
      bx(g, gilt, 0.16, 1.4, 0.16, 0, 1.7, -halfD + 1.6);  // cross on altar
      registerLandmark(handle);
    })();

    // 2) NHÀ HÁT LỚN — Opera House: yellow body, Ionic portico, rear dome (open top).
    (function opera() {
      const S = site('opera'); if (!S) return;
      const r = enterableShell(S, { wallMat: yellow, floorMat: carpet, rimMat: white, glowHue: 45, glowE: 1.4, doorMat: darkWood, doorW: 3.4, doorH: 4.6, ranges: [[10.5, 12], [18, 22]] });
      const { g, handle, halfW, halfD } = r;
      // Rear dome on a drum (over the back wall, not the open play area).
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 1.6, 20), white);
      drum.position.set(0, S.H + 1.6, -halfD + 1.4); drum.castShadow = true; g.add(drum); ownedGeoms.push(drum.geometry);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), slate);
      dome.position.set(0, S.H + 2.4, -halfD + 1.4); dome.castShadow = true; g.add(dome); ownedGeoms.push(dome.geometry);
      const lantern = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 8), gilt);
      lantern.position.set(0, S.H + 5.2, -halfD + 1.4); g.add(lantern); ownedGeoms.push(lantern.geometry);
      // Portico in FRONT of the facade (lake side); columns avoid the doorway.
      const span = S.W * 0.86, colY = S.H * 0.74, pz = halfD + 1.7;
      for (const i of [-3, -2, -1, 1, 2, 3]) {
        const cx = (i * span) / 6;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, colY, 14), white);
        col.position.set(cx, colY / 2, pz); col.castShadow = true; g.add(col); ownedGeoms.push(col.geometry);
        bx(g, white, 1.0, 0.4, 0.6, cx, colY + 0.2, pz);   // capital
      }
      bx(g, white, span + 0.8, 0.9, 1.0, 0, colY + 0.8, pz);     // entablature
      const ped = new THREE.Mesh(new THREE.ConeGeometry(span / 2 + 0.4, 1.5, 3), white);
      ped.rotation.y = Math.PI / 2; ped.position.set(0, colY + 2.05, pz - 0.1); g.add(ped); ownedGeoms.push(ped.geometry);
      // Interior: seat banks flanking a central aisle + a stage at the back (solid).
      const seatW = S.W * 0.3, seatX = S.W * 0.28;
      for (let i = 0; i < 4; i++) {
        const z = -halfD + 3.4 + i * 1.7;
        for (const sgn of [-1, 1]) {
          bx(g, carpet, seatW, 0.5, 0.6, sgn * seatX, 0.7, z);
          solidBox(g, sgn * seatX, z, seatW, 0.6);
        }
      }
      bx(g, darkWood, S.W * 0.8, 1.2, 1.4, 0, 0.6, -halfD + 1.6); solidBox(g, 0, -halfD + 1.6, S.W * 0.8, 1.4);   // stage
      registerLandmark(handle);
    })();

    // 3) BƯU ĐIỆN BỜ HỒ — Post Office, live real-time clock tower (open top).
    (function postOffice() {
      const S = site('post'); if (!S) return;
      const r = enterableShell(S, { wallMat: paleY, floorMat: mats.paving, rimMat: redPaint, glowHue: 45, glowE: 1.3, doorMat: darkWood, doorW: 3.2, doorH: 4.0, ranges: [[7.5, 21]] });
      const { g, handle, halfD } = r;
      // Clock tower toward the facade (above the front wall, clear of the open top).
      const twW = 4.0, twH = 6, twBaseY = S.H + 0.4, twZ = halfD - 2;
      bx(g, paleY, twW, twH, twW, 0, twBaseY + twH / 2, twZ);
      const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(twW * 0.78, 2.4, 4), redPaint);
      towerRoof.rotation.y = Math.PI / 4; towerRoof.position.set(0, twBaseY + twH + 1.0, twZ); towerRoof.castShadow = true; g.add(towerRoof); ownedGeoms.push(towerRoof.geometry);
      const faceZ = twZ + twW / 2 + 0.06, faceY = twBaseY + twH * 0.55;
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.3, 28), white);
      face.position.set(0, faceY, faceZ); g.add(face); ownedGeoms.push(face.geometry);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.1, 8, 28), gilt);
      ring.position.set(0, faceY, faceZ); g.add(ring); ownedGeoms.push(ring.geometry);
      const mkHand = (len, wdt) => {
        const pivot = new THREE.Group(); pivot.position.set(0, faceY, faceZ + 0.04);
        const hand = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, 0.05), slate);
        hand.position.set(0, len / 2 - 0.1, 0); pivot.add(hand); ownedGeoms.push(hand.geometry);
        g.add(pivot); return pivot;
      };
      handle.clock = { hour: mkHand(0.75, 0.1), minute: mkHand(1.1, 0.07) };
      const nameSign = mats.makeSign('BƯU ĐIỆN HÀ NỘI', { width: 6.0, bg: '#143e6e' });
      nameSign.position.set(0, S.H - 0.8, halfD + 0.03); g.add(nameSign);
      // Interior: a service counter at the back + a waiting bench (both solid).
      bx(g, darkWood, S.W * 0.7, 1.1, 1.0, 0, 0.55, -halfD + 1.5); solidBox(g, 0, -halfD + 1.5, S.W * 0.7, 1.0);
      bx(g, mats.paving, S.W * 0.5, 0.45, 0.5, 0, 0.28, 1.2); solidBox(g, 0, 1.2, S.W * 0.5, 0.5);
      registerLandmark(handle);
    })();
  }

  // ── STREET SIGNAGE: blue "PHỐ …" name plates, "NGÕ" alley signs, a
  //    directional fingerpost to the landmarks, and a few brand signboards. ──
  function buildStreetSignage(roadList, lakeCx, lakeCz, northZ, lakeR) {
    if (!roadList || !roadList.length) return;
    const TIER = q.tier;
    // Canvas plate texture: white text + border on an enamel ground.
    function plateTex(main, sub, bg, W, H) {
      W = W || 560; H = H || 200;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const c = cv.getContext('2d');
      c.fillStyle = bg || '#0e5bb0'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#ffffff'; c.lineWidth = Math.round(H * 0.045); c.strokeRect(c.lineWidth, c.lineWidth, W - c.lineWidth * 2, H - c.lineWidth * 2);
      c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      let fs = Math.round(H * 0.4); c.font = `800 ${fs}px "Be Vietnam Pro", Arial, sans-serif`;
      while (c.measureText(main).width > W - H * 0.4 && fs > 22) { fs -= 3; c.font = `800 ${fs}px "Be Vietnam Pro", Arial, sans-serif`; }
      c.fillText(main, W / 2, sub ? H * 0.42 : H / 2);
      if (sub) { c.font = `600 ${Math.round(H * 0.16)}px "Be Vietnam Pro", Arial, sans-serif`; c.fillText(sub, W / 2, H * 0.76); }
      const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
      ownedTextures.push(tex); return tex;
    }
    function signMat(tex) {
      const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18, roughness: 0.5, metalness: 0.1 });
      localMats.push(m); return m;
    }
    // A two-sided plate on a pole; the group yaw aligns the front (+z) to the reader.
    function poleSign(x, z, ang, tex, pw, poleH, aspect) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ang; scene.add(g);
      const ph = pw * (aspect || 200 / 560), y = poleH - ph / 2 - 0.05;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, poleH, 8), mats.steelDark);
      pole.position.y = poleH / 2; pole.castShadow = true; g.add(pole); ownedGeoms.push(pole.geometry);
      const back = new THREE.Mesh(new THREE.BoxGeometry(pw + 0.06, ph + 0.06, 0.05), mats.steelDark);
      back.position.set(0, y, 0); g.add(back); ownedGeoms.push(back.geometry);
      const mat = signMat(tex);
      const f1 = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat); f1.position.set(0, y, 0.031); g.add(f1); ownedGeoms.push(f1.geometry);
      const f2 = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat); f2.position.set(0, y, -0.031); f2.rotation.y = Math.PI; g.add(f2); ownedGeoms.push(f2.geometry);
      circles.push({ x, z, r: 0.25 });
      return g;
    }
    const within = (x, z) => landmarkSites.some((s) => Math.hypot(x - s.cx, z - s.cz) < s.clearR + 2);
    const placed = [];
    const farEnough = (x, z, d) => !placed.some((p) => Math.hypot(p[0] - x, p[1] - z) < d);
    const lakeEnd = (a, b) => (Math.hypot(a[0] - lakeCx, a[1] - lakeCz) <= Math.hypot(b[0] - lakeCx, b[1] - lakeCz) ? a : b);

    // 1) Street-name plates at each lakeside street's REAL compass position.
    // Axes: N=−z, S=+z, E=+x, W=−x; angle a → offset (sin a, cos a)·R.
    const LAKE_STREETS = [
      [Math.PI / 2, 'ĐINH TIÊN HOÀNG'],     // E shore (statue + post office)
      [-Math.PI / 2, 'LÊ THÁI TỔ'],          // W shore
      [0, 'HÀNG KHAY'],                      // S edge
      [Math.PI, 'CẦU GỖ'],                   // N edge
      [Math.PI / 4, 'TRÀNG TIỀN'],           // SE → Opera House
      [3 * Math.PI / 4, 'LÒ SŨ'],            // NE
      [-3 * Math.PI / 4, 'LƯƠNG VĂN CAN'],   // NW
      [-Math.PI / 4, 'HÀNG BÀI'],            // SW
      [Math.PI * 0.86, 'HÀNG ĐÀO'],          // N → Old Quarter
    ];
    const capPho = TIER === 'low' ? 5 : TIER === 'mid' ? 7 : LAKE_STREETS.length;
    const Rstreet = lakeR + 4;
    for (let i = 0; i < capPho && i < LAKE_STREETS.length; i++) {
      const [a, name] = LAKE_STREETS[i];
      const x = lakeCx + Math.sin(a) * Rstreet, z = lakeCz + Math.cos(a) * Rstreet;
      const ang = Math.atan2(lakeCx - x, lakeCz - z);   // face the lakeside path
      poleSign(x, z, ang, plateTex('PHỐ ' + name, 'QUẬN HOÀN KIẾM'), 2.2, 2.9);
      placed.push([x, z]);
    }

    // 1b) Old-Quarter "Hàng …" plates on the wider roads NORTH of the lake (the
    //     real 36-streets district). Placed at each road's north end, capped.
    const HANG = ['Hàng Bạc', 'Hàng Gai', 'Hàng Bồ', 'Hàng Bông', 'Hàng Mã', 'Hàng Thiếc', 'Hàng Quạt', 'Hàng Buồm', 'Hàng Bè', 'Mã Mây', 'Tạ Hiện', 'Hàng Chiếu', 'Hàng Giấy', 'Hàng Nón', 'Hàng Vải', 'Lương Ngọc Quyến', 'Thuốc Bắc', 'Lò Rèn'];
    const capHang = TIER === 'low' ? 0 : TIER === 'mid' ? 8 : 16;
    const northRoads = roadList
      .filter((r) => r.w >= 2.5 && r.pts && r.pts.length >= 2)
      .map((r) => { const a = r.pts[0], b = r.pts[r.pts.length - 1]; const ex = a[1] < b[1] ? a : b; return { r, ex, far: ex === a ? b : a, d: Math.hypot((a[0] + b[0]) / 2 - lakeCx, (a[1] + b[1]) / 2 - lakeCz) }; })
      .filter((o) => o.ex[1] < northZ - 6 && o.d <= lakeR + 220)
      .sort((p, q2) => p.d - q2.d);
    let hi = 0;
    for (const o of northRoads) {
      if (hi >= capHang) break;
      const a = o.ex, b = o.far;
      if (!farEnough(a[0], a[1], 22) || within(a[0], a[1])) continue;
      let dx = b[0] - a[0], dz = b[1] - a[1]; const dn = Math.hypot(dx, dz) || 1; dx /= dn; dz /= dn;
      const off = o.r.w / 2 + 0.7;
      poleSign(a[0] - dz * off, a[1] + dx * off, Math.atan2(dx, dz), plateTex('PHỐ ' + HANG[hi % HANG.length].toUpperCase(), 'QUẬN HOÀN KIẾM'), 2.0, 2.8);
      placed.push([a[0], a[1]]); hi++;
    }

    // 2) "NGÕ" alley plates on the narrow roads nearest the lake.
    const capNgo = TIER === 'low' ? 3 : 6;
    const narrow = roadList
      .filter((r) => r.w > 0 && r.w < 2.3 && r.pts && r.pts.length >= 2)
      .map((r) => ({ r, a: r.pts[0], d: Math.hypot(r.pts[0][0] - lakeCx, r.pts[0][1] - lakeCz) }))
      .sort((p, q2) => p.d - q2.d);
    let ng = 0;
    for (const cnd of narrow) {
      if (ng >= capNgo) break;
      const a = cnd.a, b = cnd.r.pts[1];
      const dl = Math.hypot(a[0] - lakeCx, a[1] - lakeCz);
      if (dl < lakeR + 3 || dl > lakeR + 160 || !farEnough(a[0], a[1], 14) || within(a[0], a[1])) continue;
      let dx = b[0] - a[0], dz = b[1] - a[1]; const dn = Math.hypot(dx, dz) || 1; dx /= dn; dz /= dn;
      poleSign(a[0] - dz * 0.8, a[1] + dx * 0.8, Math.atan2(dx, dz), plateTex('NGÕ ' + (5 + ng * 4), null), 1.1, 2.4);
      placed.push(a); ng++;
    }

    // 3) Directional fingerpost near the north shore → the landmarks.
    (function fingerpost() {
      const px = lakeCx - 7, pz = northZ - 3;
      const g = new THREE.Group(); g.position.set(px, 0, pz); scene.add(g);
      const poleH = 3.4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, poleH, 10), mats.steelDark);
      pole.position.y = poleH / 2; pole.castShadow = true; g.add(pole); ownedGeoms.push(pole.geometry);
      const byKey = {}; for (const s of landmarkSites) byKey[s.key] = s;
      const targets = [['ĐỀN NGỌC SƠN', lakeCx, northZ + 16], ['HỒ HOÀN KIẾM', lakeCx, lakeCz]];
      if (byKey.cathedral) targets.push(['NHÀ THỜ LỚN', byKey.cathedral.cx, byKey.cathedral.cz]);
      if (byKey.opera) targets.push(['NHÀ HÁT LỚN', byKey.opera.cx, byKey.opera.cz]);
      if (byKey.post) targets.push(['BƯU ĐIỆN', byKey.post.cx, byKey.post.cz]);
      let by = poleH - 0.45;
      for (const [label, tx, tz] of targets) {
        const ang = Math.atan2(-(tz - pz), tx - px);                 // local +x → target
        const blade = new THREE.Group(); blade.position.set(0, by, 0); blade.rotation.y = ang; g.add(blade);
        const L = 2.6, h = 0.52, tex = plateTex(label, null, '#1c6b3a', 700, 150);
        const mat = signMat(tex);
        for (const sgn of [1, -1]) {
          const pl = new THREE.Mesh(new THREE.PlaneGeometry(L, h), mat);
          pl.position.set(L / 2, 0, sgn * 0.03); if (sgn < 0) pl.rotation.y = Math.PI; blade.add(pl); ownedGeoms.push(pl.geometry);
        }
        const tip = new THREE.Mesh(new THREE.ConeGeometry(h * 0.62, 0.5, 3), mat);
        tip.rotation.z = -Math.PI / 2; tip.position.set(L + 0.2, 0, 0); blade.add(tip); ownedGeoms.push(tip.geometry);
        by -= 0.6;
      }
      circles.push({ x: px, z: pz, r: 0.35 });
    })();

    // 4) Brand signboards at their real-ish lakeside spots (skipped if they'd
    //    collide with a landmark plot or another sign).
    const LAKE_BRANDS = [
      [-3 * Math.PI / 4, 'THỦY TẠ', '#1f6f8b', lakeR + 3],          // NW lakeside café/kem
      [Math.PI, 'HÀM CÁ MẬP', '#33414d', lakeR + 9],               // N — Đông Kinh Nghĩa Thục
      [3 * Math.PI / 4, 'HIGHLANDS COFFEE', '#7a1620', lakeR + 8],  // NE
      [Math.PI / 2 - 0.22, 'LỤC THỦY', '#2f5d3a', lakeR + 5],       // E lakeside
      [Math.PI / 2 + 0.22, 'NOTE COFFEE', '#caa12a', lakeR + 6],    // E/NE
      [0.32, 'KEM TRÀNG TIỀN', '#a01620', lakeR + 6],              // S → Tràng Tiền
      [Math.PI * 0.7, 'CỘNG CÀ PHÊ', '#2f5d3a', lakeR + 7],         // N
      [-0.45, 'LONG VÂN', '#9c7212', lakeR + 6],                    // S/SW lakeside
    ];
    const capBrand = TIER === 'low' ? 0 : TIER === 'mid' ? 5 : LAKE_BRANDS.length;
    let bi = 0;
    for (let i = 0; i < LAKE_BRANDS.length && bi < capBrand; i++) {
      const [a, name, col, R] = LAKE_BRANDS[i];
      const x = lakeCx + Math.sin(a) * R, z = lakeCz + Math.cos(a) * R;
      if (within(x, z) || !farEnough(x, z, 10)) continue;
      const ang = Math.atan2(lakeCx - x, lakeCz - z);
      poleSign(x, z, ang, plateTex(name, null, col, 640, 150), 2.6, 3.1, 150 / 640);
      placed.push([x, z]); bi++;
    }
  }

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
      // Hinged temple doors that swing open (toward the bridge, −Z) during hours.
      const tDoorLeaves = [];
      {
        const dw = 1.9, dh = 2.5, dhalf = dw / 2, leafW = dhalf - 0.04;
        for (const sgn of [-1, 1]) {
          const hinge = new THREE.Group();
          hinge.position.set(sgn * dhalf, 0, -bodyD / 2 - 0.02);
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, dh, 0.12), darkWood);
          leaf.position.set(-sgn * leafW / 2, dh / 2, 0); leaf.castShadow = true; hinge.add(leaf);
          ownedGeoms.push(leaf.geometry); t.add(hinge);
          tDoorLeaves.push({ grp: hinge, openYaw: -sgn * Math.PI / 2 });   // swing to −Z (toward bridge)
        }
      }
      const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.7, 0.1), redPaint);
      doorFrame.position.set(0, 1.35, -bodyD / 2 - 0.06); t.add(doorFrame);
      // Lantern-lit windows flanking the door (glow while open) + status sign + light.
      const tGlow = glowMat(38, 1.5);
      [-1, 1].forEach((sgn) => {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.1), tGlow);
        win.position.set(sgn * 2.0, 1.7, -bodyD / 2 - 0.01); t.add(win); ownedGeoms.push(win.geometry);
      });
      const tSg = statusSigns(t, 2.7, 2.7, -bodyD / 2 - 0.12);
      tSg.signOpen.rotation.y = Math.PI; tSg.signClosed.rotation.y = Math.PI;   // face the bridge (−Z)
      let tLights = [];
      if (q.tier !== 'low') {
        const pl = new THREE.PointLight(0xffe0b0, 0, 18, 2.0);
        pl.position.set(0, 2.4, 0); pl.userData.baseInt = 9; t.add(pl); tLights = [pl];
      }
      registerLandmark({ ranges: [[7, 18]], leaves: tDoorLeaves, glowMats: [tGlow], lights: tLights, signOpen: tSg.signOpen, signClosed: tSg.signClosed });
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
      // Solid temple body: accurate footprint-polygon collision (no walk-through),
      // leaving the island deck walkable. The body centre is world (ox, islandZ+1.5).
      const tcx = ox, tcz = islandZ + 1.5, hw = bodyW / 2, hd = bodyD / 2;
      addBldgCollision([[tcx - hw, tcz - hd], [tcx + hw, tcz - hd], [tcx + hw, tcz + hd], [tcx - hw, tcz + hd]]);
    })();
  }

  // THÁP BÚT + ĐÀI NGHIÊN + TƯỢNG ĐÀI LÝ THÁI TỔ — the iconic Hoan Kiem monuments.
  // Tháp Bút (the stone "writing-brush" tower on its rock mound) and Đài Nghiên (the
  // ink-slab gate) stand on the north shore at the temple entrance, before The Huc
  // bridge; the Ly Thai To monument sits in a plaza on the lake's east side.
  function buildHoanKiemMonuments(ox, oz, northZ, lakeR) {
    const bronze = new THREE.MeshStandardMaterial({ color: hsl(30, 0.32, 0.32), roughness: 0.55, metalness: 0.7 });
    const stonePale = new THREE.MeshStandardMaterial({ color: hsl(40, 0.10, 0.62), roughness: 0.9, metalness: 0 });
    localMats.push(bronze, stonePale);

    // ── THÁP BÚT — pen tower on a rock mound, just east of the temple axis ──
    (function thapBut() {
      const bx = ox - 9, bz = northZ - 15;
      const g = new THREE.Group(); g.position.set(bx, 0, bz); scene.add(g);
      // Rock mound (núi Độc Tôn).
      const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 3.2, 1.6, 10), mossStone);
      mound.position.y = 0.6; mound.castShadow = true; mound.receiveShadow = true; g.add(mound);
      // Tapering square stone shaft (4-sided frustum), in three diminishing drums.
      const drums = [{ rb: 1.05, rt: 0.9, h: 3.2, y: 1.4 }, { rb: 0.85, rt: 0.66, h: 3.0, y: 4.6 }, { rb: 0.62, rt: 0.42, h: 2.8, y: 7.6 }];
      drums.forEach((d) => {
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(d.rt, d.rb, d.h, 4), mossStone);
        shaft.rotation.y = Math.PI / 4; shaft.position.y = d.y + d.h / 2; shaft.castShadow = true; g.add(shaft);
      });
      // Brush-tip: a slim 4-sided cone pointing at the sky ("Tả Thanh Thiên").
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.4, 4), mossStone);
      tip.rotation.y = Math.PI / 4; tip.position.y = 10.4 + 1.2; tip.castShadow = true; g.add(tip);
      circles.push({ x: bx, z: bz, r: 2.6 });
    })();

    // ── ĐÀI NGHIÊN — ink-slab gate astride the path toward the bridge ──
    (function daiNghien() {
      const gx = ox, gz = northZ - 8;
      const g = new THREE.Group(); g.position.set(gx, 0, gz); scene.add(g);
      const gap = 4.4, pillarH = 3.4;
      [-1, 1].forEach((sd) => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.0, pillarH, 1.0), mossStone);
        pillar.position.set(sd * gap / 2, pillarH / 2, 0); pillar.castShadow = true; pillar.receiveShadow = true; g.add(pillar);
        circles.push({ x: gx + sd * gap / 2, z: gz, r: 0.8 });   // walk THROUGH the gap
      });
      // Lintel beam across the top.
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(gap + 1.6, 0.7, 1.2), mossStone);
      lintel.position.y = pillarH + 0.35; lintel.castShadow = true; g.add(lintel);
      // Ink-slab (nghiên): a shallow stone bowl resting on three little supports.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const sup = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), darkWood);
        sup.position.set(Math.cos(a) * 0.7, pillarH + 0.85, Math.sin(a) * 0.7); g.add(sup);
      }
      const slab = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mossStone);
      slab.scale.set(1, 0.45, 1); slab.position.y = pillarH + 1.0; slab.castShadow = true; g.add(slab);
    })();

    // ── TƯỢNG ĐÀI LÝ THÁI TỔ — bronze emperor on a stepped plinth, east plaza ──
    (function lyThaiTo() {
      const mx = ox + lakeR + 16, mz = oz + lakeR * 0.28;
      const g = new THREE.Group(); g.position.set(mx, 0, mz); scene.add(g);
      const faceLake = Math.atan2(ox - mx, oz - mz);   // statue faces the lake
      g.rotation.y = faceLake;
      // Raised stone plaza.
      const plaza = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.8, 0.4, 32), mats.paving);
      plaza.position.y = 0.2; plaza.receiveShadow = true; g.add(plaza);
      // Stepped plinth (three diminishing drums).
      const steps = [{ r: 3.0, h: 1.0, y: 0.4 }, { r: 2.2, h: 1.2, y: 1.4 }, { r: 1.6, h: 3.0, y: 2.6 }];
      steps.forEach((s) => {
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r + 0.25, s.h, 24), stonePale);
        drum.position.y = s.y + s.h / 2; drum.castShadow = true; drum.receiveShadow = true; g.add(drum);
      });
      const plinthTop = 5.6;
      // Bronze figure: robed body, head, a held edict tablet, arms suggested.
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 3.0, 14), bronze);
      robe.position.y = plinthTop + 1.5; robe.castShadow = true; g.add(robe);
      const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.8, 12), bronze);
      chest.position.y = plinthTop + 3.1; chest.castShadow = true; g.add(chest);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), bronze);
      head.position.y = plinthTop + 3.85; head.castShadow = true; g.add(head);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.4, 12), bronze);
      crown.position.y = plinthTop + 4.2; crown.castShadow = true; g.add(crown);
      // Tablet (chiếu dời đô) held at the waist.
      const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.14), bronze);
      tablet.position.set(0, plinthTop + 2.2, 0.6); tablet.rotation.x = -0.2; tablet.castShadow = true; g.add(tablet);
      circles.push({ x: mx, z: mz, r: 3.4 });
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
      // A real entrance door at the threshold, facing the approach (shore) side,
      // that swings open as the player nears — so an open shop looks open.
      buildShopDoor(ex, ez, dirX / dl, dirZ / dl);
    }
  }

  // Free-standing glazed entrance door (frame + two leaves) at a shop threshold.
  // `(nx,nz)` is the unit facing direction; leaves swing outward toward it.
  function buildShopDoor(ex, ez, nx, nz) {
    const g = new THREE.Group();
    g.position.set(ex, 0, ez);
    g.rotation.y = Math.atan2(nx, nz);          // local +z faces the approach side
    const openW = 2.4, doorH = 2.8, half = openW / 2;
    // Frame: jambs + lintel.
    for (const sgn of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.16, doorH, 0.22), mats.metalFrame);
      jamb.position.set(sgn * half, doorH / 2, 0); jamb.castShadow = true; g.add(jamb); ownedGeoms.push(jamb.geometry);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(openW + 0.32, 0.22, 0.24), mats.metalFrame);
    lintel.position.set(0, doorH + 0.11, 0); lintel.castShadow = true; g.add(lintel); ownedGeoms.push(lintel.geometry);
    // Two glass leaves hinged at the jambs (meet at centre when shut).
    const leafW = half - 0.06, leafH = doorH - 0.16, hY = leafH / 2 + 0.06;
    const leaves = [];
    for (const sgn of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(sgn * half, 0, 0);
      const cx = -sgn * leafW / 2;              // leaf extends toward the centre
      const frame = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.05), mats.metalFrame);
      frame.position.set(cx, hY, -0.03); frame.castShadow = true; hinge.add(frame); ownedGeoms.push(frame.geometry);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(leafW - 0.12, leafH - 0.12, 0.04), mats.glassDark);
      glass.position.set(cx, hY, 0.01); hinge.add(glass); ownedGeoms.push(glass.geometry);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), mats.steelDark);
      handle.position.set(-sgn * (leafW - 0.12), 1.1, 0.07); hinge.add(handle); ownedGeoms.push(handle.geometry);
      g.add(hinge);
      // Open swings the free end outward to +z (left → -90°, right → +90°).
      leaves.push({ grp: hinge, openYaw: sgn * Math.PI / 2 });
    }
    scene.add(g);
    shopDoors.push({ x: ex, z: ez, leaves, openT: 0 });
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
        // (Benches moved to the canonical sittable set — see buildSeating — so
        //  every client agrees on bench positions + seat slots for multiplayer.)
      }

      // ── Iconic Hoan Kiem RAILING: posts + a top rail just outside the water rim,
      //    sampled at a fixed spacing around the real polygon (1–2 draw calls). ──
      const railPts = [];
      const railOff = 1.4;
      for (let i = 0; i < n; i++) {
        const a = lakePoly[i], b = lakePoly[(i + 1) % n];
        const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d < segLen; d += 3.2) {
          const tt = d / segLen;
          const px = a[0] + (b[0] - a[0]) * tt, pz = a[1] + (b[1] - a[1]) * tt;
          const ux = px - lakeCx, uz = pz - lakeCz, ul = Math.hypot(ux, uz) || 1;
          railPts.push([px + (ux / ul) * railOff, pz + (uz / ul) * railOff]);
        }
      }
      if (railPts.length >= 2) {
        const railMat = new THREE.MeshStandardMaterial({ color: hsl(190, 0.12, 0.5), roughness: 0.7, metalness: 0.25 });
        localMats.push(railMat);
        const postGeo = new THREE.BoxGeometry(0.1, 0.85, 0.1);
        const railGeo = new THREE.BoxGeometry(1, 1, 1);
        ownedGeoms.push(postGeo, railGeo);
        const posts = new THREE.InstancedMesh(postGeo, railMat, railPts.length);
        const rails = new THREE.InstancedMesh(railGeo, railMat, railPts.length);
        posts.castShadow = false; rails.castShadow = false;
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), qx = new THREE.Quaternion(), sc = new THREE.Vector3();
        const xAxis = new THREE.Vector3(1, 0, 0), dir = new THREE.Vector3();
        const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < railPts.length; i++) {
          p.set(railPts[i][0], 0.42, railPts[i][1]); m.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
          posts.setMatrixAt(i, m);
          const nxt = railPts[(i + 1) % railPts.length];
          const dx = nxt[0] - railPts[i][0], dz = nxt[1] - railPts[i][1];
          const len = Math.hypot(dx, dz);
          if (len > 6 || len < 0.01) { rails.setMatrixAt(i, ZERO); continue; }  // skip the wrap-around gap
          dir.set(dx, 0, dz).normalize(); qx.setFromUnitVectors(xAxis, dir);
          p.set((railPts[i][0] + nxt[0]) / 2, 0.78, (railPts[i][1] + nxt[1]) / 2); sc.set(len, 0.06, 0.06);
          m.compose(p, qx, sc); rails.setMatrixAt(i, m);
        }
        posts.instanceMatrix.needsUpdate = true; rails.instanceMatrix.needsUpdate = true;
        posts.matrixAutoUpdate = false; posts.updateMatrix(); rails.matrixAutoUpdate = false; rails.updateMatrix();
        scene.add(posts); scene.add(rails); ownedInstanced.push(posts, rails);
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
  function scatterItems(roadList, buildList, lakeCx, lakeCz, lakeNorthZ, lakeR) {
    // Street food / cafés / vendors cluster AROUND the lake (the real Old-Quarter
    // shore), not spread evenly across the whole map.
    const lakeNearR = (lakeR || 110) + 150;
    const nearLake = (x, z) => Math.hypot(x - lakeCx, z - lakeCz) < lakeNearR;
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
          if (flagAcc >= 90) {
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
          if (hw >= 2 && hash01(px * 1.3 + 4.1, pz * 1.3 - 6.2) < 0.05 * dens) {
            const kside = hash01(px + 2.1, pz) < 0.5 ? 1 : -1;
            const kx = px + nx * (hw + 0.4) * kside, kz = pz + nz * (hw + 0.4) * kside;
            if (!pointInBuildings(kx, kz, 0.3) && spacingOk(kx, kz, 2.0)) { kumquatP.push({ x: kx, z: kz }); spaceAdd(kx, kz); }
          }
          // rare shoulder-pole VENDOR on a sidewalk, near the lake.
          if (hseed > 0.965 && hseed < 0.985 && nearLake(px, pz)) {
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
          if (bannerAcc >= 150) {
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
            if (hash01(px * 0.5 + 2.7, pz * 0.5 - 5.1) < 0.6 * dens && nearLake(px, pz)) {
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

    // ── STREET-LAMP GROUND GLOW — warm pools of light under each lamp at night. ──
    // The lamp heads are emissive but cast no real light (a PointLight per lamp is
    // too costly for hundreds of them). Instead lay a soft additive disc on the
    // pavement under each lamp; its opacity is ramped from the night factor in the
    // loop so the street reads as actually lit after dusk, dark by day. One
    // InstancedMesh → 1 draw call for the whole set.
    if (lampP.length) {
      const gc = document.createElement('canvas'); gc.width = gc.height = 64;
      const gx = gc.getContext('2d');
      const grd = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,224,168,1)');
      grd.addColorStop(0.45, 'rgba(255,210,140,0.5)');
      grd.addColorStop(1, 'rgba(255,200,120,0)');
      gx.fillStyle = grd; gx.fillRect(0, 0, 64, 64);
      const glowTex = new THREE.CanvasTexture(gc); glowTex.colorSpace = THREE.SRGBColorSpace; glowTex.needsUpdate = true;
      ownedTextures.push(glowTex);
      const glowGeo = new THREE.CircleGeometry(3.4, 16); glowGeo.rotateX(-Math.PI / 2); ownedGeoms.push(glowGeo);
      lampGlowMat = new THREE.MeshBasicMaterial({
        map: glowTex, color: 0xffe0a8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      localMats.push(lampGlowMat);
      lampGlow = new THREE.InstancedMesh(glowGeo, lampGlowMat, lampP.length);
      lampGlow.frustumCulled = false; lampGlow.renderOrder = 2; lampGlow.visible = false;
      const gm = new THREE.Matrix4(), gp = new THREE.Vector3(), gq = new THREE.Quaternion(), gs = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < lampP.length; i++) {
        gp.set(lampP[i].x, 0.18, lampP[i].z); gm.compose(gp, gq, gs);
        lampGlow.setMatrixAt(i, gm);
      }
      lampGlow.instanceMatrix.needsUpdate = true; lampGlow.matrixAutoUpdate = false; lampGlow.updateMatrix();
      scene.add(lampGlow); ownedInstanced.push(lampGlow);
    }
    for (const run of poleRuns) add(items.powerLines(run));
    if (SHOW_CITY_NPCS) add(items.people(peopleP));   // ambient crowd removed (walk-through, no collision)
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
  // Wall-avoidance keeps the camera OUT of buildings when you orbit next to one.
  // It's kept ON (without it the camera clips inside houses) but the pull-in is now
  // gently smoothed below so it no longer reads as a jarring "zoom on drag".
  const CAM_WALL_AVOID = true;
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
      // Lower bound goes NEGATIVE so the camera can drop below the head and tilt the
      // view UP toward the sky (was clamped at 0.12 → could only look down/level).
      camElev = Math.max(-0.55, Math.min(CAM_ELEV_MAX, camElev + dy * 0.005));
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

  // ── Dev perf overlay (hidden; toggle with `~` / backquote) ───────────────
  // Shows FPS / frame-ms / draw calls / triangles / live pixel-ratio + tier so the
  // perf work can be measured before/after on each device tier. Dev-only, no cost
  // while hidden; cleaned up in dispose().
  const perfHud = document.createElement('div');
  perfHud.className = 'v-perfhud';
  perfHud.style.cssText = 'position:absolute;top:8px;left:8px;z-index:50;display:none;padding:6px 9px;border-radius:8px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#bdf;background:rgba(6,14,18,.74);pointer-events:none;white-space:pre;letter-spacing:.2px';
  container.appendChild(perfHud);
  let perfHudOn = false, perfAccum = 0, perfFrames = 0;
  const onPerfKey = (e) => {
    // Never hijack keystrokes while the player is typing (e.g. the chat box) — the
    // dev hotkeys ('`' perf overlay, 'r' weather) must not fire mid-message.
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
    if (e.key === '`' || e.key === '~') {
      perfHudOn = !perfHudOn;
      perfHud.style.display = perfHudOn ? 'block' : 'none';
      perfAccum = 0; perfFrames = 0;
    } else if (e.key === 'r' || e.key === 'R') {
      // Cycle the dev weather override: real → clear → light rain → heavy rain → real.
      forceWx = forceWx >= 2 ? -1 : forceWx + 1;
      if (forceWx >= 0) {
        const w = FORCE_WX[forceWx];
        curOvercast = w.o; curRain = w.r;
        environment.setWeather({ overcast: w.o, rain: w.r });
        applyFog(w.o);
      }
    } else if (e.key === '1') {
      if (player && !sitting) player.playEmote('wave');
    } else if (e.key === '2') {
      if (player && !sitting) player.playEmote('celebrate');
    }
  };
  window.addEventListener('keydown', onPerfKey);
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
  // Falling rain as STREAKS (LineSegments), in a tall box re-centred on the CAMERA
  // each frame so the downpour fills the whole view (not just where the avatar is).
  // Each drop is a short segment leaning down-wind; reused as it falls past the ground.
  const rainN = q.tier === 'low' ? 0 : Math.round(900 * density);
  const RAIN_BX = 95, RAIN_BY = 65;     // half-width (x/z) and height of the rain volume
  let rainPts = null;
  const rainBase = rainN ? new Float32Array(rainN * 3) : null;   // drop HEAD positions
  if (rainN) {
    const pos = new Float32Array(rainN * 2 * 3);  // 2 vertices (head + tail) per drop
    for (let i = 0; i < rainN; i++) {
      rainBase[i * 3] = (Math.random() - 0.5) * RAIN_BX * 2;
      rainBase[i * 3 + 1] = Math.random() * RAIN_BY;
      rainBase[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BX * 2;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rainPts = new THREE.LineSegments(pg, new THREE.LineBasicMaterial({ color: 0xaebfc6, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    rainPts.frustumCulled = false; rainPts.visible = false; scene.add(rainPts);
  }

  // ── Rain SPLASHES — tiny rings that pop + expand where drops hit the ground.
  // A pool of flat ring meshes (own material each → per-splash opacity), spawned
  // around the camera while it rains (rate scales with intensity), then fade fast. ──
  const splashN = rainN ? (q.tier === 'high' ? 24 : 14) : 0;
  let splashes = null;
  if (splashN) {
    const sgeo = new THREE.RingGeometry(0.16, 0.24, 12); sgeo.rotateX(-Math.PI / 2);
    ownedGeoms.push(sgeo);
    const meshes = [], st = [];
    for (let i = 0; i < splashN; i++) {
      const sm = new THREE.MeshBasicMaterial({ color: 0xd2e6ea, transparent: true, opacity: 0, depthWrite: false, fog: true, side: THREE.DoubleSide });
      localMats.push(sm);
      const sp = new THREE.Mesh(sgeo, sm);
      sp.visible = false; sp.renderOrder = 2; sp.frustumCulled = false;
      scene.add(sp); meshes.push(sp); st.push({ active: false, age: 0, life: 0.4 });
    }
    splashes = { meshes, st, acc: 0 };
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
        if (forceWx < 0) {   // real weather (skip while the dev override is active)
          curOvercast = m.overcast; curRain = m.rain;
          environment.setWeather({ overcast: curOvercast, rain: curRain });
          applyFog(curOvercast);
        }
        windAmt = Math.max(0, Math.min(1, windKmh / 40));
        const windDeg = c.wind_direction_10m;
        if (typeof windDeg === 'number') windDir = (windDeg * Math.PI) / 180;
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
  let phase = 0, near = null, last = performance.now(), miniAccum = 0, posAccum = 0;
  // PERF state: shadow-bake cadence, last-applied night factor (throttle slow uniform
  // writes), and dynamic-resolution control (EMA of FPS + a cooldown so the pixel
  // ratio steps smoothly between the tier max and a 0.66× floor).
  let shadowAccum = 1, lastNight = -1;
  const basePR = q.pixelRatio;
  let dynScale = 1, dynCooldown = 0, fpsEma = 60;

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

    // PERF: re-bake the shadow map on a fixed ~30Hz cadence rather than every frame.
    // Decouples the (expensive) static-city shadow pass from the display refresh; the
    // player uses a fake blob shadow so only NPC shadows lag by 1–2 frames (invisible).
    if (q.shadowMapSize > 0) {
      shadowAccum += dt;
      if (shadowAccum >= 1 / 30) { renderer.shadowMap.needsUpdate = true; shadowAccum = 0; }
    }

    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    // Mirror the keyboard direction on the on-screen joystick knob (ix/iz are
    // keyboard-only here, before the touch input is mixed in) so the bottom-left
    // touch control and WASD/arrows stay visually in sync. No-op while it's touched.
    stick.setVisual && stick.setVisual(ix, iz);
    ix += joy.x; iz += joy.y;
    let mag = Math.hypot(ix, iz);
    let moving = mag > 0.08;
    if (mag > 1) { ix /= mag; iz /= mag; mag = 1; }

    const pp = player.group.position;
    // Seated: any movement input stands the player up; otherwise stay locked to
    // the seat (skip walking entirely this frame).
    if (sitting) {
      if (mag > 0.08) requestStand();
      else moving = false;
    }
    // After a ticket is accepted the guard opens the gate and the player walks IN
    // automatically — steer toward a point just inside the gate, overriding input
    // until they're past the fence.
    let mvx = 0, mvz = 0;
    if (autoEnter && !entered) {
      autoEnter.t = (autoEnter.t || 0) + dt;
      if (autoEnter.t > 5) { entered = true; autoEnter = null; }   // safety: never auto-walk forever
      else {
        const tgX = Math.cos(autoEnter.a) * (fenceR - 14), tgZ = Math.sin(autoEnter.a) * (fenceR - 14);
        const dx = tgX - pp.x, dz = tgZ - pp.z, dl = Math.hypot(dx, dz) || 1;
        mvx = dx / dl; mvz = dz / dl; moving = true;
      }
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
            if (b.lm && b.lm.openT > 0.5) continue;       // landmark door open (in opening hours) — walk in
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
    if (sitting) targetY = SEAT_Y;   // locked to the bench seat height
    // Jump (space) + gravity. Grounded → smooth-follow terrain (bridge/island);
    // airborne → integrate vertical velocity.
    const baseY = targetY;
    if (!sitting && keys[' '] && vy === 0 && pp.y <= baseY + 0.06) vy = 6.4;
    if (vy !== 0 || pp.y > baseY + 0.02) {
      vy -= 18 * dt; pp.y += vy * dt;
      if (pp.y <= baseY) { pp.y = baseY; vy = 0; }
    } else {
      pp.y += (baseY - pp.y) * Math.min(1, dt * 9);
    }

    const emoting = player.isEmoting && player.isEmoting();
    // GLB avatars pose themselves from update(state); only the procedural avatar is
    // posed via its `parts` bones here.
    if (player.kind === 'glb') {
      /* skeletal pose handled in player.update() below */
    } else if (sitting) {
      applySitPose(player.parts, player.group, true);
    } else {
      // Walk cadence + swing scale by age (young = quicker/bigger, old = slower).
      const g8 = player.gait || { stepRate: 1, swingAmt: 1 };
      const sp = moving ? mag : 0;
      phase += dt * (6 + sp * 4) * (moving ? 1 : 0) * g8.stepRate;
      const swing = moving ? 0.7 * sp * g8.swingAmt : 0;
      const ease = (p, v) => p.rotation.x += (v - p.rotation.x) * Math.min(1, dt * 14);
      ease(player.parts.legL, Math.sin(phase) * swing);
      ease(player.parts.legR, -Math.sin(phase) * swing);
      // While an emote plays the avatar drives its own arms — don't fight it here.
      if (!emoting) { ease(player.parts.armL, -Math.sin(phase) * swing * 0.7); ease(player.parts.armR, Math.sin(phase) * swing * 0.7); }
      player.parts.torso.position.y = 1.05 + (moving ? Math.abs(Math.sin(phase)) * 0.04 : 0);
    }
    // Face layer (blink / idle look / expression / emote), AFTER the base pose so
    // it composites on top. Wide-eyed surprise mid-jump; neutral when grounded.
    if (!sitting && !emoting) {
      if (heldExpr && now < heldExprUntil) player.setExpression(heldExpr);
      else { heldExpr = null; player.setExpression(pp.y <= baseY + 0.05 ? 'neutral' : 'surprised'); }
    }
    player.update(dt, { moving, grounded: pp.y <= baseY + 0.05, sitting });
    blob.position.set(pp.x, pp.y + 0.05, pp.z);

    // Frame-rate-independent damping helper.
    const damp = (cur, target, lambda) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
    // Manual orbit: drag = orient, wheel = zoom. Lightly damped so it's smooth.
    camYawCur = damp(camYawCur, camYaw, 12);
    camElevCur = damp(camElevCur, camElev, 12);

    // ── Camera wall-avoidance (spring arm) ────────────────────────────────────
    // ONLY pulls the camera IN when a wall is actually between it and the player —
    // so ngõ/ngách + building interiors never clip through walls — and otherwise
    // leaves the user's zoom/angle alone. The camera ALWAYS looks at the player's
    // head, so however close it is forced it can't jam low and stare upward.
    const pivotY = pp.y + 1.5;
    const hCos = Math.max(0.2, Math.cos(camElevCur));
    let wantD = camDist;
    if (CAM_WALL_AVOID && gridB) {
      const sx = Math.sin(camYawCur), sz = Math.cos(camYawCur);   // player→camera (horizontal)
      const hd = camDist * hCos;
      let hit = hd;
      const steps = Math.min(7, Math.ceil(hd / GCELL) + 1);
      const seenC = new Set();
      for (let s = 0; s <= steps; s++) {
        const sxp = pp.x + sx * s * GCELL, szp = pp.z + sz * s * GCELL;
        const cgx = Math.floor(sxp / GCELL), cgz = Math.floor(szp / GCELL);
        for (let gx = cgx - 1; gx <= cgx + 1; gx++) for (let gz = cgz - 1; gz <= cgz + 1; gz++) {
          const arr = gridB.get(gx + '_' + gz); if (!arr) continue;
          for (let mi = 0; mi < arr.length; mi++) {
            const bi = arr[mi]; if (seenC.has(bi)) continue; seenC.add(bi);
            const poly = buildingPolys[bi].poly;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const ax = poly[j][0], az = poly[j][1], ex = poly[i][0] - ax, ez = poly[i][1] - az;
              const det = ex * sz - sx * ez; if (det < 1e-6 && det > -1e-6) continue;
              const dx0 = ax - pp.x, dz0 = az - pp.z;
              const tt = (ex * dz0 - ez * dx0) / det;     // distance along ray to the wall
              const uu = (sx * dz0 - sz * dx0) / det;     // param along the wall edge
              if (uu >= 0 && uu <= 1 && tt > 0.05 && tt < hit) hit = tt;
            }
          }
        }
      }
      // Sit just before the nearest wall — never beyond it (no clip). Small floor so
      // narrow alleys (ngõ/ngách) stay walkable without the camera punching through the
      // far wall into a building; the avatar is hidden when the camera gets this close.
      if (hit < hd) wantD = Math.min(camDist, Math.max(0.45, (hit - 0.4) / hCos));
    }
    // Pull in smoothly (no jarring zoom-snap, but quick enough to avoid clipping),
    // ease back out slowly (no pop).
    camDcur += (wantD - camDcur) * Math.min(1, dt * (wantD < camDcur ? 9 : 4));
    // Hide the avatar (+ its blob shadow) when the camera is forced very close (tight
    // alleys / against a wall) so we never see INSIDE its head.
    if (player && player.group) {
      const showAvatar = camDcur > 1.2;
      player.group.visible = showAvatar;
      if (blob) blob.visible = showAvatar;
    }

    // Player planar speed → a subtle dynamic FOV kick when moving fast.
    const instSpeed = Math.hypot(pp.x - prevPx, pp.z - prevPz) / Math.max(dt, 1e-3);
    prevPx = pp.x; prevPz = pp.z;
    camSpeed = damp(camSpeed, instSpeed, 6);
    const fovTarget = baseFov + Math.min(4, camSpeed * 0.5);
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();

    // Camera = head pivot + orbit offset; ALWAYS look back at the head so the
    // player stays framed no matter how close the wall-avoidance forces it.
    // Camera POSITION uses a floored elevation so it never drops below the head and
    // into the avatar; "looking up" is done by raising the LOOK TARGET (below), not
    // by sinking the camera into the player.
    const posElev = Math.max(camElevCur, 0.05);
    const offX = camDcur * Math.cos(posElev) * Math.sin(camYawCur);
    const offZ = camDcur * Math.cos(posElev) * Math.cos(camYawCur);
    const offY = camDcur * Math.sin(posElev);
    camTarget.set(pp.x + offX, pivotY + offY, pp.z + offZ);
    if (camTarget.y < 0.5) camTarget.y = 0.5;     // ground/lake clamp
    camera.position.lerp(camTarget, Math.min(1, dt * 9));
    if (camera.position.y < 0.5) camera.position.y = 0.5;
    // Default: look at the head. Dragging DOWN past the camera floor tilts the VIEW
    // up toward the sky — capped at ~72° so the lookAt never reaches true vertical
    // (which rolls the horizon / gimbal-locks). The look point rises along the player's
    // vertical axis to hit exactly that pitch from the camera's current position.
    tmp.set(pp.x, pivotY, pp.z);
    const upAmt = Math.min(1, Math.max(0, 0.05 - camElevCur) / 0.6);
    if (upAmt > 0) {
      const D = camDcur * Math.cos(posElev);
      tmp.y = camera.position.y + D * Math.tan(upAmt * 1.26);   // rise to ~72° max
    }
    if (!lookInit) { lookTarget.copy(tmp); lookInit = true; }
    lookTarget.x = damp(lookTarget.x, tmp.x, 16);
    lookTarget.y = damp(lookTarget.y, tmp.y, 16);
    lookTarget.z = damp(lookTarget.z, tmp.z, 16);
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
    // PERF: `night` tracks the (slowly-moving) sun elevation, so only push the lamp /
    // lantern / window-glow uniforms when it has meaningfully changed.
    if (Math.abs(night - lastNight) > 0.01) {
      lastNight = night;
      items.setNightFactor && items.setNightFactor(night);
      setFacadeNight(night);
      // Street-lamp ground pools: invisible by day, warm glow after dusk.
      if (lampGlow) { lampGlow.visible = night > 0.02; if (lampGlowMat) lampGlowMat.opacity = night * 0.7; }
    }
    // Lake ambience: mist fades with `night`, willow fronds sway in the wind, koi
    // glide, fireflies glow after dusk. (`night` is computed fresh every frame above.)
    ambience.update(t, dt, { camPos, windAmt, windDir, night });
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

    // PERF: gate / guard / perimeter-patrol animation is INDEPENDENT of the
    // interactables — run it ONCE per frame. (It used to sit inside the interactables
    // loop below, recomputing every guard + perimeter instance N× per frame and
    // setting the perimeter instanceMatrix.needsUpdate N× — N = interactables.length.)

    // Gates swing open: signed-in players have them open on approach (the guards man
    // the checkpoint) and close behind; guests' gates open on a valid ticket.
    for (const fg of fenceGates) {
      if (!fg.leaves) continue;
      if (entered) { const gd = Math.hypot(pp.x - fg.x, pp.z - fg.z); fg.openTarget = gd < 14 ? 1 : 0; }
      const tgt = fg.openTarget || 0;
      if (Math.abs(fg.openT - tgt) > 0.001) {
        fg.openT += (tgt - fg.openT) * Math.min(1, dt * 2.6);
        for (const lf of fg.leaves) lf.grp.rotation.y = lf.closedYaw + lf.delta * fg.openT;
      }
    }
    // Shop entrance doors swing open as the player approaches (closes when away).
    for (const sd of shopDoors) {
      const tgt = Math.hypot(pp.x - sd.x, pp.z - sd.z) < 6 ? 1 : 0;
      if (Math.abs(sd.openT - tgt) > 0.001) {
        sd.openT += (tgt - sd.openT) * Math.min(1, dt * 3.2);
        for (const lf of sd.leaves) lf.grp.rotation.y = lf.openYaw * sd.openT;
      }
    }
    // Public landmarks open/close with REAL Hanoi time: doors swing, windows glow,
    // a warm light comes on, and the status sign flips MỞ CỬA / ĐÓNG CỬA.
    if (landmarks.length) {
      const hr = hanoiHour();
      for (const lm of landmarks) {
        // Post-office clock hands track real time every frame, open or shut.
        if (lm.clock) {
          const mins = (hr % 1);                          // fraction of the hour
          lm.clock.minute.rotation.z = -mins * Math.PI * 2;
          lm.clock.hour.rotation.z = -(((hr % 12) + mins) / 12) * Math.PI * 2;
        }
        const tgt = lm.ranges.some(([a, b]) => hr >= a && hr < b) ? 1 : 0;
        if (Math.abs(lm.openT - tgt) > 0.001) {
          lm.openT += (tgt - lm.openT) * Math.min(1, dt * 2);
          for (const lf of lm.leaves) lf.grp.rotation.y = lf.openYaw * lm.openT;
          for (const gm of lm.glowMats) gm.emissiveIntensity = lm.openT * gm.userData.baseEmissive;
          for (const li of lm.lights) li.intensity = lm.openT * li.userData.baseInt;
          if (lm.signOpen) lm.signOpen.visible = lm.openT > 0.5;
          if (lm.signClosed) lm.signClosed.visible = lm.openT <= 0.5;
        }
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

    // Per-interactable: the floating marker bob + the proximity glow pulse.
    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (it.marker) {
        it.marker.rotation.z = t * 1.0 + i;
        it.marker.position.y = it.markerBaseY + Math.sin(t * 1.4 + i) * 0.12;
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
    // Extend the wet look to the roofs + façades + the puddles (throttled: wetness
    // changes slowly). Roofs/walls gain a reflective sheen; puddles fade in.
    if (Math.abs(wet - lastWet) > 0.01) {
      lastWet = wet;
      for (let i = 0; i < wetMats.length; i++) {
        const w = wetMats[i];
        w.m.roughness = w.r0 * (1 - 0.5 * wet);
        w.m.envMapIntensity = w.e0 * (1 + 1.1 * wet);
      }
      if (puddleMat) puddleMat.opacity = Math.min(0.82, wet * 0.95);
      if (puddles) puddles.visible = wet > 0.02;
    }
    if (rainPts) {
      rainPts.visible = rainAmt > 0.03;
      if (rainPts.visible) {
        const arr = rainPts.geometry.attributes.position.array;
        const fall = dt * 58;                       // fall distance this frame
        const slant = fall * windAmt * 0.8;         // wind lean
        // Streak vector (head→tail): opposite the velocity, fixed length.
        const len = 1.0 + rainAmt * 0.9;
        const vmag = Math.hypot(slant, fall) || 1;
        const tdx = (slant / vmag) * len, tdy = (fall / vmag) * len;
        for (let i = 0; i < rainN; i++) {
          let bx = rainBase[i * 3] + slant, by = rainBase[i * 3 + 1] - fall, bz = rainBase[i * 3 + 2];
          if (by < 0 || bx > RAIN_BX) { by = RAIN_BY; bx = (Math.random() - 0.5) * RAIN_BX * 2; bz = (Math.random() - 0.5) * RAIN_BX * 2; }
          rainBase[i * 3] = bx; rainBase[i * 3 + 1] = by; rainBase[i * 3 + 2] = bz;
          const k = i * 6;
          arr[k] = bx; arr[k + 1] = by; arr[k + 2] = bz;                 // head (bottom)
          arr[k + 3] = bx - tdx; arr[k + 4] = by + tdy; arr[k + 5] = bz; // tail (up-wind)
        }
        rainPts.geometry.attributes.position.needsUpdate = true;
        rainPts.position.set(camPos.x, 0, camPos.z);   // follow the CAMERA → fills the view
        rainPts.material.opacity = Math.min(0.55, rainAmt * 0.7);
      }
    }

    // Rain splashes: spawn near the camera while it rains (rate ∝ intensity), then
    // each pops + expands + fades. Ageing runs every frame so they finish cleanly
    // after the rain stops.
    if (splashes) {
      const raining = rainAmt > 0.05;
      if (raining) {
        splashes.acc += dt * (1 + rainAmt * 6);
        const interval = 0.045;
        while (splashes.acc > interval) {
          splashes.acc -= interval;
          const idx = splashes.st.findIndex((s) => !s.active);
          if (idx < 0) break;
          const s = splashes.st[idx];
          s.active = true; s.age = 0; s.life = 0.32 + Math.random() * 0.22;
          const rr = Math.random() * 34, aa = Math.random() * Math.PI * 2;
          splashes.meshes[idx].position.set(camPos.x + Math.cos(aa) * rr, 0.06, camPos.z + Math.sin(aa) * rr);
          splashes.meshes[idx].visible = true;
        }
      }
      for (let i = 0; i < splashes.st.length; i++) {
        const s = splashes.st[i]; if (!s.active) continue;
        s.age += dt; const tt = s.age / s.life;
        const sp = splashes.meshes[i];
        if (tt >= 1) { s.active = false; sp.visible = false; continue; }
        const sc = 0.4 + tt * 2.6; sp.scale.set(sc, sc, sc);
        sp.material.opacity = (1 - tt) * 0.42;
      }
    }

    miniAccum += dt;
    if (miniAccum > 0.12) { drawMinimap(); miniAccum = 0; }

    // ── Multiplayer: interpolate remote avatars + report the local transform ──
    updateRemotes(dt, t);
    updateBubbles();
    {
      const anim = sitting ? 'sit' : (moving ? 'walk' : 'idle');
      opts.onLocalState && opts.onLocalState({
        x: pp.x, z: pp.z, rotY: player.group.rotation.y, anim, seatId: localSeatId,
      });
      // Sit prompt: offer "stand" while seated, else "sit" when a free seat is in
      // reach. Only emit on change so WorldScreen isn't spammed.
      nearestFreeSeatId = sitting ? null : findNearestFreeSeat(pp.x, pp.z);
      const sig = sitting ? 'seated' : (nearestFreeSeatId ? 'can:' + nearestFreeSeatId : '');
      if (sig !== lastSitSig) {
        lastSitSig = sig;
        opts.onSit && opts.onSit({ seated: sitting, canSit: !!nearestFreeSeatId });
      }
    }

    // Persist the world position (for everyone — signed-in and guests) so a
    // reload resumes where the player was standing. The `entered` flag rides
    // along so a guest who already cleared a gate stays inside on reload.
    posAccum += dt;
    if (posAccum > 1.2) { posAccum = 0; opts.onPos && opts.onPos({ x: pp.x, z: pp.z, entered }); }

    // PERF: dynamic resolution to keep every tier smooth. Track an EMA of FPS; when we
    // fall behind, step the device pixel ratio DOWN; when there's headroom, ease it back
    // UP toward the tier's max. A cooldown after each change (rebuilding the composer's
    // render targets isn't free) plus the dead-band between 45/58 FPS prevents thrash.
    fpsEma += ((1 / Math.max(dt, 1e-3)) - fpsEma) * 0.1;
    dynCooldown -= dt;
    if (dynCooldown <= 0) {
      let next = dynScale;
      if (fpsEma < 45 && dynScale > 0.66) next = Math.max(0.66, dynScale - 0.1);
      else if (fpsEma > 58 && dynScale < 1) next = Math.min(1, dynScale + 0.1);
      if (next !== dynScale) {
        dynScale = next;
        const pr = basePR * dynScale;
        renderer.setPixelRatio(pr);            // non-composed passes (Water) + passthrough
        post.setPixelRatio && post.setPixelRatio(pr);  // resize the composer's RTs + passes
        dynCooldown = 1.0;                     // let it settle before re-evaluating
      }
    }

    environment.update(dt, camPos);
    post.render(dt);

    // Dev perf overlay (throttled to ~4Hz). renderer.info reflects the frame just
    // rendered (incl. the water-reflection + post passes), so this is the true cost.
    if (perfHudOn) {
      perfFrames++; perfAccum += dt;
      if (perfAccum >= 0.25) {
        const fps = perfFrames / perfAccum;
        const r = renderer.info.render;
        perfHud.textContent =
          `${fps.toFixed(0)} fps   ${(perfAccum / perfFrames * 1000).toFixed(1)} ms\n` +
          `calls ${r.calls}   tris ${(r.triangles / 1000).toFixed(0)}k\n` +
          `pr ${renderer.getPixelRatio().toFixed(2)}   tier ${q.tier}`;
        perfAccum = 0; perfFrames = 0;
      }
    }

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
    // Multiplayer: WorldScreen forwards realtime events into the engine here.
    net: {
      snapshot(states) { applySnapshot(states); },
      playerLeft(id) { playerLeft(id); },
      seatGranted(seatId) { seatGranted(seatId); },
      seatDenied(seatId) { seatDenied(seatId); },
    },
    // Sit controls (driven by the sit prompt button in WorldScreen).
    sit() { requestSit(); },
    stand() { requestStand(); },
    // Emotes (driven by the HUD emote button + the 1/2 hotkeys).
    emote(name) { if (player && !sitting) player.playEmote(name); },
    setExpression(name) { if (player && player.setExpression) { player.setExpression(name); heldExpr = name; heldExprUntil = performance.now() + 4000; } },
    // Chat: show the local player's own bubble immediately (optimistic); remote
    // bubbles arrive via the presence snapshot.
    say(text) { if (SELF_ID) say(SELF_ID, text); },
    dispose() {
      disposed = true;
      running = false; cancelAnimationFrame(raf);
      for (const id of [...remotePlayers.keys()]) disposeRemote(id);
      clearInterval(weatherTimer); clearInterval(timeTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('keydown', onPerfKey);
      ro.disconnect();
      kb.dispose(); stick.dispose();
      dom.removeEventListener('pointerdown', camDown); dom.removeEventListener('pointermove', camMove);
      dom.removeEventListener('pointerup', camUp); dom.removeEventListener('pointercancel', camUp);
      dom.removeEventListener('wheel', onWheel);
      post.dispose();
      environment.dispose();
      mats.dispose();
      facades.dispose(); items.dispose(); ambience.dispose();
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
      if (perfHud.parentNode) perfHud.parentNode.removeChild(perfHud);
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
