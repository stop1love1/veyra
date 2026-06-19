# Veyra World — Realistic Redesign (flagship)

Date: 2026-06-19
Status: Approved direction; implementation in progress.

## Goal

Replace the "lego" (raw primitive) look of the walkable 3D world with a **true-to-life,
grounded** aesthetic — a **modern open-air commercial street** (open-air lifestyle center)
under natural daylight. No pastel, no glow, no fantasy. Realism comes from **PBR materials +
HDRI/IBL lighting + restrained post-processing**, not from color.

Scope: **World scene only** (`app/lib/three/world.ts`) as the flagship. Gate & store come later.
Characters keep the existing capsule `buildAvatar` for now (known visual tension; later phase).

## Aesthetic principles

1. Materials tell the story, not color. Neutral palette: concrete, stone paving, asphalt,
   glass, brushed/painted metal, wood, real foliage greens.
2. Physical light: one directional sun + IBL environment (PMREM) for real reflections on
   glass/metal. ACES Filmic tone mapping, sRGB output.
3. Real-world scale: **1 world unit ≈ 1 meter**. Storefront ~3.5–4m tall ground floor,
   sidewalk width ~3m, person ~1.8m, streetlight ~5m, door ~2.1m.
4. Restraint. Post-processing subtle: contact AO + a touch of bloom on real night lights only.

## Spatial layout (built during integration, not by sub-agents)

- One **main pedestrian high-street** spine (paved), sidewalks with curbs both sides.
- A **central square** retaining a (realistic) fountain — event/landmark anchor.
- A few **side streets** crossing, irregular widths so it does not read as a wheel.
- Realistic street furniture lining sidewalks (see `streetprops`).
- Keep mechanics: circle+box collision, minimap, proximity-to-enter, joystick, coins,
  weather/time-of-day cycle.

## Module architecture

All new modules live in `app/lib/three/shared/`, are plain ESM with `// @ts-nocheck`,
`import * as THREE from 'three'`, addons from `three/addons/*` (verified available in 0.160.1).
Each module is independently buildable and owned by one agent. Reuse existing
`helpers.ts` (`hsl`, `SKINS`), `controls.ts`, `dispose.ts`, `avatar.ts`.

Convention: every factory returns an object exposing at least `{ dispose() }` when it owns
GPU resources or DOM/listeners. Builders that only add meshes to a passed parent return the
mesh/Group. Disposal of scene meshes is handled centrally by `disposeScene`.

### Contract A — `shared/quality.ts`  (no three addons; reads gl/navigator)
```
export function detectQuality(renderer?) -> {
  tier: 'high' | 'mid' | 'low',
  pixelRatio: number,        // capped DPR per tier (high:2, mid:1.5, low:1)
  shadowMapSize: number,     // 2048 / 1024 / 0(off)
  enablePost: boolean,       // composer at all
  enableSSAO: boolean,
  enableBloom: boolean,
  anisotropy: number,        // 8 / 4 / 1
  propDensity: number,       // 1 / 0.6 / 0.35 multiplier for prop/tree/coin counts
  maxPixelRatio: number,
}
```
Heuristic: `navigator.hardwareConcurrency`, `deviceMemory`, coarse-pointer (mobile),
`renderer.capabilities.maxTextureSize`, prefers-reduced-motion (force low). Pure & deterministic.

### Contract B — `shared/materials.ts`  (THE shared contract everyone codes against)
```
export function createMaterials({ anisotropy = 4, envMap = null } = {}) -> MatLib
```
`MatLib` is an object of ready-to-use `THREE.MeshStandardMaterial` (or `MeshPhysicalMaterial`
for glass/water). Textures are generated procedurally on canvas (noise/value-noise) — albedo +
roughness + normal — tiled with `RepeatWrapping`. `envMapIntensity` set so reflections read.
Required members (stable names — sub-agents rely on these):
```
mat.paving        // light stone slab sidewalk (normal + roughness variation)
mat.asphalt       // dark road surface
mat.concrete      // grey structural concrete
mat.plaster(hue?) // painted façade; optional muted hue tint, low saturation
mat.brick         // optional accent
mat.glassDark     // storefront glass (MeshPhysicalMaterial: transmission/roughness low, env reflect)
mat.metalFrame    // window/door framing (metalness ~0.9, brushed roughness)
mat.steelDark     // poles, bollards, bins
mat.wood          // benches, planters
mat.foliage       // tree/bush leaves (slightly translucent green, roughness high)
mat.bark          // trunks
mat.water         // fountain/puddle (MeshPhysicalMaterial, env reflect, low roughness)
mat.curb          // concrete curb
mat.makeSign(text, opts) -> THREE.Mesh   // canvas-texture storefront sign, realistic
mat.setEnvMap(env)        // late-bind PMREM env to all materials
mat.setWetness(v: 0..1)   // raise reflectivity / lower roughness for rain (puddles/sheen)
mat.dispose()
```
Keep total material/texture count low; share instances. No external image files.

