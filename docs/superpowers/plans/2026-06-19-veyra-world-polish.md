# Veyra 3D World Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the active Hanoi world — real reflective wind-driven lake, cinematic camera, livelier item effects, fixed item placement, and removal of in-world collectible coins.

**Architecture:** All changes target the active engine `client/app/lib/three/worldHanoi.ts` (`createVeyraWorld`) and the shared modules it consumes (`shared/materials.ts`, `shared/environment.ts`, `shared/hanoiItems.ts`). The lake is upgraded to Three.js `Water` fed by a procedurally generated normal map (no external assets). Item placement gains façade/building/spacing filters. Coins are removed from the world only; the game wallet stays.

**Tech Stack:** Next.js 15 + React, Three.js `0.160.1` (`three/addons/objects/Water.js`, `Sky.js`), procedural geometry/materials, InstancedMesh.

## Global Constraints

- **Scope:** Only `worldHanoi.ts` + `shared/materials.ts`, `shared/environment.ts`, `shared/hanoiItems.ts`, and `features/world/WorldScreen.tsx`. Do **not** touch legacy `world.ts`, `worldKit.ts`, `mapLoader.ts`.
- **External CC0 assets are allowed and bundled** under `client/public/textures/` and `client/public/models/` (see Task 0). Every asset load MUST be guarded with a **procedural fallback** so an offline build never hard-fails. Reuse the existing GLB loader `shared/assets.ts` (`createKitLoader`); add one texture-loader helper.
- **Procedural determinism** — keep the existing `hash01` / `rnd(i, salt)` seeding style so dressing is stable across rebuilds.
- **Performance tiers** — respect `q.tier` (`'low' | 'mid' | 'high'`); gate cost (reflection RT size, prop caps, shadow/particle work) by tier exactly as existing code does.
- **Three is `@ts-nocheck`** in this layer — files already carry `// @ts-nocheck`. Keep it.
- **Verification is build + manual run**, not unit tests: this is WebGL/visual code with no test harness. Each task verifies via `npm run build` (in `client/`) succeeding and a manual observation checklist. Do **not** invent meaningless asserts.
- **Commits/branching happen only when the user asks.** The repo is currently on `main`. Treat the per-task `git commit` steps as "stage a logical checkpoint" — only actually run them if the user has authorized committing (and branch first if still on `main`).
- **Keep the existing dispose() discipline** — every geometry/material/texture/render-target you allocate must be freed in the relevant `dispose()`.

---

## Task 0: Acquire CC0 assets + add a texture-loader helper

**Files:**
- Create: `client/public/textures/water/waternormals.jpg`, `client/public/textures/env/sky_1k.hdr`, `client/public/textures/ground/{asphalt,paving}/*`, `client/public/textures/wall/plaster/*`, `client/public/models/nature/tree.glb`
- Create: `client/app/lib/three/shared/textures.ts` (texture-loader helper)

**Interfaces:**
- Produces: bundled asset files; `createTextureLoader()` → `{ loadColorTex(url, repeat), loadDataTex(url), loadPBR(dir, repeat), loadHDR(url, renderer), dispose() }`. Every loader resolves to `null` (never throws) on failure so callers fall back.

- [ ] **Step 1: Download the assets into `client/public`**

Run (from repo root; URLs are CC0/MIT — adjust the exact Polyhaven/ambientCG picks if a 404 occurs, keeping CC0):

```bash
cd client/public
mkdir -p textures/water textures/env textures/ground/asphalt textures/ground/paving textures/wall/plaster models/nature
# Water normal (three.js examples, MIT)
curl -L -o textures/water/waternormals.jpg https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/waternormals.jpg
# Sky HDRI (three.js examples ships Polyhaven CC0 1k skies)
curl -L -o textures/env/sky_1k.hdr https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/equirectangular/venice_sunset_1k.hdr
# PBR sets (ambientCG CC0 — download the 1K-JPG zips and extract Color/NormalGL/Roughness)
# Asphalt026, PavingStones131, Plaster017 are examples; verify availability.
curl -L -o /tmp/asphalt.zip "https://ambientcg.com/get?file=Asphalt026_1K-JPG.zip" && (cd textures/ground/asphalt && unzip -o /tmp/asphalt.zip '*Color*' '*NormalGL*' '*Roughness*')
curl -L -o /tmp/paving.zip "https://ambientcg.com/get?file=PavingStones131_1K-JPG.zip" && (cd textures/ground/paving && unzip -o /tmp/paving.zip '*Color*' '*NormalGL*' '*Roughness*')
curl -L -o /tmp/plaster.zip "https://ambientcg.com/get?file=Plaster017_1K-JPG.zip" && (cd textures/wall/plaster && unzip -o /tmp/plaster.zip '*Color*' '*NormalGL*' '*Roughness*')
# Tree GLB (Kenney Nature Kit, CC0). If a direct GLB URL is unavailable, download
# the Kenney Nature Kit zip and copy one tree .glb here, renamed tree.glb.
```

After download, **rename** each PBR set's files to a stable scheme so the loader can find them: `color.jpg`, `normal.jpg`, `rough.jpg` in each dir. Example:

```bash
cd textures/ground/asphalt && mv *Color* color.jpg && mv *NormalGL* normal.jpg && mv *Roughness* rough.jpg
# repeat for paving + plaster
```

- [ ] **Step 2: Verify the files exist and are non-trivial**

Run: `cd client/public && ls -lR textures models/nature`
Expected: `waternormals.jpg` (~240KB), `sky_1k.hdr` (~1–4MB), each PBR dir has `color.jpg`/`normal.jpg`/`rough.jpg`, `models/nature/tree.glb` present. If any failed, note it — the code paths in later tasks fall back, but try an alternate CC0 source first.

- [ ] **Step 3: Write the texture-loader helper**

Create `client/app/lib/three/shared/textures.ts`:

```js
// @ts-nocheck -- CC0 texture/HDRI loader with graceful (null) fallback.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export function createTextureLoader({ anisotropy = 4 } = {}) {
  const texLoader = new THREE.TextureLoader();
  const rgbe = new RGBELoader();
  const tracked = [];
  const track = (t) => { if (t) tracked.push(t); return t; };

  // Load an sRGB colour texture; resolves null on error.
  function loadColorTex(url, repeat = [1, 1]) {
    return new Promise((res) => {
      texLoader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = anisotropy; res(track(t));
      }, undefined, () => res(null));
    });
  }
  // Linear data texture (normal / roughness); resolves null on error.
  function loadDataTex(url, repeat = [1, 1]) {
    return new Promise((res) => {
      texLoader.load(url, (t) => {
        t.colorSpace = THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = anisotropy; res(track(t));
      }, undefined, () => res(null));
    });
  }
  // A PBR set in a directory (color.jpg/normal.jpg/rough.jpg). Returns
  // { map, normalMap, roughnessMap } (any may be null).
  async function loadPBR(dir, repeat = [1, 1]) {
    const [map, normalMap, roughnessMap] = await Promise.all([
      loadColorTex(dir + '/color.jpg', repeat),
      loadDataTex(dir + '/normal.jpg', repeat),
      loadDataTex(dir + '/rough.jpg', repeat),
    ]);
    return { map, normalMap, roughnessMap };
  }
  // Equirect HDR → PMREM env texture. Returns { envTex, pmrem } or null.
  function loadHDR(url, renderer) {
    return new Promise((res) => {
      rgbe.load(url, (hdr) => {
        const pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const envTex = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        res({ envTex, pmrem });
      }, undefined, () => res(null));
    });
  }
  function dispose() { for (const t of tracked) t.dispose(); tracked.length = 0; }

  return { loadColorTex, loadDataTex, loadPBR, loadHDR, dispose };
}
```

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: succeeds; `textures.ts` and `RGBELoader` import resolve.

- [ ] **Step 5: Commit (only if authorized)**

```bash
git add client/public/textures client/public/models/nature client/app/lib/three/shared/textures.ts
git commit -m "Bundle CC0 assets (water/HDRI/PBR/tree) + texture-loader helper"
```

> **Note for later tasks:** `worldHanoi.ts` `createVeyraWorld` should instantiate `const texer = createTextureLoader({ anisotropy: q.anisotropy });` once near the other builders (~`:107`) and pass loaded results into the relevant builders. Because loads are async and the world already builds asynchronously after `fetch('/data/hanoi.json')`, kick off the asset loads in parallel with that fetch and `await` them inside `build()` before placing the affected meshes. Free `texer.dispose()` in the world `dispose()`.

