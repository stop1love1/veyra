// @ts-nocheck -- shared PBR material library (procedural textures)
import * as THREE from 'three';
import { hsl } from './helpers';

/* -------------------------------------------------------------------------- *
 *  Shared PBR material library for the "modern outdoor commercial street".
 *
 *  Aesthetic: true-to-life. Realism comes from PBR (roughness / metalness /
 *  normal maps / env reflections) over a neutral, low-saturation palette:
 *  concrete, stone paving, asphalt, glass, painted metal, wood, real greens.
 *  1 world unit ~= 1 meter.
 *
 *  Every texture is generated procedurally on a <canvas> (value/FBM noise);
 *  no external image files. We keep the texture count modest for a mobile
 *  budget by sharing a couple of canvas helpers and small map sizes.
 * -------------------------------------------------------------------------- */

/* ============================ canvas / noise =============================== */

/** Allocate a 2D canvas of `size`x`size`. */
function makeCanvas(size) {
  const c =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : new OffscreenCanvas(size, size);
  c.width = c.height = size;
  return c;
}

/** Cheap deterministic 2D value noise with bilinear interpolation. */
function valueNoise2D(seed) {
  // Hash a lattice point -> [0,1). Stable per (x,y,seed).
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return ((h >>> 0) % 100000) / 100000;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    const u = smooth(xf);
    const v = smooth(yf);
    return (
      a * (1 - u) * (1 - v) +
      b * u * (1 - v) +
      c * (1 - u) * v +
      d * u * v
    );
  };
}

/**
 * Render fractal (FBM) value noise to a grayscale-ish canvas and return it.
 * Reusable building block for height/albedo detail.
 *
 *  opts:
 *   - scale       base lattice frequency (cells across the canvas)
 *   - octaves     number of FBM layers
 *   - seed        noise seed
 *   - contrast    push values away from 0.5
 *   - tint        THREE.Color base; noise modulates its brightness
 *   - bias        added to the final value (brighten/darken)
 */