### Contract C — `shared/environment.ts`
```
export function createEnvironment(renderer, scene, { quality }) -> {
  sun: THREE.DirectionalLight,
  hemi, ambient,
  sky,                 // three/addons/objects/Sky.js instance (realistic)
  env: THREE.Texture,  // PMREM environment for IBL (also set scene.environment)
  setTimeOfDay(t01),   // 0..1 → sun elevation/azimuth + color temperature; regenerates env cheaply/throttled
  setWeather(w),       // {overcast,rain} → fog density, sun intensity, sky turbidity
  update(dt, camPos),  // animate, keep sky centered on camera
  dispose(),
}
```
Sets `renderer.toneMapping = ACESFilmicToneMapping`, `toneMappingExposure`, output color space.
Uses `PMREMGenerator` from the Sky for reflections. Shadow camera tuned to the high-street extent.
PMREM regeneration must be throttled (e.g. only on notable sun change), not every frame.

### Contract D — `shared/postfx.ts`
```
export function createComposer(renderer, scene, camera, { quality }) -> {
  composer, render(dt), setSize(w,h), dispose(),
}
```
Pipeline (each gated by quality flags): RenderPass → (SSAOPass or GTAOPass, half-res, subtle) →
UnrealBloomPass (high threshold ~0.9, low strength ~0.25 — only real lights bloom) →
OutputPass → FXAA/SMAA → subtle Vignette. If `!quality.enablePost`, `render()` falls back to
`renderer.render(scene,camera)` and `composer` is null. Must handle resize and dispose targets.

### Contract E — `shared/streetprops.ts`  (depends on MatLib from Contract B)
```
export function createStreetProps(mats) -> {
  streetlight(), bench(), planter(withTree?), bin(), bollard(),
  tree(scale), crosswalk(width,length), trafficSign(kind), parasol(hue), awning(width,hue),
  // each returns a THREE.Group positioned at origin; caller places/rotates it.
}
```
Realistic proportions (meters). Use `InstancedMesh` internally where a prop repeats many leaves
(tree foliage). `castShadow`/`receiveShadow` set appropriately. No lights inside (streetlight
emissive bulb only; night PointLights added sparingly by integrator if perf allows).

### Contract F — `shared/buildings.ts`  (depends on MatLib from Contract B)
```
export function createBuildings(mats) -> {
  storefront({ width=8, depth=7, floors=2, hue?, real=false, name?, signHue? }) -> {
    group: THREE.Group,           // positioned at origin, faces +Z (toward street)
    footprint: { w, d },          // for box collision
    entrance: THREE.Vector3,      // local door position (for proximity marker)
    markerAnchor: THREE.Vector3,  // where integrator hangs the "enter" marker (real shops)
  }
}
```
Ground floor: large recessed glass storefront (`glassDark`) with `metalFrame` mullions, real
door, awning, illuminated sign (`mats.makeSign`). Upper floors: plaster/concrete façade with
realistic punched windows (glass + frame), parapet/cornice. Subtle variation by a seed derived
from position so the street isn't uniform. Keep poly/material budget modest.

## Integration (sequential, by the lead — not sub-agents)

Rewrite `app/lib/three/world.ts` to:
1. Bootstrap renderer (ACES via environment.ts), `detectQuality`, composer.
2. Build layout: asphalt high-street + paved sidewalks + curbs + crosswalks + central square +
   fountain + side streets, using `materials`, `buildings`, `streetprops`.
3. Place real shops (interactive, from `opts.shops`) along the high-street near the square;
   fill remaining frontage with generic storefronts. Build collision from footprints.
4. Wire `environment` (sun/sky/IBL/fog), tune the weather cycle to realistic (overcast softens
   shadows + lowers exposure; rain → `mats.setWetness`, puddle reflections, rain particles).
5. Keep: player avatar, coins, minimap, proximity, joystick (shared `controls`), keyboard.
6. Add: pause render loop on `document.hidden` (visibilitychange); dispose composer + env +
   materials + props in `dispose()` alongside `disposeScene`.
7. Camera: realistic FOV ~52, slightly lower default elevation (street feel), distance fog.

Refactor world.ts to consume existing `shared/controls.ts`, `shared/dispose.ts`,
`shared/helpers.ts` instead of its inline copies.

## Quality / perf targets

- High tier: 60fps target desktop / strong mobile, full post.
- Mid: 30–60fps, SSAO off or half, reduced props (`propDensity`).
- Low: composer off, shadows off, DPR 1, fewest props — must still run.
- Always: pause when tab hidden; cap DPR; reuse materials; dispose everything.

## Non-goals (YAGNI)

- No external GLTF models or downloaded textures/HDRIs.
- No character/avatar realism pass (separate later phase).
- No gate/store redesign yet.
- No networking/multiplayer.

## Testing / verification

- `npm run build` (Next 16) must pass with no type errors (modules are `@ts-nocheck` but imports
  must resolve).
- Manual: `npm run dev`, load world, confirm: renders, walks, enters shop, weather cycles,
  no console errors, dispose on unmount (mount/unmount twice — no leak/error), low-tier path
  by forcing `tier='low'`.
```
```