---

## Task 1: Remove in-world collectible coins

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (coin state `:190`, helpers `:1386-1392`, spawn loop `:804-813`, collect loop `:1712-1717`)
- Modify: `client/app/features/world/WorldScreen.tsx:52`

**Interfaces:**
- Consumes: nothing.
- Produces: removes `opts.onCoin` usage from the world; `createVeyraWorld` no longer calls `onCoin`. Wallet (`g.addCoins`, `types.ts coins`, HUD, `Coin.tsx`) is untouched and still works.

- [ ] **Step 1: Delete coin state and helpers in `worldHanoi.ts`**

Remove the `const coins = [];` declaration (around `:190`). Remove the entire coin helper block (around `:1386-1392`):

```js
// DELETE this block:
const coinMat = new THREE.MeshStandardMaterial({ color: 0xf3cd84, emissive: 0x8a6a1e, emissiveIntensity: 0.25, metalness: 0.7, roughness: 0.35 });
localMats.push(coinMat);
function spawnCoin(x, z, mat) {
  const g = new THREE.Group(); g.position.set(x, 0.95, z);
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 18), mat || coinMat); c.rotation.x = Math.PI / 2; c.castShadow = true; g.add(c);
  scene.add(g); coins.push({ g, base: 0.95, x, z });
}
```

- [ ] **Step 2: Delete the coin spawn loop**

Remove the block at `:804-813`:

```js
// DELETE:
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
```

- [ ] **Step 3: Delete the per-frame collect loop**

Remove the block at `:1712-1717`:

```js
// DELETE:
for (let ci = coins.length - 1; ci >= 0; ci--) {
  const co = coins[ci];
  co.g.rotation.y += dt * 2.4;
  co.g.position.y = co.base + Math.sin(t * 2 + ci) * 0.12;
  const cd = Math.hypot(pp.x - co.x, pp.z - co.z);
  if (cd < 1.5) { scene.remove(co.g); co.g.children[0].geometry.dispose(); coins.splice(ci, 1); opts.onCoin && opts.onCoin(5); }
}
```

- [ ] **Step 4: Remove the `onCoin` prop in `WorldScreen.tsx`**

At `:52`, delete the line:

```js
onCoin: (n: number) => g.addCoins(n),
```

Leave the surrounding `createVeyraWorld({...})` options object otherwise intact. Also update the comment at `:46` ("/ coins / proximity contract as before.") to drop the "coins" mention.

- [ ] **Step 5: Update the opts doc comment**

In `worldHanoi.ts` header comment (`:5-6`), remove `onCoin(n)` from the documented opts list.

- [ ] **Step 6: Build to verify no references remain**

Run: `cd client && npm run build`
Expected: build succeeds. Grep `client/app/lib/three/worldHanoi.ts` and `WorldScreen.tsx` for `coin` (case-insensitive) — expect zero matches except unrelated ones (there are none in these files after edits).

- [ ] **Step 7: Manual check**

Run the world (`/run`). Expected: no floating gold coins anywhere along the north shore; walking where they used to be triggers no wallet increment; HUD wallet still renders.

- [ ] **Step 8: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts client/app/features/world/WorldScreen.tsx
git commit -m "Remove in-world collectible coins (keep wallet)"
```

---

## Task 2: Fix item placement — façade requirement, building rejection, min-spacing

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (`scatterItems` `:1076-1239`; building polys are available via `buildingPolys` + `addBldgCollision` `:144-152`)

**Interfaces:**
- Consumes: `buildingPolys` (array of `{ poly, minx, maxx, minz, maxz }`), `GCELL`.
- Produces: three local helpers inside `scatterItems` — `pointInBuildings(x, z, margin)`, `nearestFacadeWithin(x, z, side-aware)`, and a `spacingReject(kind, x, z, minDist)` min-spacing grid. Awning/sign/stall/cafe/bike/planter/lamp placements are filtered through them.

> **Why `scatterItems` needs `buildingPolys` populated first:** buildings are added during the city build before `scatterItems(...)` is called at `:709`. Confirm `buildingPolys` is non-empty at that point (it is — building collision is pushed during the merged-city pass earlier in `build()`). If not, move the `scatterItems` call to after building collision is registered.

- [ ] **Step 1: Add a point-in-building test inside `scatterItems`**

At the top of `scatterItems` (after the `add` helper at `:1078`), add:

```js
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
// margin: treat a band `m` metres outside the polygon as "inside" too (keeps
// ground props off the wall). Cheap bbox pre-filter via buildingPolys bounds.
const pointInBuildings = (x, z, m = 0.6) => {
  for (let b = 0; b < buildingPolys.length; b++) {
    const bp = buildingPolys[b];
    if (x < bp.minx - m || x > bp.maxx + m || z < bp.minz - m || z > bp.maxz + m) continue;
    if (ptInPoly(bp.poly, x, z)) return true;
    if (m > 0) {
      // edge-distance check for the margin band
      const poly = bp.poly;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
        const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1;
        let tt = ((x - ax) * ex + (z - az) * ez) / L2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const dx = x - (ax + ex * tt), dz = z - (az + ez * tt);
        if (dx * dx + dz * dz < m * m) return true;
      }
    }
  }
  return false;
};
// Is there a building façade within `r` metres of (x,z)? Used to gate awnings /
// hanging signs so they never float over open ground.
const facadeWithin = (x, z, r = 3.5) => {
  const r2 = r * r;
  for (let b = 0; b < buildingPolys.length; b++) {
    const bp = buildingPolys[b];
    if (x < bp.minx - r || x > bp.maxx + r || z < bp.minz - r || z > bp.maxz + r) continue;
    const poly = bp.poly;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], az = poly[j][1], bx = poly[i][0], bz = poly[i][1];
      const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1;
      let tt = ((x - ax) * ex + (z - az) * ez) / L2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const dx = x - (ax + ex * tt), dz = z - (az + ez * tt);
      if (dx * dx + dz * dz < r2) return true;
    }
  }
  return false;
};
```

- [ ] **Step 2: Add a min-spacing grid inside `scatterItems`**

Right after the helpers above:

```js
// ── Min-spacing: reject a placement of `kind` if another conflicting placement
//    is already within `minDist`. A coarse hash grid keeps this O(1) amortised. ──
const SPACE_CELL = 3;
const spaceGrid = new Map();
const spaceKey = (gx, gz) => gx + '_' + gz;
const spacingOk = (x, z, minDist) => {
  const md2 = minDist * minDist;
  const gx = Math.floor(x / SPACE_CELL), gz = Math.floor(z / SPACE_CELL);
  for (let ax = gx - 1; ax <= gx + 1; ax++) for (let az = gz - 1; az <= gz + 1; az++) {
    const arr = spaceGrid.get(spaceKey(ax, az)); if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const dx = x - arr[i][0], dz = z - arr[i][1];
      if (dx * dx + dz * dz < md2) return false;
    }
  }
  return true;
};
const spaceAdd = (x, z) => {
  const gx = Math.floor(x / SPACE_CELL), gz = Math.floor(z / SPACE_CELL);
  const k = spaceKey(gx, gz); let a = spaceGrid.get(k); if (!a) { a = []; spaceGrid.set(k, a); } a.push([x, z]);
};
```

- [ ] **Step 3: Gate ground props on building rejection + spacing**

In the main road loop, wrap each *ground-contact* push (lamp, planter, bike, and later stall/café) so it is skipped when inside a building or too close to a placed sibling. Replace the lamp push (`:1114`) and planter push (`:1116`) region with:

```js
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
```

For the bike rows (`:1129-1143`), reject inside-building bikes per bike:

```js
for (let k = 0; k <= rowLen; k++) {
  const bx = px + nx * (hw - 0.6) * side + tx * k * 0.85;
  const bz = pz + nz * (hw - 0.6) * side + tz * k * 0.85;
  if (pointInBuildings(bx, bz, 0.3)) continue;
  bikeP.push({ x: bx, z: bz, ry: ry + (Math.PI / 2) * side });
}
```

- [ ] **Step 4: Gate awnings + hanging signs on a real façade**

Replace the awning/sign block (`:1151-1160`) with a façade-gated version:

```js
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
```

- [ ] **Step 5: Gate stalls + cafés (second road loop)**

In the stall/café loop (`:1185-1194`), reject building-overlapping and clustered placements:

```js
if (hash01(px * 0.5 + 2.7, pz * 0.5 - 5.1) < 0.6 * dens) {
  const stx = px + nx * (hw + 0.8), stz = pz + nz * (hw + 0.8);
  const cfx = px - nx * (hw + 1.0), cfz = pz - nz * (hw + 1.0);
  if (!pointInBuildings(stx, stz, 0.8) && spacingOk(stx, stz, 4)) { stallP.push({ x: stx, z: stz, ry: ry - Math.PI / 2 }); spaceAdd(stx, stz); }
  if (!pointInBuildings(cfx, cfz, 0.8) && spacingOk(cfx, cfz, 4)) { cafeP.push({ x: cfx, z: cfz, ry: ry + Math.PI / 2 }); spaceAdd(cfx, cfz); }
}
```

Leave the promenade stalls/cafés (`:1201-1206`) as-is (they are placed on known-open lakeside ground), but still run them through `spacingOk(..., 3)` before pushing.

- [ ] **Step 6: Build + lint**

Run: `cd client && npm run build`
Expected: succeeds. No new ESLint errors in `worldHanoi.ts`.

- [ ] **Step 7: Manual check**

Run the world. Expected: no awnings/signs floating over the lake, parks, or empty intersections; no motorbikes/stalls/stools embedded inside building walls; lamps/stalls no longer doubled-up at junctions.

- [ ] **Step 8: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "Fix street-item placement: façade-gate awnings/signs, reject in-building props, dedup at junctions"
```

