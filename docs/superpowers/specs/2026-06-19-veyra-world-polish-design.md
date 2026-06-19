# Veyra 3D World Polish — Design Spec

**Date:** 2026-06-19
**Scope:** The active Hanoi world only — [`client/app/lib/three/worldHanoi.ts`](../../../client/app/lib/three/worldHanoi.ts) (`createVeyraWorld`) and the shared modules it consumes (`shared/materials.ts`, `shared/environment.ts`, `shared/hanoiItems.ts`). Legacy engines (`world.ts`, `worldKit.ts`, `mapLoader.ts`) are **out of scope**.

## Goal

Polish the realistic Hoan Kiem world: a real reflective lake with wind-driven ripples, a more cinematic camera, livelier item effects, fixes for buggy item placement, and removal of the in-world collectible coins. **External CC0 assets** (textures, HDRI, GLTF models) are now used to raise fidelity, bundled locally under `client/public`.

---

## External assets (CC0, bundled in `client/public`)

The prior "procedural-only" rule is **lifted** for this work. All assets are CC0/MIT, downloaded once into `client/public/textures/` and `client/public/models/`, served locally (offline-safe). The existing GLB loader [`shared/assets.ts`](../../../client/app/lib/three/shared/assets.ts) (`createKitLoader`) is reused; a small texture-loader helper is added.

**Asset manifest** (exact picks finalized during execution; sources are CC0):

| Asset | Use | Source | Local path |
|---|---|---|---|
| `waternormals.jpg` | Lake `Water` normal map | three.js examples (MIT/CC0) | `client/public/textures/water/waternormals.jpg` |
| Sky HDRI `.hdr` (1–2k, partly-cloudy day) | IBL env reflections | Polyhaven (CC0) | `client/public/textures/env/sky_1k.hdr` |
| Asphalt PBR (albedo/normal/rough, 1k) | Road material | ambientCG / Polyhaven (CC0) | `client/public/textures/ground/asphalt/*` |
| Paving PBR (1k) | Sidewalk/promenade material | ambientCG / Polyhaven (CC0) | `client/public/textures/ground/paving/*` |
| Plaster PBR (1k) | Façade/wall material | ambientCG / Polyhaven (CC0) | `client/public/textures/wall/plaster/*` |
| Tree GLB | Tree canopy/trunk | Kenney Nature Kit (CC0) | `client/public/models/nature/tree.glb` |
| (existing) citykit `detail-awning`, `detail-parasol-*`, `detail-overhang` | Awnings / stall parasols | Kenney City Kit (already bundled) | `client/public/models/citykit/` |

**Performance/fallback rules:** every asset load is guarded — if a fetch fails (offline build), the code **falls back to the existing procedural path** (canvas normal map for water, Sky-PMREM for env, flat-colour materials for ground/wall, procedural trees/awnings). Nothing hard-fails on a missing asset. Texture resolution and which assets load are gated by `q.tier` (LOW may skip HDRI/PBR and keep flat colours).

---

## A. Lake — real planar reflection + wind-driven ripples