function makeNoiseCanvas(size, opts = {}) {
  const {
    scale = 8,
    octaves = 4,
    seed = 1,
    contrast = 1,
    tint = new THREE.Color(0.5, 0.5, 0.5),
    bias = 0,
  } = opts;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(valueNoise2D(seed + o * 17));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 1;
      let freq = scale / size;
      let sum = 0;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        sum += layers[o](x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      let v = sum / norm; // 0..1
      v = 0.5 + (v - 0.5) * contrast + bias; // contrast + brighten
      v = Math.max(0, Math.min(1, v));
      const i = (y * size + x) * 4;
      img.data[i] = v * tint.r * 255;
      img.data[i + 1] = v * tint.g * 255;
      img.data[i + 2] = v * tint.b * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Derive a tangent-space normal map from the luminance of `srcCanvas` using a
 * simple Sobel operator. `strength` scales the bump. Returns a new canvas.
 */
function normalFromHeight(srcCanvas, strength = 1) {
  const size = srcCanvas.width;
  const sctx = srcCanvas.getContext('2d');
  const src = sctx.getImageData(0, 0, size, size).data;
  const out = makeCanvas(size);
  const octx = out.getContext('2d');
  const dst = octx.createImageData(size, size);

  // Luminance lookup with wrap-around so the normal map tiles seamlessly.
  const lum = (x, y) => {
    const xx = (x + size) % size;
    const yy = (y + size) % size;
    const i = (yy * size + xx) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel gradients.
      const tl = lum(x - 1, y - 1), t = lum(x, y - 1), tr = lum(x + 1, y - 1);
      const l = lum(x - 1, y), r = lum(x + 1, y);
      const bl = lum(x - 1, y + 1), b = lum(x, y + 1), br = lum(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      // Build & normalise the tangent-space normal.
      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

/* ============================ texture factory ============================= */

export function createMaterials({ anisotropy = 4, envMap = null } = {}) {
  // Track every generated texture & material so dispose() is exhaustive.
  const textures = [];
  const materials = [];

  /** Wrap a canvas into a tiling THREE.Texture. `srgb` only for albedo. */
  function tex(canvas, repeat = 1, srgb = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; // albedo only
    t.needsUpdate = true;
    textures.push(t);
    return t;
  }

  /** Build albedo + roughness + normal from a single height canvas. */
  function pbrSet(size, heightOpts, repeat, normalStrength, albedoTint) {
    const height = makeNoiseCanvas(size, heightOpts);
    const albedoCanvas = albedoTint
      ? makeNoiseCanvas(size, { ...heightOpts, tint: albedoTint })
      : height;
    const albedo = tex(albedoCanvas, repeat, true);
    // Reuse the height canvas (grayscale) as a roughness detail map.
    const rough = tex(height, repeat, false);
    const normal = tex(normalFromHeight(height, normalStrength), repeat, false);
    return { albedo, rough, normal };
  }

  function track(m) {
    materials.push(m);
    return m;
  }

  /* ----------------------------- ground ---------------------------------- */

  // Light grey stone slab sidewalk.
  const pavingSet = pbrSet(
    256,
    { scale: 5, octaves: 4, seed: 11, contrast: 0.6, tint: hsl(40, 0.04, 0.66) },
    4,
    1.4,
    hsl(40, 0.04, 0.66),
  );
  const paving = track(
    new THREE.MeshStandardMaterial({
      map: pavingSet.albedo,
      roughnessMap: pavingSet.rough,
      normalMap: pavingSet.normal,
      roughness: 0.85,
      metalness: 0,
      color: 0xffffff,
    }),
  );
  paving.normalScale.set(0.6, 0.6);

  // Dark asphalt road, fine grain.
  const asphaltSet = pbrSet(
    256,
    { scale: 18, octaves: 5, seed: 23, contrast: 0.5, tint: hsl(28, 0.03, 0.17), bias: -0.02 },
    6,
    0.8,
    hsl(28, 0.03, 0.17),
  );
  const asphalt = track(
    new THREE.MeshStandardMaterial({
      map: asphaltSet.albedo,
      roughnessMap: asphaltSet.rough,
      normalMap: asphaltSet.normal,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  asphalt.normalScale.set(0.4, 0.4);

  // Mid grey structural concrete (shared height map drives both concrete & curb).
  const concreteSet = pbrSet(
    256,
    { scale: 7, octaves: 4, seed: 31, contrast: 0.45, tint: hsl(36, 0.05, 0.52) },
    3,
    1.0,
    hsl(36, 0.05, 0.52),
  );
  const concrete = track(
    new THREE.MeshStandardMaterial({
      map: concreteSet.albedo,
      roughnessMap: concreteSet.rough,
      normalMap: concreteSet.normal,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  concrete.normalScale.set(0.5, 0.5);

  // Concrete curb — slightly lighter, reuses the concrete maps at a tighter repeat.
  const curb = track(
    new THREE.MeshStandardMaterial({
      map: concreteSet.albedo,
      roughnessMap: concreteSet.rough,
      normalMap: concreteSet.normal,
      roughness: 0.88,
      metalness: 0,
      color: hsl(38, 0.06, 0.66),
    }),
  );
  curb.normalScale.set(0.4, 0.4);

  /* ----------------------------- masonry --------------------------------- */

  // Muted red-brown brick accent.
  const brickSet = pbrSet(
    256,
    { scale: 9, octaves: 4, seed: 47, contrast: 0.7, tint: hsl(15, 0.32, 0.4) },
    4,
    1.6,
    hsl(15, 0.32, 0.4),
  );
  const brick = track(
    new THREE.MeshStandardMaterial({
      map: brickSet.albedo,
      roughnessMap: brickSet.rough,
      normalMap: brickSet.normal,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  brick.normalScale.set(0.8, 0.8);

  /* ---------------------------- plaster cache ---------------------------- */

  // Shared fine plaster height map; per-hue materials tint the same maps.
  const plasterSet = pbrSet(
    256,
    { scale: 6, octaves: 3, seed: 53, contrast: 0.35, tint: new THREE.Color(0.5, 0.5, 0.5) },
    3,
    0.7,
  );
  const plasterCache = new Map();
  /** Painted façade plaster. Low-saturation muted tint, cached per hue. */
  function plaster(hue) {
    const key = hue === undefined ? 'warm' : Math.round(hue);
    if (plasterCache.has(key)) return plasterCache.get(key);
    // Undefined hue -> warm off-white; otherwise a low-saturation muted tint.
    const color = hue === undefined ? hsl(38, 0.1, 0.86) : hsl(hue, 0.13, 0.64);
    const m = track(
      new THREE.MeshStandardMaterial({
        map: plasterSet.albedo,
        roughnessMap: plasterSet.rough,
        normalMap: plasterSet.normal,
        roughness: 0.9,
        metalness: 0,
        color,
      }),
    );
    m.normalScale.set(0.3, 0.3);
    plasterCache.set(key, m);
    return m;
  }

  /* ------------------------------ glass ---------------------------------- */

  // Storefront glass — reflective, slight cool tint, reads as real glass.
  const glassDark = track(
    new THREE.MeshPhysicalMaterial({
      color: hsl(195, 0.16, 0.24),
      metalness: 0,
      roughness: 0.05,
      transmission: 0.0, // opacity-based so it works without a backdrop pass
      transparent: true,
      opacity: 0.35,
      envMapIntensity: 1.6,
      clearcoat: 0.3,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    }),
  );

  /* ----------------------------- metals ---------------------------------- */

  // Anodized window/door framing.
  const metalFrame = track(
    new THREE.MeshStandardMaterial({
      color: hsl(220, 0.03, 0.32),
      metalness: 0.9,
      roughness: 0.45,
      envMapIntensity: 1.0,
    }),
  );

  // Dark steel for poles / bollards / bins.
  const steelDark = track(
    new THREE.MeshStandardMaterial({
      color: hsl(220, 0.04, 0.18),
      metalness: 0.7,
      roughness: 0.5,
      envMapIntensity: 0.9,
    }),
  );

  /* ------------------------------ wood ----------------------------------- */

  // Warm wood with directional grain. Stretch the noise into a streaky grain.
  const woodHeight = makeNoiseCanvas(256, {
    scale: 22, octaves: 4, seed: 67, contrast: 1.4, tint: hsl(28, 0.4, 0.4),
  });
  const woodAlbedoC = makeNoiseCanvas(256, {
    scale: 22, octaves: 4, seed: 67, contrast: 0.9, tint: hsl(28, 0.4, 0.42),
  });
  const woodAlbedo = tex(woodAlbedoC, 2, true);
  woodAlbedo.repeat.set(1, 4); // stretch grain along one axis
  const woodNormal = tex(normalFromHeight(woodHeight, 1.0), 2, false);
  woodNormal.repeat.set(1, 4);
  const wood = track(
    new THREE.MeshStandardMaterial({
      map: woodAlbedo,
      normalMap: woodNormal,
      roughness: 0.8,
      metalness: 0,
      color: hsl(28, 0.38, 0.5),
    }),
  );
  wood.normalScale.set(0.5, 0.5);

  /* ---------------------------- foliage ---------------------------------- */

  // Tree / bush leaves — realistic muted green with leafy detail.
  const foliageSet = pbrSet(
    256,
    { scale: 14, octaves: 4, seed: 79, contrast: 0.8, tint: hsl(96, 0.2, 0.36) },
    3,
    1.2,
    hsl(96, 0.2, 0.36),
  );
  const foliage = track(
    new THREE.MeshStandardMaterial({
      map: foliageSet.albedo,
      roughnessMap: foliageSet.rough,
      normalMap: foliageSet.normal,
      roughness: 0.9,
      metalness: 0.0,
      color: hsl(96, 0.22, 0.38),
      flatShading: false,
      side: THREE.DoubleSide,
    }),
  );
  foliage.normalScale.set(0.4, 0.4);

  // Brown bark with vertical grain.
  const barkHeight = makeNoiseCanvas(256, {
    scale: 20, octaves: 4, seed: 83, contrast: 1.3, tint: hsl(25, 0.35, 0.28),
  });
  const barkAlbedo = tex(
    makeNoiseCanvas(256, { scale: 20, octaves: 4, seed: 83, contrast: 0.8, tint: hsl(25, 0.35, 0.3) }),
    2, true,
  );
  barkAlbedo.repeat.set(2, 3);
  const barkNormal = tex(normalFromHeight(barkHeight, 1.4), 2, false);
  barkNormal.repeat.set(2, 3);
  const bark = track(
    new THREE.MeshStandardMaterial({
      map: barkAlbedo,
      normalMap: barkNormal,
      roughness: 0.92,
      metalness: 0,
      color: hsl(25, 0.34, 0.34),
    }),
  );
  bark.normalScale.set(0.8, 0.8);

  /* ------------------------------ water ---------------------------------- */

  // Fountain / puddle water — glossy, subtly tinted, highly reflective.
  const water = track(
    new THREE.MeshPhysicalMaterial({
      color: hsl(168, 0.22, 0.34),
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.85,
      envMapIntensity: 1.8,
      clearcoat: 0.4,
      clearcoatRoughness: 0.06,
    }),
  );

  /* ------------------------------ signs ---------------------------------- */

  // Materials that carry env reflections — used by setEnvMap & setWetness.
  const reflective = [glassDark, metalFrame, steelDark, water];
  const groundMats = [paving, asphalt, concrete, curb];
  // Remember base roughness so setWetness(0) restores exactly.
  const baseRough = new Map(groundMats.map((m) => [m, m.roughness]));
  const baseEnvI = new Map(groundMats.map((m) => [m, m.envMapIntensity ?? 1]));

  const signMeshes = [];
  /**
   * Build a storefront sign: a canvas texture (dark/brushed backing, clean
   * light lettering) mapped onto a thin PlaneGeometry. Returns the mesh.
   * opts: { width, height, hue, bg }
   */
  function makeSign(text, opts = {}) {
    const { width = 2.4, hue, bg } = opts;
    const W = 512, H = 160;
    const canvas = makeCanvas(W); // square alloc; we draw into a sub-rect
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Backing: dark brushed panel (or caller-provided bg / hue tint).
    const back = bg
      ? new THREE.Color(bg)
      : hue !== undefined
        ? hsl(hue, 0.18, 0.16)
        : hsl(220, 0.05, 0.12);
    ctx.fillStyle = `#${back.getHexString()}`;
    ctx.fillRect(0, 0, W, H);
    // Subtle brushed-metal streaks for realism.
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
      const y = Math.random() * H;
      ctx.fillRect(0, y, W, 1);
    }
    ctx.globalAlpha = 1;
    // Thin inner border frame.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    // Clean light lettering, centered.
    ctx.fillStyle = '#f2f2ee';
    ctx.font = '600 64px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(text ?? ''), W / 2, H / 2 + 4);

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = anisotropy;
    map.needsUpdate = true;
    textures.push(map);

    const h = (width * H) / W;
    const geo = new THREE.PlaneGeometry(width, h);
    const mat = track(
      new THREE.MeshStandardMaterial({
        map,
        roughness: 0.55,
        metalness: 0.2,
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sign';
    signMeshes.push(mesh);
    return mesh;
  }

  /* --------------------------- env / wetness ----------------------------- */

  /** Late-bind a PMREM env map onto every reflective material. */
  function setEnvMap(env) {
    for (const m of reflective) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    // A bound env map makes reflections meaningful → bump intensity a touch.
    glassDark.envMapIntensity = 2.0;
    metalFrame.envMapIntensity = 1.3;
    steelDark.envMapIntensity = 1.1;
    water.envMapIntensity = 2.2;
    // Ground materials also pick up the env for wet reflections.
    for (const m of groundMats) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  }

  /**
   * Late-bind CC0 PBR maps onto the ground/wall materials. Each `sets.*` is
   * { map, normalMap, roughnessMap } with any field possibly null. Repeat is in
   * metres⁻¹ so the tiling matches real-world scale. No-op for missing sets.
   */
  function applyPBR(sets) {
    if (!sets) return;
    const bind = (m, s) => {
      // `plaster` is a per-hue factory FUNCTION (not a material) — guard against
      // it (and anything else without a material's fields) so binding never
      // crashes on `m.color`. Real ground/wall materials have isMaterial === true.
      if (!m || !s || !m.isMaterial) return;
      // Reuse the material's EXISTING procedural-map tiling so the swapped-in CC0
      // textures tile at the same density instead of guessing UV conventions.
      const rep = m.map ? m.map.repeat.clone() : new THREE.Vector2(4, 4);
      if (s.map) { s.map.repeat.copy(rep); m.map = s.map; m.color.setScalar(1); }
      if (s.normalMap) { s.normalMap.repeat.copy(rep); m.normalMap = s.normalMap; }
      if (s.roughnessMap) { s.roughnessMap.repeat.copy(rep); m.roughnessMap = s.roughnessMap; }
      m.needsUpdate = true;
    };
    bind(asphalt, sets.asphalt);
    bind(paving, sets.paving);
    bind(concrete, sets.paving);
    bind(plaster, sets.plaster);
  }

  /**
   * Simulate rain wetness on the ground (v in 0..1): lower roughness and
   * raise env reflectivity. v=0 restores the stored base values exactly.
   */
  function setWetness(v) {
    const t = Math.max(0, Math.min(1, v));
    for (const m of groundMats) {
      const r0 = baseRough.get(m);
      const e0 = baseEnvI.get(m);
      m.roughness = r0 * (1 - 0.7 * t); // up to 70% glossier
      m.envMapIntensity = e0 * (1 + 1.5 * t); // brighter reflections
      m.needsUpdate = true;
    }
  }

  /** Dispose every generated material and texture. */
  function dispose() {
    for (const t of textures) t.dispose();
    for (const m of materials) m.dispose();
    for (const mesh of signMeshes) mesh.geometry?.dispose();
    textures.length = 0;
    materials.length = 0;
    signMeshes.length = 0;
    plasterCache.clear();
  }

  // If an env map was supplied up front, bind it immediately.
  if (envMap) setEnvMap(envMap);

  return {
    paving,
    asphalt,
    concrete,
    plaster,
    brick,
    glassDark,
    metalFrame,
    steelDark,
    wood,
    foliage,
    bark,
    water,
    curb,
    makeSign,
    setEnvMap,
    applyPBR,
    setWetness,
    dispose,
  };
}