---

## Task 3: Real reflective lake with wind-driven ripples

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (water build `:295-320`, fallback water `:382-393`, render loop `:1635` area, weather fetch `:1518-1533`, dispose path)

**Interfaces:**
- Consumes: `environment.sun` (a `THREE.DirectionalLight`, direction = normalized `sun.position` minus camera anchor; use `sun.position.clone().sub(camPos).normalize()` or the sky `sunDir` — see note), `windAmt` (`:1478`), the lake `ShapeGeometry`/oval geometry, `q.tier`.
- Produces: a module-scope `let water = null;` (the `Water` instance) and `let windDir = 0;` state; `water.material.uniforms.time/sunDirection` updated each frame. A procedural normal texture `makeWaterNormals()`.

> **Sun direction note:** `environment.ts` keeps a private `sunDir`. Expose it: add `sunDir` to the object returned by `createEnvironment` (it already returns `sun`). In `environment.ts` return block (`:244-247`), add `sunDir` to the returned object. Then the loop reads `environment.sunDir`.

- [ ] **Step 1: Expose `sunDir` from `environment.ts`**

In `client/app/lib/three/shared/environment.ts`, change the return (`:244-247`) to include `sunDir`:

```js
return {
  sun, hemi, ambient, sky, env, sunDir,
  setTimeOfDay, setWeather, update, dispose,
};
```

(`sunDir` is the existing `const sunDir = new THREE.Vector3(...)` at `:95`; it is kept up to date by `setTimeOfDay`.)

- [ ] **Step 2: Add a procedural water normal-map generator in `worldHanoi.ts`**

Near the other top-level helpers (after `hash01` at `:175`), add:

```js
// Procedural tiling normal map for the lake Water shader (no external assets).
// Layered value-noise → a normal field encoded in RGB, RepeatWrapping so the
// Water shader can scroll/tile it for ripples.
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
    // central-difference gradient → normal
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
```

- [ ] **Step 3: Import `Water` and add lake state**

At the top of `worldHanoi.ts` (with the other imports), add:

```js
import { Water } from 'three/addons/objects/Water.js';
```

Near the runtime-state block (`:178-189`), add:

```js
let water = null;            // Three.js Water (reflective lake)
let waterNormals = null;     // procedural normal texture (freed in dispose)
let windDir = 0;             // radians; ripple scroll direction (from weather)
```

- [ ] **Step 4: Build the `Water` lake (real polygon path)**

Replace the static water mesh creation (`:297-320`) — keep the geometry computation (`waterGeo`), but build a `Water` instead of a plain `Mesh`. Replace from the `const lakeWaterMat = mats.water.clone();` line through `scene.add(lake);`:

```js
// Reflective animated lake surface (Three.js Water) built on the REAL polygon.
// (waterGeo computed above from the Hoan Kiem ShapeGeometry / oval fallback.)
// Prefer the bundled real water normal map; fall back to the procedural one.
waterNormals = await texer.loadDataTex('/textures/water/waternormals.jpg', [1, 1]) || makeWaterNormals(q.tier === 'low' ? 128 : 256);
const reflRT = q.tier === 'high' ? 1024 : q.tier === 'mid' ? 512 : 256;
water = new Water(waterGeo, {
  textureWidth: reflRT,
  textureHeight: reflRT,
  waterNormals,
  sunDirection: new THREE.Vector3(0, 1, 0),
  sunColor: 0xffffff,
  waterColor: new THREE.Color().setHSL(168 / 360, 0.45, 0.22).getHex(), // jade Hoan Kiem
  distortionScale: 2.4,
  fog: !!scene.fog,
  alpha: 0.92,
});
water.position.y = 0.18;
water.rotation.x = 0; // geometry already rotated flat (waterGeo.rotateX above)
scene.add(water);
```

> Note: `waterGeo` was already `rotateX(-Math.PI/2)` at `:317`. `Water` expects a flat geometry in its local XY plane rotated to face up; since `waterGeo` is pre-rotated into world XZ, do **not** re-rotate. Verify visually the surface lies flat at y≈0.18; if it renders vertical, remove the pre-rotation and instead set `water.rotation.x = -Math.PI/2` (mutually exclusive with the geometry rotation). Pick whichever yields a flat lake and delete the other rotation.

- [ ] **Step 5: Build the fallback `Water` (no polygon path)**

Replace the fallback nominal lake (`:382-389`, the `lakeWaterMat` + `CircleGeometry` mesh) similarly:

```js
} else {
  // No water data: a nominal circular jade lake (still reflective).
  lakeR = 110;
  // Prefer the bundled real water normal map; fall back to the procedural one.
waterNormals = await texer.loadDataTex('/textures/water/waternormals.jpg', [1, 1]) || makeWaterNormals(q.tier === 'low' ? 128 : 256);
  const reflRT = q.tier === 'high' ? 1024 : q.tier === 'mid' ? 512 : 256;
  const wGeo = new THREE.CircleGeometry(lakeR, 96); ownedGeoms.push(wGeo);
  water = new Water(wGeo, {
    textureWidth: reflRT, textureHeight: reflRT, waterNormals,
    sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff,
    waterColor: new THREE.Color().setHSL(168 / 360, 0.45, 0.22).getHex(),
    distortionScale: 2.4, fog: !!scene.fog, alpha: 0.92,
  });
  water.rotation.x = -Math.PI / 2; water.position.set(lakeCx, 0.18, lakeCz); scene.add(water);
  // (promenade ring + fence unchanged below)
```

Keep the promenade ring / fence code that follows. Remove the now-unused `lakeWaterMat` clone lines in both paths (the `Water` shader owns its material).

- [ ] **Step 6: Derive a wind direction in the weather fetch**

In the weather fetch handler (`:1518-1533`), after `windAmt = ...` (`:1530`), add a wind direction from the API's `wind_direction_10m` if present, else keep a gentle default. Update the fetch URL `current=` list to include `wind_direction_10m`:

Change the URL (`:1518`) `current=temperature_2m,weather_code,wind_speed_10m,cloud_cover,is_day` →
`current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,cloud_cover,is_day`

Then after `windAmt = ...`:

```js
const windDeg = c.wind_direction_10m;
if (typeof windDeg === 'number') windDir = (windDeg * Math.PI) / 180;
```

- [ ] **Step 7: Animate the lake each frame**

In the render `step` loop, just before `environment.update(dt, camPos);` (`:1635`), add:

```js
if (water) {
  const u = water.material.uniforms;
  // ripple speed tracks real wind; gentle baseline so calm days still shimmer
  u.time.value += dt * (0.4 + windAmt * 1.6);
  // scroll the normal sampling along the wind direction
  if (u.normalSampler && u.normalSampler.value) {
    u.normalSampler.value.offset.set(Math.cos(windDir) * u.time.value * 0.02, Math.sin(windDir) * u.time.value * 0.02);
  }
  u.distortionScale.value = 1.2 + windAmt * 3.0; // choppier when windy
  if (environment.sunDir) u.sunDirection.value.copy(environment.sunDir);
}
```

> If `u.normalSampler` is not the correct uniform name in this Three version, the Water shader in 0.160 names it `normalSampler`; confirm via `Object.keys(water.material.uniforms)` in the console and adjust the offset target accordingly. The `time`, `distortionScale`, and `sunDirection` uniforms are stable.

- [ ] **Step 8: Free the lake in `dispose()`**

In the world's `dispose()`, free the Water render target + normal texture and remove it from the scene. Add:

```js
if (water) {
  scene.remove(water);
  water.geometry?.dispose?.();
  water.material?.dispose?.();
  // Water keeps an internal WebGLRenderTarget for the reflection:
  water.material?.uniforms?.tDiffuse?.value?.dispose?.();
  water = null;
}
if (waterNormals) { waterNormals.dispose(); waterNormals = null; }
```

(The Water render target is held on the mesh; if a `getRenderTarget`/internal field is exposed, dispose it too. At minimum dispose geometry, material, and the normal texture.)

- [ ] **Step 9: Build**

Run: `cd client && npm run build`
Expected: succeeds; `Water` import resolves.

- [ ] **Step 10: Manual check**

Run the world. Expected: the lake reflects the sky, Turtle Tower, and The Huc bridge; the sun's glitter sits on the water and moves with the time-of-day; ripples are gentle on calm data and visibly faster/choppier when the live wind is strong. Confirm the surface is flat at the shoreline (no vertical sheet). Check MID and LOW tiers still run (throttle CPU / set reduced-motion to force LOW) — reflection RT smaller, no crash.

- [ ] **Step 11: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts client/app/lib/three/shared/environment.ts
git commit -m "Reflective wind-driven Hoan Kiem lake via Three.js Water (procedural normals)"
```

---

## Task 4: Cinematic camera — smoothing, dynamic FOV, ground clamp, wider framing

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (camera state `:1275`, clamp config `:187`, camera frame block `:1540-1574`)

**Interfaces:**
- Consumes: `camYaw/camElev/camDist/camDcur`, `pp` (player position), `dt`, `t`, `camera`.
- Produces: smoothed `camYawCur/camElevCur`, a smoothed `lookTarget` vector, a `camSpeed` estimate for FOV; tuned `CAM_ELEV_MAX`, `CAM_MIN`.

- [ ] **Step 1: Widen framing limits**

At `:187`, change:

```js
let CAM_MIN = 12, CAM_MAX = 420, CAM_ELEV_MAX = 1.42;
```
to:
```js
let CAM_MIN = 8, CAM_MAX = 420, CAM_ELEV_MAX = 1.5;
```

(`CAM_ELEV_MAX` is also referenced by the orbit handler at `:1292`; the new value flows through.)

- [ ] **Step 2: Add smoothed camera state**

After the camera state line (`:1275` `let camYaw = 0, camElev = 0.42, camDist = 46, camDcur = 46;`), add:

```js
let camYawCur = camYaw, camElevCur = camElev;        // damped orbit angles
const lookTarget = new THREE.Vector3();               // smoothed look-at point
let lookInit = false;
let baseFov = camera.fov;                             // remember the design FOV
let prevPx = 0, prevPz = 0, camSpeed = 0;             // player speed estimate for FOV
```

- [ ] **Step 3: Replace the camera framing block with damped + cinematic version**

Replace the block at `:1566-1574` (from `// Pull in fast...` through `camPos.copy(camera.position);`) with:

```js
// Frame-rate-independent damping helper.
const damp = (cur, target, lambda) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// Pull in fast (prevent clipping), ease back out slowly (no pop).
camDcur += (wantD - camDcur) * Math.min(1, dt * (wantD < camDcur ? 18 : 3));

// Damp the orbit angles so drags feel weighty, not twitchy.
camYawCur = damp(camYawCur, camYaw, 10);
camElevCur = damp(camElevCur, camElev, 10);

// Player planar speed → a subtle dynamic FOV kick when moving fast.
const inst = Math.hypot(pp.x - prevPx, pp.z - prevPz) / Math.max(dt, 1e-3);
prevPx = pp.x; prevPz = pp.z;
camSpeed = damp(camSpeed, inst, 6);
const fovTarget = baseFov + Math.min(4, camSpeed * 0.5);
camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 4);
camera.updateProjectionMatrix();

const offX = camDcur * Math.cos(camElevCur) * Math.sin(camYawCur);
const offZ = camDcur * Math.cos(camElevCur) * Math.cos(camYawCur);
const offY = camDcur * Math.sin(camElevCur);
camTarget.set(pp.x + offX, pp.y + offY + 1.2, pp.z + offZ);
// Ground/lake clamp: never let the camera drop into the terrain.
if (camTarget.y < 0.8) camTarget.y = 0.8;
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
```

> The collision ray block above (`:1540-1564`) already uses `camYaw`; keep it reading `camYaw` (the input target) so the pull-in anticipates where the camera is heading. Only the final offset uses the damped `camYawCur/camElevCur`.

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual check**

Run the world. Expected: dragging to rotate feels smooth/weighty; the camera trails the avatar slightly while walking; FOV widens a touch at speed and settles when idle; the camera never dips below the ground or into the lake; you can pull back to the aerial survey and zoom in closer than before.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "Cinematic camera: damped follow, dynamic FOV, ground clamp, wider framing"
```

---

## Task 5: Tree sway + interactable marker glow rings

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (tree foliage material `:732`, marker creation in `placeShopsNearNorthShore` `:979`+ and the per-frame marker block `:1576-1581`)

**Interfaces:**
- Consumes: foliage `treeFoliageMat`, `windAmt`, `windDir`, `t`, `interactables`.
- Produces: a `swayUniforms` ref (`{ uTime, uWind, uWindDir }`) updated each frame; a glow ring mesh stored on each interactable as `it.glow`.

- [ ] **Step 1: Inject a sway vertex shader into the foliage material**

Where the foliage material is created (`:732`), attach an `onBeforeCompile` that displaces vertices by a wind-driven sway. Add right after `const treeFoliageMat = new THREE.MeshStandardMaterial({...});`:

```js
const swayUniforms = { uTime: { value: 0 }, uWind: { value: 0 }, uWindDir: { value: 0 } };
treeFoliageMat.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = swayUniforms.uTime;
  shader.uniforms.uWind = swayUniforms.uWind;
  shader.uniforms.uWindDir = swayUniforms.uWindDir;
  shader.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform float uWindDir;\n' + shader.vertexShader;
  // Displace in world-ish XZ by a per-instance-phased sine; stronger near the top.
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     float phase = instanceMatrix[3].x * 0.15 + instanceMatrix[3].z * 0.15;
     float s = sin(uTime * 1.6 + phase) * (0.06 + uWind * 0.22);
     transformed.x += cos(uWindDir) * s * (position.y * 0.5 + 0.5);
     transformed.z += sin(uWindDir) * s * (position.y * 0.5 + 0.5);`
  );
};
```

- [ ] **Step 2: Drive the sway uniforms each frame**

In the render loop, in the interactables block (`:1576`) or just before it, add:

```js
swayUniforms.uTime.value = t;
swayUniforms.uWind.value = windAmt;
swayUniforms.uWindDir.value = windDir;
```

(These are no-ops until the foliage exists; guard not needed — the uniform objects always exist.)

- [ ] **Step 3: Add a glow ring under each interactable marker**

In `placeShopsNearNorthShore` (and any other place that pushes to `interactables` with a `marker`), after the marker is created, add a flat additive ring at ground level. Find where `it.marker` / `markerBaseY` is set and add:

```js
// Pulsing ground glow ring under the marker.
const ringGeo = new THREE.RingGeometry(0.6, 0.95, 28);
ownedGeoms.push(ringGeo);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x66e0d0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
localMats.push(ringMat);
const glow = new THREE.Mesh(ringGeo, ringMat);
glow.rotation.x = -Math.PI / 2; glow.position.set(it.pos.x, 0.08, it.pos.z);
scene.add(glow);
it.glow = glow; it.glowMat = ringMat;
```