**Current:** A static jade `MeshPhysicalMaterial` `ShapeGeometry` mesh at `y=0.18` ([worldHanoi.ts:295-320](../../../client/app/lib/three/worldHanoi.ts#L295)). No animation, no real reflection.

**Change:** Replace the water mesh with Three.js **`Water`** (`three/addons/objects/Water.js`) using the **same real Hoan Kiem polygon geometry** (the existing `ShapeGeometry`, including the oval fallback path).

- Feed `Water` the **real `waternormals.jpg`** (bundled, RepeatWrapping); fall back to a canvas-generated normal map only if the texture 404s.
- Configure: `waterColor` jade (Hoan Kiem green), `sunColor` from the environment sun, `distortionScale` and normal-map `size` (ripple scale), `alpha ≈ 0.92`, `fog: true`.
- Per frame (in the render loop):
  - Advance `water.material.uniforms.time` by `dt * (BASE_SPEED + windAmt * WIND_SPEED_K)` so ripple speed tracks the **real wind magnitude** (`windAmt`, already derived from open-meteo at [worldHanoi.ts:1530](../../../client/app/lib/three/worldHanoi.ts#L1530)).
  - Bind `uniforms.sunDirection` to the live `environment.sun` direction so the sun glitter tracks the real time-of-day.
  - Rotate the normal-sampling direction by a `windDir` value (slowly-varying; derived in the weather fetch, defaulting to a gentle constant when absent).
- Keep the existing sunk lake-bed slab under the water (reads as depth through the semi-transparent surface).
- Keep the existing lake collision fence and promenade unchanged.

**Performance:** `Water` adds one reflection render pass. Reflection render-target size scales by tier: HIGH `1024`, MID `512`, LOW `256`. Real reflection stays the default on all tiers (per user choice); only RT resolution drops on weaker hardware. The reflection camera renders the full scene, so the Turtle Tower, The Huc bridge and shoreline buildings reflect in the lake.

**New state:** add `windDir` alongside `windAmt`; both read in the loop.

---

## B. Camera — cinematic feel, better collision, wider framing

**Current:** Orbit (yaw/elev/dist) + a building-only pull-in ray, `lerp(pos, dt*6)`, `lookAt(player + 1.5)` ([worldHanoi.ts:1540-1574](../../../client/app/lib/three/worldHanoi.ts#L1540)).

**Changes:**
1. **Cinematic smoothing** — frame-rate-independent damping (`1 - exp(-k*dt)`) applied separately to camera distance, the orbit angles, and a smoothed *look target* (so the camera trails the player slightly instead of snapping). Smooth zoom easing curve.
2. **Dynamic FOV** — widen FOV by a small amount (e.g. +4°) as the player's planar speed rises, eased back when idle. Subtle.
3. **Collision** — keep the existing building pull-in ray; add a **vertical clamp** so the camera never drops below `y ≈ 0.8` (no clipping under ground/lake) and ease any pop.
4. **Wider framing** — raise `CAM_ELEV_MAX` modestly for a more top-down option and lower `CAM_MIN` slightly for a closer third-person; keep the existing aerial-survey `CAM_MAX`.

---

## C. Item / world effects (livelier)

Performance-bounded additions. The heavy "steam/smoke at stalls" idea is **cut** (YAGNI).

1. **Interactable markers (light)** — add a pulsing emissive ground ring under each shop/quest/cart marker; glow plays into the existing bloom. Existing bob animation kept.
2. **Tree sway (light, on-theme)** — foliage `InstancedMesh` gets a vertex sway via `material.onBeforeCompile`, driven by `time + windAmt + windDir`. Reuses the existing foliage mesh; near-free.
3. **Birds (light)** — a handful of instanced birds looping slow paths over the lake.
4. **Night emissive by time-of-day (medium)** — when the sun is low, lamp bulbs, hanging-sign boards, traffic lenses, a new lakeside lantern string, and shopfront glass ramp up `emissiveIntensity`, interpolated from the environment's sun elevation. A single shared "night factor" (0..1) computed once per frame and pushed to the relevant materials.
5. **More prop variety (medium)** — add 1–2 new instanced item builders in `hanoiItems.ts`: **bicycles** and a **shoulder-pole vendor (gánh hàng rong)**; placed by `scatterItems`, capped per tier. (A lakeside **lantern string** is added for #4.)
6. **GLTF trees (medium)** — replace the procedural foliage/trunk instances with an instanced **Kenney tree GLB** (geometry+material extracted from the GLB, built into two InstancedMeshes as today). Keep the wind-sway shader (Task C.2) on the GLB foliage material. Falls back to the current procedural trees if the GLB is missing. Dense crowds (motorbikes, people) **stay procedural+instanced** — instancing thousands of multi-mesh GLBs is too heavy; this is a deliberate performance decision.
7. **GLTF awnings / stall parasols (light)** — use the already-bundled citykit `detail-awning` / `detail-parasol-*` GLBs (instanced) in place of the procedural awning/parasol where it reads better; procedural fallback retained.

---

## F. PBR ground & wall textures

Apply **CC0 PBR texture sets** (albedo + normal + roughness, 1k, RepeatWrapping with repeat tuned in metres) to the existing materials in `shared/materials.ts`:
- `asphalt` (roads), `paving`/`concrete` (sidewalks, promenade), `plaster` (façade walls).
- Loaded via a new texture-loader helper; **falls back to the current flat HSL colours** if a set is missing or on LOW tier.
- `setWetness` continues to work (it tweaks `roughness`/`envMapIntensity`; with a roughness *map* present, scale `roughnessMap` influence via the material's `roughness` multiplier — keep wet-look behavior).

## G. HDRI environment (IBL reflections)

Load a **CC0 sky HDRI** (`.hdr`, 1–2k) via `RGBELoader` → `PMREMGenerator` and set it as `scene.environment` so glass, metal, and the lake reflect a real sky.
- Integrated into `shared/environment.ts`: `createEnvironment(renderer, scene, { quality, envHdrUrl })`. When `envHdrUrl` loads, it becomes the IBL env map and the **per-frame Sky→PMREM rebake is disabled** (saves cost). The visible `Sky` dome + dynamic sun are **kept** for time-of-day mood.
- **Tradeoff (accepted):** base reflections no longer shift with time-of-day; the dynamic sun + Sky dome still convey it. The dusk night-emissive feature (Section C.4) is unaffected (it scales material emissive, not the env).
- Falls back to the existing dynamic Sky-PMREM IBL if the HDRI is missing or on LOW tier.

---

## D. Item placement bug fixes (in `scatterItems`)

1. **Floating awnings / hanging signs** — only emit an awning/sign placement when a **building polygon exists within ~3–4 m** on that side; orient the awning/sign to face out from that wall. Eliminates tarps/boards floating over open space.
2. **Items inside/over buildings** — reject any placement whose point falls **inside or within a small margin of a building polygon** (point-in-polygon against the existing `buildingPolys`, accelerated by the existing `gridB` spatial hash — built earlier or via a local pass).
3. **Overlap clusters at intersections** — a lightweight **min-spacing grid**: reject a new placement of a given kind if another placement of a conflicting kind is already within a small radius. Removes double-dressing where roads share junction vertices.

These run during placement collection, before the instanced builders are called.

---

## E. Remove in-world collectible coins

Remove only the **in-world coin pickups**; the game's `coins` wallet/currency (earned via trade/quests, shown in HUD) is **kept**.

- Delete from `worldHanoi.ts`: the `coins` array, `spawnCoin`, `coinMat`, the spawn loop ([:804-813](../../../client/app/lib/three/worldHanoi.ts#L804)), and the per-frame collect loop ([:1712-1717](../../../client/app/lib/three/worldHanoi.ts#L1712)).
- Remove the `onCoin` wiring from the world: drop `opts.onCoin` usage in `worldHanoi.ts` and the `onCoin: (n) => g.addCoins(n)` prop passed in [WorldScreen.tsx:52](../../../client/app/features/world/WorldScreen.tsx#L52).
- Leave `useGameState.addCoins`, `types.ts` `coins`, the HUD coin display, and `Coin.tsx` untouched.

---

## Testing / verification

- Build the client (`next build` / typecheck) — no type or lint regressions in touched files.
- Manual run of the world (per `/run`): lake shows moving reflections of sky + Turtle Tower + bridge; ripples visibly speed up under stronger wind; no awnings/signs float over open ground; no items embedded in buildings; no coin pickups present; camera follows smoothly without clipping under terrain; trees sway; lamps/signs glow at dusk.
- Tier check: verify MID/LOW still run smoothly (reflection RT downscaled; new props capped; HDRI/PBR may be skipped on LOW).
- Asset fallback: temporarily rename an asset dir and confirm the world still builds via the procedural fallback (no hard crash, just lower fidelity).

## Out of scope

- Legacy engines (`world.ts`, `worldKit.ts`, `mapLoader.ts`).
- The coin economy / wallet / level system.
- Steam/smoke particles (cut).