> Locate the exact insertion point by reading `placeShopsNearNorthShore` (`:979-1031`) and `poiKiosk`; attach the glow wherever an interactable with a marker is finalized. Use the interactable's `pos` for placement.

- [ ] **Step 4: Animate the glow ring**

In the per-frame interactables loop (`:1576-1581`), extend the body:

```js
for (let i = 0; i < interactables.length; i++) {
  const it = interactables[i];
  if (it.marker) {
    it.marker.rotation.z = t * 1.0 + i;
    it.marker.position.y = it.markerBaseY + Math.sin(t * 1.4 + i) * 0.12;
  }
  if (it.glow) {
    const pulse = 0.35 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2.2 + i));
    it.glowMat.opacity = pulse;
    const s = 1 + 0.08 * Math.sin(t * 2.2 + i);
    it.glow.scale.set(s, s, s);
  }
}
```

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: tree canopies sway, more so when windy; shop/quest/cart markers have a soft pulsing teal ring on the ground.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "Wind tree sway + pulsing interactable glow rings"
```

---

## Task 6: Night emissive by time-of-day + lakeside lantern string

**Files:**
- Modify: `client/app/lib/three/shared/environment.ts` (expose a sun-elevation getter / `nightFactor`)
- Modify: `client/app/lib/three/shared/hanoiItems.ts` (expose the emissive materials `bulb`, `headlight`, sign `sign`, traffic lenses so intensity can be scaled; add a `lanterns(places)` builder)
- Modify: `client/app/lib/three/worldHanoi.ts` (compute night factor each frame; scale emissive; place a lantern string along the north shore)

**Interfaces:**
- Consumes: `environment` sun elevation, `mats`/`items` emissive materials.
- Produces: `environment.getSunElevation()` → radians; `items.setNightFactor(n)` (0..1) scaling emissive intensities; `items.lanterns(places)` → `THREE.Group`.

- [ ] **Step 1: Expose sun elevation from `environment.ts`**

`curElevation` already exists (`:96`). Add a getter to the return object:

```js
return {
  sun, hemi, ambient, sky, env, sunDir,
  setTimeOfDay, setWeather, update, dispose,
  getSunElevation: () => curElevation,
};
```

- [ ] **Step 2: Add `setNightFactor` to `hanoiItems.ts`**

The module already creates emissive materials `bulb` (`:89`), `headlight` (`:90`), the `sign` material inside `hangingSigns` (local), and traffic lenses inside `trafficLights` (local). Promote the sign + lens materials to module scope so they can be scaled. Refactor: move `const sign = M(new T.MeshStandardMaterial({...}))` out of `hangingSigns` to the materials block, and the three lens materials out of `trafficLights`. Then add, near `dispose`:

```js
// Base emissive intensities so setNightFactor can scale from a known zero-point.
const _emissiveBases = [
  [bulb, 1.4], [headlight, 0.9], [sign, 0.18],
];
/** Ramp lamp/sign/lantern glow with night (n=0 day … 1 full night). */
function setNightFactor(n) {
  const k = Math.max(0, Math.min(1, n));
  for (const [m, base] of _emissiveBases) m.emissiveIntensity = base * (0.15 + 1.6 * k);
}
```

Add `setNightFactor` (and a `lanterns` builder, next step) to the returned object.

- [ ] **Step 3: Add a `lanterns(places)` builder in `hanoiItems.ts`**

A string of warm paper lanterns (emissive spheres on a thin wire), instanced:

```js
/* lanterns(places) — warm paper lanterns (emissive) for the lakeside.
 *   places: [{ x, z, y? }]  */
function lanterns(places) {
  const g = new T.Group();
  const n = places ? places.length : 0;
  const bodyGeo = sphere(0.18, 8, 6);
  const lanternMat = M(new T.MeshStandardMaterial({ color: 0xff7a3c, emissive: 0xff5a1e, emissiveIntensity: 0.6, roughness: 0.5 }));
  _emissiveBases.push([lanternMat, 0.6]); // join the night ramp
  const body = imesh(bodyGeo, lanternMat, n, { cast: false });
  for (let i = 0; i < n; i++) {
    const pl = places[i];
    setPart(body, i, pl.x, pl.z, 0, { y: pl.y != null ? pl.y : 4.2, sy: 1.25 });
  }
  return finalize(g, [body]);
}
```

> Order matters: `_emissiveBases` must be declared before `lanterns` and `setNightFactor` reference it. Declare `const _emissiveBases = [...]` once, above both. Adjust Step 2 ordering accordingly.

- [ ] **Step 4: Place a lantern string + drive night factor in `worldHanoi.ts`**

After `dressPromenade(...)` (`:786`), add a lantern string along the north shore:

```js
// Lakeside lantern string (warm emissive at dusk).
const lanternP = [];
for (let i = 0; i < 24; i++) {
  const a = -Math.PI / 2 + (i / 24 - 0.5) * 1.4;
  lanternP.push({ x: lakeCx + Math.cos(a) * (lakeR * 0.9), z: lakeNorthZ - 3 + Math.sin(a) * 4, y: 4.0 + (i % 2) * 0.3 });
}
const lanternGroup = items.lanterns(lanternP);
if (lanternGroup) { lanternGroup.matrixAutoUpdate = false; lanternGroup.updateMatrix(); scene.add(lanternGroup); itemGroups.push(lanternGroup); }
```

In the render loop (near the weather easing, `:1606`), compute and apply the night factor:

```js
// Night factor from real sun elevation: glow ramps up as the sun sets.
const elev = environment.getSunElevation ? environment.getSunElevation() : 1;
const night = Math.max(0, Math.min(1, 1 - elev / 0.5)); // elev<0.5rad starts dusk
items.setNightFactor && items.setNightFactor(night);
```

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world at a dusk/evening time-of-day (or temporarily force `environment.setTimeOfDay(0.95)`): lamps, hanging signs, traffic lenses, and the new lakeside lanterns glow warmly; at midday they are near-neutral. Reset any temporary override.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/shared/environment.ts client/app/lib/three/shared/hanoiItems.ts client/app/lib/three/worldHanoi.ts
git commit -m "Time-of-day night emissive + lakeside lantern string"
```

---

## Task 7: New street props — bicycles + shoulder-pole vendor

**Files:**
- Modify: `client/app/lib/three/shared/hanoiItems.ts` (add `bicycles(places)`, `vendors(places)` builders; export them)
- Modify: `client/app/lib/three/worldHanoi.ts` (`scatterItems` collects + places them with the Task 2 filters; tier caps)

**Interfaces:**
- Consumes: the Task 2 placement filters (`pointInBuildings`, `spacingOk`/`spaceAdd`), `items.bicycles`, `items.vendors`.
- Produces: `items.bicycles(places)` and `items.vendors(places)` returning `THREE.Group`; collision circles for both.

- [ ] **Step 1: Add `bicycles(places)` in `hanoiItems.ts`**

A low-poly bicycle: two thin wheels, a frame bar, a seat, handlebars. Instanced (mirror the `motorbikes` structure but slimmer):

```js
/* bicycles(places) — parked pushbikes leaning along the curb.
 *   places: [{ x, z, ry }]  */
function bicycles(places) {
  const g = new T.Group();
  const n = places ? places.length : 0;
  const wheelGeo = cyl(0.32, 0.32, 0.04, 14);
  const frameGeo = box(0.9, 0.05, 0.05);
  const seatGeo = box(0.18, 0.06, 0.1);
  const barGeo = cyl(0.02, 0.02, 0.44, 6);
  const wheels = imesh(wheelGeo, rubber, n * 2, { color: false });
  const frame = imesh(frameGeo, metalDark, n, { color: true });
  const seat = imesh(seatGeo, rubber, n, { color: false });
  const bars = imesh(barGeo, chrome, n, { color: false });
  for (let i = 0; i < n; i++) {
    const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
    const lean = (rnd(i, 21) - 0.5) * 0.18; // some lean on their kickstands
    setPart(wheels, i * 2 + 0, x, z, ry, { x: -0.5, y: 0.32, z: 0, rx: Math.PI / 2, rz: lean });
    setPart(wheels, i * 2 + 1, x, z, ry, { x: 0.5, y: 0.32, z: 0, rx: Math.PI / 2, rz: lean });
    setPart(frame, i, x, z, ry, { x: 0, y: 0.5, z: 0, rz: lean });
    _c.setHSL(rnd(i, 22), 0.45, 0.45); frame.setColorAt(i, _c);
    setPart(seat, i, x, z, ry, { x: -0.32, y: 0.74, z: 0 });
    setPart(bars, i, x, z, ry, { x: 0.5, y: 0.84, z: 0, rx: Math.PI / 2 });
  }
  return finalize(g, [wheels, frame, seat, bars]);
}
```

- [ ] **Step 2: Add `vendors(places)` in `hanoiItems.ts`**

A gánh hàng rong: a standing figure with a shoulder pole and two hanging baskets. Reuse the people parts conceptually but as a dedicated small builder:

```js
/* vendors(places) — shoulder-pole street vendor (gánh hàng rong).
 *   places: [{ x, z, ry }]  */
function vendors(places) {
  const g = new T.Group();
  const n = places ? places.length : 0;
  const bodyGeo = cyl(0.16, 0.2, 0.95, 8);
  const headGeo = sphere(0.13, 8, 6);
  const hatGeo = cone(0.32, 0.22, 12);     // nón lá
  const poleGeo = cyl(0.02, 0.02, 1.5, 5);
  const basketGeo = cyl(0.26, 0.18, 0.22, 10);
  const body = imesh(bodyGeo, clothTint, n, { color: true });
  const head = imesh(headGeo, skin, n, { color: false });
  const hat = imesh(hatGeo, woodLight, n, { color: false });
  const pole = imesh(poleGeo, wood, n, { color: false });
  const baskets = imesh(basketGeo, woodLight, n * 2, { color: false });
  for (let i = 0; i < n; i++) {
    const pl = places[i]; const x = pl.x, z = pl.z, ry = pl.ry || 0;
    setPart(body, i, x, z, ry, { y: 0.78 }); _c.setHSL(rnd(i, 23) * 0.1 + 0.08, 0.2, 0.55); body.setColorAt(i, _c);
    setPart(head, i, x, z, ry, { y: 1.4 });
    setPart(hat, i, x, z, ry, { y: 1.52 });
    setPart(pole, i, x, z, ry, { y: 1.32, rz: Math.PI / 2 });   // pole across the shoulders (along X)
    setPart(baskets, i * 2 + 0, x, z, ry, { x: -0.7, y: 0.7 });
    setPart(baskets, i * 2 + 1, x, z, ry, { x: 0.7, y: 0.7 });
  }
  return finalize(g, [body, head, hat, pole, baskets]);
}
```

- [ ] **Step 3: Export the new builders**

Add `bicycles, vendors` to the returned object in `createHanoiItems` (`:698-710`).

- [ ] **Step 4: Collect + place in `scatterItems`**

In `scatterItems`, add `bikeP2` (bicycles) and `vendP` arrays alongside the others (`:1080`). In the main road loop, near the motorbike block, add an occasional bicycle and a rare vendor on the sidewalk side, gated by the Task 2 filters:

```js
// occasional parked bicycle on the curb
if (hw >= 2 && hash01(px * 1.3 + 4.1, pz * 1.3 - 6.2) < 0.10 * dens) {
  const side = hash01(px + 2.1, pz) < 0.5 ? 1 : -1;
  const bx = px + nx * (hw - 0.4) * side, bz = pz + nz * (hw - 0.4) * side;
  if (!pointInBuildings(bx, bz, 0.3) && spacingOk(bx, bz, 1.5)) { bikeP2.push({ x: bx, z: bz, ry: ry + (Math.PI / 2) * side }); spaceAdd(bx, bz); }
}
// rare shoulder-pole vendor on a sidewalk
if (hseed > 0.965 && hseed < 0.985) {
  const side = hash01(px + 1.1, pz - 1.1) < 0.5 ? 1 : -1;
  const vx = px + nx * (hw + 0.7) * side, vz = pz + nz * (hw + 0.7) * side;
  if (!pointInBuildings(vx, vz, 0.4) && spacingOk(vx, vz, 3)) { vendP.push({ x: vx, z: vz, ry: hash01(vx, vz) * Math.PI * 2 }); spaceAdd(vx, vz); }
}
```

After the existing caps (`:1208-1218`), add caps + collision + build:

```js
const bike2Cap = q.tier === 'low' ? 60 : q.tier === 'mid' ? 180 : 320;
if (bikeP2.length > bike2Cap) bikeP2.length = bike2Cap;
const vendCap = q.tier === 'low' ? 12 : q.tier === 'mid' ? 30 : 50;
if (vendP.length > vendCap) vendP.length = vendCap;
for (const p of bikeP2) circles.push({ x: p.x, z: p.z, r: 0.5 });
for (const p of vendP) circles.push({ x: p.x, z: p.z, r: 0.6 });
```

And in the build+add section (`:1230-1238`):

```js
add(items.bicycles(bikeP2));
add(items.vendors(vendP));
```

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: occasional leaning bicycles along curbs and rare nón-lá shoulder-pole vendors on sidewalks; none embedded in walls; counts feel sparse, not spammy; LOW tier stays light.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/shared/hanoiItems.ts client/app/lib/three/worldHanoi.ts
git commit -m "Add bicycles + shoulder-pole vendors to street dressing"
```

---

## Task 8: Birds over the lake

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (build a small bird flock; animate in the loop; free in dispose)

**Interfaces:**
- Consumes: `lakeCx`, `lakeCz`, `lakeR`, `t`, `dt`, `q.tier`.
- Produces: a `birds` group with per-bird orbit params; animated each frame.

- [ ] **Step 1: Build a small instanced bird flock**

After the landmarks/lantern placement in `build()`, add (skip entirely on LOW for budget):

```js
// ── Birds: a few low-poly gulls looping over the lake. ──
let birdMesh = null; const birdParams = [];
if (q.tier !== 'low') {
  const BIRDS = q.tier === 'high' ? 14 : 8;
  const birdGeo = new THREE.ConeGeometry(0.18, 0.6, 4); // a simple dart/body
  birdGeo.rotateX(Math.PI / 2);
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
```

> Store `birdMesh` and `birdParams` at module scope (declare `let birdMesh = null; const birdParams = [];` near the other runtime state at `:180`, and assign inside `build()` instead of re-declaring).

- [ ] **Step 2: Animate the flock each frame**

In the render loop, add (near the interactables block):

```js
if (birdMesh) {
  const bm = new THREE.Matrix4(), bp = new THREE.Vector3(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3();
  for (let i = 0; i < birdParams.length; i++) {
    const p = birdParams[i];
    const ang = t * p.sp + p.ph;
    const x = p.cx + Math.cos(ang) * p.r, z = p.cz + Math.sin(ang) * p.r;
    const y = p.h + Math.sin(t * 1.3 + p.ph) * 1.2;
    bp.set(x, y, z);
    // face along the tangent of the circle
    fwd.set(-Math.sin(ang), 0, Math.cos(ang)).normalize();
    bq.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
    bm.compose(bp, bq, bs);
    birdMesh.setMatrixAt(i, bm);
  }
  birdMesh.instanceMatrix.needsUpdate = true;
}
```

> Hoist the scratch `Matrix4/Vector3/Quaternion` allocations above the render loop (reuse across frames) rather than allocating each frame — declare them once near the other loop scratch vars (`tmp`, etc.).

- [ ] **Step 3: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: a handful of pale birds slowly circle above the lake at varying radii/heights; none on LOW tier; no per-frame GC stutter (scratch objects hoisted).

- [ ] **Step 4: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "Add a small bird flock circling the lake"
```

---

## Task 9: PBR ground & wall textures

**Files:**
- Modify: `client/app/lib/three/shared/materials.ts` (`createMaterials` signature + `asphalt`/`paving`/`concrete`/`plaster` materials; `dispose`)
- Modify: `client/app/lib/three/worldHanoi.ts` (load PBR sets via `texer`, pass into materials or assign after build)

**Interfaces:**
- Consumes: `createTextureLoader().loadPBR(dir, repeat)`.
- Produces: `createMaterials(opts)` accepts an optional `pbr` object `{ asphalt, paving, plaster }` where each is `{ map, normalMap, roughnessMap }`; when present the material binds the maps. A new `materials.applyPBR(sets)` late-binder mirrors `setEnvMap` so the async world can attach maps after `createMaterials` runs.

- [ ] **Step 1: Add a late-binder `applyPBR` in `materials.ts`**

After `setEnvMap` (`:519-535`), add:

```js
/** Late-bind CC0 PBR maps onto ground/wall materials (any field may be null). */
function applyPBR(sets) {
  if (!sets) return;
  const bind = (m, s, repeat) => {
    if (!m || !s) return;
    if (s.map) { s.map.repeat.set(repeat, repeat); m.map = s.map; m.color.setScalar(1); }
    if (s.normalMap) { s.normalMap.repeat.set(repeat, repeat); m.normalMap = s.normalMap; }
    if (s.roughnessMap) { s.roughnessMap.repeat.set(repeat, repeat); m.roughnessMap = s.roughnessMap; }
    m.needsUpdate = true;
  };
  // repeat in metres⁻¹: roads tile every ~6 m, paving ~2.5 m, plaster ~3 m.
  bind(asphalt, sets.asphalt, 1 / 6);
  bind(paving, sets.paving, 1 / 2.5);
  bind(concrete, sets.paving, 1 / 2.5);
  bind(plaster, sets.plaster, 1 / 3);
}
```

Add `applyPBR` to the returned object (next to `setEnvMap`, `setWetness`).

> `setWetness` already mutates `roughness` on `groundMats`; with a `roughnessMap` bound, three multiplies the map by `roughness`, so lowering `roughness` still produces the wet sheen. No change needed there.

- [ ] **Step 2: Load PBR sets in `worldHanoi.ts` and bind them**

In `build()`, after `texer` is created and before/around the road + façade meshes are built, load and apply:

```js
const [asphaltSet, pavingSet, plasterSet] = await Promise.all([
  q.tier === 'low' ? null : texer.loadPBR('/textures/ground/asphalt', [1, 1]),
  q.tier === 'low' ? null : texer.loadPBR('/textures/ground/paving', [1, 1]),
  q.tier === 'low' ? null : texer.loadPBR('/textures/wall/plaster', [1, 1]),
]);
mats.applyPBR && mats.applyPBR({ asphalt: asphaltSet, paving: pavingSet, plaster: plasterSet });
```

(LOW tier skips PBR and keeps flat colours. The `Promise.all` resolves `null`s harmlessly.)

- [ ] **Step 3: Free textures**

`texer.dispose()` in the world `dispose()` (added in Task 0 note) frees these. Confirm it is called.

- [ ] **Step 4: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: roads show asphalt grain, sidewalks/promenade show paving, façade walls show plaster texture; wet look still appears in rain; LOW tier still flat-colour and smooth.

- [ ] **Step 5: Commit (only if authorized)**

```bash
git add client/app/lib/three/shared/materials.ts client/app/lib/three/worldHanoi.ts
git commit -m "PBR ground + wall textures (CC0) with procedural fallback"
```

---

## Task 10: HDRI environment (IBL reflections)

**Files:**
- Modify: `client/app/lib/three/shared/environment.ts` (`createEnvironment` signature; `regenEnv` gating; `dispose`)
- Modify: `client/app/lib/three/worldHanoi.ts` (pass `envHdrUrl` into `createEnvironment`)

**Interfaces:**
- Consumes: `RGBELoader` + `PMREMGenerator` (load inside `environment.ts`), `renderer`.
- Produces: `createEnvironment(renderer, scene, { quality, envHdrUrl })`. When the HDRI loads, `scene.environment` = HDRI PMREM and the per-frame `regenEnv()` Sky bake is **disabled** (a `let useHdrEnv = false` flag short-circuits the elevation-threshold rebake in `setTimeOfDay`). Sky dome + sun stay dynamic. Falls back to dynamic Sky-PMREM when the HDRI is absent.

- [ ] **Step 1: Accept `envHdrUrl` and load it**

In `environment.ts`, change the signature (`:19`) to destructure `envHdrUrl`:

```js
export function createEnvironment(renderer, scene, { quality, envHdrUrl } = {}) {
```

Add a flag near `let env = null;` (`:91`):

```js
let useHdrEnv = false;
let hdrEnvRT = null; // PMREM render target for the HDRI (freed in dispose)
```

After the initial `setTimeOfDay(0.5); setWeather({...});` (`:241-242`), kick off the HDRI load (non-blocking):

```js
if (envHdrUrl) {
  import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
    new RGBELoader().load(envHdrUrl, (hdr) => {
      const gen = new THREE.PMREMGenerator(renderer);
      gen.compileEquirectangularShader();
      hdrEnvRT = gen.fromEquirectangular(hdr);
      hdr.dispose(); gen.dispose();
      if (env) { env.dispose(); env = null; }      // drop the Sky-baked env
      scene.environment = hdrEnvRT.texture;
      useHdrEnv = true;
    }, undefined, () => { /* keep dynamic Sky-PMREM on failure */ });
  });
}
```

- [ ] **Step 2: Gate the dynamic rebake**

In `setTimeOfDay`, guard the throttled bake (`:154-157`):

```js
// Throttle the costly PMREM bake: only when elevation moved enough — and never
// once a static HDRI env is bound (it supersedes the Sky-baked reflections).
if (!useHdrEnv && Math.abs(curElevation - lastRegenElevation) > REGEN_ELEVATION_EPS) {
  regenEnv();
}
```

Also guard the `setWeather` bake (`:197`):

```js
if (!useHdrEnv) regenEnv();
```

- [ ] **Step 3: Free the HDRI in `dispose`**

In `environment.dispose` (`:217`), add:

```js
if (hdrEnvRT) { hdrEnvRT.dispose(); hdrEnvRT = null; }
```

- [ ] **Step 4: Pass `envHdrUrl` from `worldHanoi.ts`**

Where `createEnvironment(renderer, scene, { quality: q })` is called (search near `:99`/the setup block), change to:

```js
const environment = createEnvironment(renderer, scene, {
  quality: q,
  envHdrUrl: q.tier === 'low' ? null : '/textures/env/sky_1k.hdr',
});
```

(LOW tier keeps the cheaper dynamic Sky IBL.)

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: glass storefronts, metal, and the lake reflect a richer real sky; the Sky dome + sun still move with time-of-day. Force LOW (reduced-motion) and confirm it still loads with dynamic Sky IBL.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/shared/environment.ts client/app/lib/three/worldHanoi.ts
git commit -m "HDRI IBL environment (CC0) with dynamic-Sky fallback"
```

---

## Task 11: GLTF trees (instanced from a Kenney GLB)

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (tree build `:711-769`)

**Interfaces:**
- Consumes: `createKitLoader().preloadUrls(['/models/nature/tree.glb'])` + `getByUrl`, the wind `swayUniforms` (Task 5).
- Produces: tree trunks + foliage built as InstancedMeshes from the GLB's two meshes; falls back to the existing procedural cylinder+icosahedron trees if the GLB is missing.

- [ ] **Step 1: Preload the tree GLB**

Near the other builders (`:106`), instantiate the kit loader and start the preload alongside the data fetch:

```js
const kit = createKitLoader();
const treeGlbReady = kit.preloadUrls(['/models/nature/tree.glb']);
```

Add the import at the top: `import { createKitLoader } from './shared/assets.js';` (match the existing import style/extension used in this file).

- [ ] **Step 2: Extract GLB meshes and build instanced trees**

In `build()`, `await treeGlbReady;` before the tree section. Replace the trunk/foliage geometry+material setup (`:727-735`) with a GLB-or-procedural pick:

```js
let trunkGeo, foliageGeo, trunkMat, treeFoliageMat, glbTrees = false;
if (kit.hasUrl('/models/nature/tree.glb')) {
  const root = kit.getByUrl('/models/nature/tree.glb');
  const meshes = [];
  root.traverse((o) => { if (o.isMesh) meshes.push(o); });
  // Heuristic: the taller/narrower mesh is the trunk, the bushier is foliage.
  meshes.sort((a, b) => (a.geometry.boundingBox ? 0 : (a.geometry.computeBoundingBox(), 0)));
  if (meshes.length >= 2) {
    // pick by vertex count: foliage usually has more verts
    meshes.sort((a, b) => a.geometry.attributes.position.count - b.geometry.attributes.position.count);
    trunkGeo = meshes[0].geometry; foliageGeo = meshes[meshes.length - 1].geometry;
    trunkMat = meshes[0].material; treeFoliageMat = meshes[meshes.length - 1].material.clone();
    glbTrees = true;
  }
}
if (!glbTrees) {
  trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0);
  foliageGeo = new THREE.IcosahedronGeometry(1, 1);
  ownedGeoms.push(trunkGeo, foliageGeo);
  trunkMat = mats.bark;
  treeFoliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, flatShading: true });
}
localMats.push(treeFoliageMat);
```

- [ ] **Step 3: Adapt the instance transforms to the GLB scale**

The existing loop (`:741-760`) composes per-tree matrices assuming a unit-height trunk + unit-radius foliage. If `glbTrees`, the GLB has its own native size; compute a normalizing scale from the GLB foliage bounding box so the same `height`/`canopyR` logic still reads. Before the loop:

```js
let glbScale = 1, glbTrunkLift = 0;
if (glbTrees) {
  foliageGeo.computeBoundingBox(); trunkGeo.computeBoundingBox();
  const fb = foliageGeo.boundingBox, tb = trunkGeo.boundingBox;
  const glbH = (fb.max.y - tb.min.y) || 1;
  glbScale = 1 / glbH;            // normalize the whole tree to ~1 unit tall
  glbTrunkLift = -tb.min.y * glbScale; // sit the base at y=0
}
```

Then inside the loop, when `glbTrees`, place a **single** instance per tree in one InstancedMesh each (trunk + foliage) using a uniform scale `height * glbScale` and the GLB's own trunk/foliage offset (no separate canopy offset — the GLB already models it):

```js
if (glbTrees) {
  const sc = height * glbScale;
  pos.set(tx, glbTrunkLift * height, tz); scl.set(sc, sc, sc);
  m.compose(pos, qrot, scl); trunks.setMatrixAt(i, m); foliage.setMatrixAt(i, m);
} else {
  // ...existing procedural trunk + offset-canopy transforms unchanged...
}
```

Keep the per-tree foliage tint `setColorAt` only when the foliage material supports `instanceColor` tinting (procedural path). For the GLB path, skip `setColorAt` (the GLB material carries its own colour) — guard with `if (!glbTrees) foliage.setColorAt(i, col);`.

- [ ] **Step 4: Keep the wind-sway shader on the foliage material**

The Task 5 `onBeforeCompile` sway is attached to `treeFoliageMat`. It applies to both the procedural and GLB foliage material (both are `MeshStandardMaterial`). Ensure Task 5's `onBeforeCompile` assignment runs against whichever `treeFoliageMat` this task selected (it does — same variable).

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: trees render as the GLB model, correctly grounded (base at y=0), varied in height, swaying in wind. Rename `tree.glb` temporarily and confirm the procedural trees return (fallback works).

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "GLTF trees (instanced Kenney GLB) with procedural fallback"
```

---

## Task 12: GLTF awnings + stall parasols (citykit, already bundled)

**Files:**
- Modify: `client/app/lib/three/worldHanoi.ts` (`scatterItems` awning build + stall parasol)

**Interfaces:**
- Consumes: `createKitLoader().preloadUrls(['build:detail-awning', 'build:detail-parasol-a'])` + `getByUrl`/`get`, the Task 2 façade-gated awning placements (`awnP`).
- Produces: awnings/parasols placed as instanced GLB clones (capped); falls back to the procedural `items.awnings(...)` / `items.stalls(...)` parasol when the GLB is absent.

- [ ] **Step 1: Preload the citykit detail GLBs**

Extend the kit preload from Task 11:

```js
const kitReady = kit.preloadUrls(['/models/nature/tree.glb', 'build:detail-awning', 'build:detail-parasol-a']);
```

(Use the logical `build:` names — `resolvePath` maps them to `/models/citykit/detail-*.glb`.)

- [ ] **Step 2: Build instanced awnings from the GLB**

In `scatterItems`, after `await`-ing the kit (await it in `build()` before `scatterItems` runs), replace `add(items.awnings(awnP));` with a GLB path + fallback:

```js
if (kit.has('build:detail-awning') && awnP.length) {
  const root = kit.get('build:detail-awning');
  let src = null; root.traverse((o) => { if (o.isMesh && !src) src = o; });
  if (src) {
    const inst = new THREE.InstancedMesh(src.geometry, src.material, awnP.length);
    inst.castShadow = true; inst.frustumCulled = false;
    const mm = new THREE.Matrix4(), pp2 = new THREE.Vector3(), qq = new THREE.Quaternion(), ss = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < awnP.length; i++) {
      const p = awnP[i];
      pp2.set(p.x, 2.4, p.z); qq.setFromEuler(new THREE.Euler(0, p.ry, 0));
      mm.compose(pp2, qq, ss); inst.setMatrixAt(i, mm);
    }
    inst.instanceMatrix.needsUpdate = true; inst.matrixAutoUpdate = false; inst.updateMatrix();
    scene.add(inst); itemGroups.push(inst);
  } else { add(items.awnings(awnP)); }
} else {
  add(items.awnings(awnP));   // procedural fallback
}
```

> Verify the GLB awning's native height/orientation; tune the `y` (2.4) and add a base rotation offset to `qq` if the model faces a different axis. Adjust `ss` scale to match the ~3 m awning width if the GLB is unit-sized.

- [ ] **Step 3: (Optional) stall parasols from `detail-parasol-a`**

If the parasol GLB reads better than the procedural cone, replace the parasol sub-part similarly in the stall placement. Otherwise leave `items.stalls(...)` as-is. Keep this optional to avoid over-reach.

- [ ] **Step 4: Free the kit**

Add `kit.dispose()` to the world `dispose()`.

- [ ] **Step 5: Build + manual check**

Run: `cd client && npm run build` (expect success). Run the world: awnings render as the citykit GLB model over shopfronts (still only where a façade exists, per Task 2); none float; procedural fallback returns if the GLB is removed.

- [ ] **Step 6: Commit (only if authorized)**

```bash
git add client/app/lib/three/worldHanoi.ts
git commit -m "GLTF awnings (citykit) over façades with procedural fallback"
```

---

## Self-Review notes

- **Spec coverage:** Assets→Task 0; A→Task 3 (+ real water normal); B→Task 4; C→Tasks 5 (markers, sway, birds split to 8), 6 (night emissive, lanterns), 7 (props), 11 (GLTF trees), 12 (GLTF awnings); C-steam → cut per spec; D→Task 2; E→Task 1; F (PBR ground/wall)→Task 9; G (HDRI)→Task 10. All spec sections mapped.
- **Type consistency:** `pointInBuildings`/`facadeWithin`/`spacingOk`/`spaceAdd` defined in Task 2 and reused verbatim in Task 7. `setNightFactor`/`lanterns`/`bicycles`/`vendors` defined in `hanoiItems.ts` (Tasks 6–7) and called via `items.*`. `environment.sunDir` (Task 3) and `environment.getSunElevation` (Task 6) both added to the same return object; Task 10 changes the same `createEnvironment` signature/return (coordinate the single edit). `createTextureLoader` (Task 0) → `texer` is consumed by Tasks 3, 9. `createKitLoader`/`kit` is consumed by Tasks 11, 12 (single preload list — merge the URL arrays). `swayUniforms`, `windDir`, `water`, `birdMesh`, `texer`, `kit` are module-scope state declared once.
- **Ordering dependency:** Task 0 (assets + `texer`) before Tasks 3, 9. Task 2 before Task 7 and Task 12 (placement filters + `awnP` reused). Task 5 before Task 11 (sway `onBeforeCompile` attaches to the `treeFoliageMat` that Task 11 may swap to the GLB material — keep the single shared variable). Task 3 adds `windDir` which Task 5 reads — if Task 5 runs first, declare `let windDir = 0;` in Task 5 instead; keep a single declaration. Tasks 11 + 12 share one `kit.preloadUrls([...])` — merge into a single call and one `await`.
- **Async build note:** Tasks 0/3/9/10/11/12 all load assets. Kick every load off in parallel with the existing `fetch('/data/hanoi.json')`, then `await` the needed promises at the top of `build()` (or just before each consuming section). Never block the loader UI longer than the data fetch already does; every load has a procedural fallback so a slow/failed asset degrades gracefully.
- **Verification honesty:** No unit tests fabricated; WebGL/visual work verified by `npm run build` + explicit manual observation checklists + an asset-removal fallback check, per Global Constraints.
```
