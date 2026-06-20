# Hanoi landmarks that open to the public in real time

Date: 2026-06-20
Scope: `client/app/lib/three/worldHanoi.ts` (landmark builders + frame-loop animation).
Optionally `shared/materials.ts` only if a helper is missing. No backend.

## Goal

Add iconic Hanoi public buildings around Hoàn Kiếm whose **open/closed state follows
real Hanoi time** (reusing the existing `hanoiHour()` device-clock → UTC+7). "Open" is a
**visual** state: doors swing open, interior windows glow + a warm light comes on, and a
status sign reads "MỞ CỬA" (green); "closed" → doors shut, dark windows, "ĐÓNG CỬA" (red).
Higher architectural detail than the existing low-poly monuments.

Landmarks (chosen): Đền Ngọc Sơn + cầu Thê Húc, Nhà thờ Lớn (St. Joseph's Cathedral),
Nhà hát Lớn (Opera House), Bưu điện Bờ Hồ (Hanoi Post Office).

## Design references (researched)

- **Ngọc Sơn / Thê Húc**: red arched wood bridge (~"dragon spine"), Đắc Nguyệt gate,
  Confucian temple with curved tiered tiled roofs + red columns. Hours 7:00–18:00.
  *Already built* in `buildBridgeAndTemple` → only retrofit the open mechanic (+ optional gate).
- **St. Joseph's Cathedral**: neo-Gothic, twin square bell towers 31.5 m, grey granite,
  pointed-arch portal, rose window. Visiting ~8:00–20:00.
- **Hanoi Opera House**: French 1911 (Palais Garnier style), bright yellow + white facade,
  Roman Ionic column portico, central dome, grey slate mansard roofs, arched windows,
  balconies. Tours 10:30–12:00; evening shows 19:30–22:00.
- **Hanoi Post Office (Bờ Hồ)**: neoclassical + Art Deco, symmetrical facade, prominent
  **clock tower**, arched windows, red-tiled roof. Business hours ~7:30–21:00.

Opening hours encoded as `ranges: [[startHour, endHour], …]` in Hanoi local hours (0–24):
- Ngọc Sơn `[[7,18]]`, Cathedral `[[8,20]]`, Opera `[[10.5,12],[18,22]]`, Post `[[7.5,21]]`.

## Architecture decision

Build the new landmarks as **inline builder functions in worldHanoi.ts**, matching the
existing pattern (`buildTurtleTower`, `buildBridgeAndTemple`, `buildHoanKiemMonuments`),
rather than the separately-pitched module. Reason: those builders rely on many local
closures (`mats`, `props`, `mossStone`, `darkWood`, `redPaint`, `hsl`, and the `scene` /
`circles` / `localMats` / `ownedGeoms` / `ownedTextures` registries). A module would need
all of them plumbed in — more risk, no real isolation gain. The open/close logic IS
isolated into a small shared helper + a single `landmarks[]` list.

## Open/close mechanic

A `landmarks = []` array of handles, each:
```
{ ranges, openT,
  leaves:   [{ grp, openYaw }],   // hinged doors (reuse the gate/shop swing)
  glowMats: [Material],           // window emissive mats; baseEmissive in userData
  lights:   [PointLight],         // warm interior light(s); baseInt in userData (hi/mid only)
  signOpen, signClosed,           // two makeSign meshes toggled by state
  clock:    { hands… } | null }   // post office: hour/minute hands set to real time
```

Frame loop (added near the gate/shop-door animation):
```
const hr = hanoiHour();
for (const lm of landmarks) {
  const open = lm.ranges.some(([a,b]) => hr >= a && hr < b);
  const tgt = open ? 1 : 0;
  if (Math.abs(lm.openT - tgt) > 0.001) {
    lm.openT += (tgt - lm.openT) * Math.min(1, dt * 2);
    for (const lf of lm.leaves)   lf.grp.rotation.y   = lf.openYaw * lm.openT;
    for (const gm of lm.glowMats) gm.emissiveIntensity = lm.openT * gm.userData.baseEmissive;
    for (const li of lm.lights)   li.intensity        = lm.openT * li.userData.baseInt;
    if (lm.signOpen)   lm.signOpen.visible   = lm.openT > 0.5;
    if (lm.signClosed) lm.signClosed.visible = lm.openT <= 0.5;
  }
}
```
Each landmark's `openT` is **initialized to the current open state** at build time (and the
door/glow/sign set to match) so the world loads in the correct state, then animates only on
transitions. The post-office clock hands are updated every frame from `hanoiHour()`
regardless of open state (a live real-time clock is the signature "real-time" touch).

## Placement

Map orientation: NORTH = −z, SOUTH = +z; lake centre `(lakeCx, lakeCz)`, radius `lakeR`,
north water edge `lakeNorthZ`. Place each landmark on the promenade ring at a setback from
the lake centre, facing inward toward the lake (like the Lý Thái Tổ statue and kiosks) —
this keeps them in the clearer lakeside band, visible from the path, and avoids fighting the
OSM building footprints inland. Approximate real directions:
- Cathedral — **west** (angle ≈ π): `(lakeCx − (lakeR+24), lakeCz − 4)`.
- Opera House — **southeast** (+x,+z): offset ≈ `(lakeCx + (lakeR+24)·0.7, lakeCz + (lakeR+24)·0.7)`.
- Post Office — **east** (+x), north of the Lý Thái Tổ plaza: `(lakeCx + (lakeR+18), lakeCz − lakeR*0.5)`.
Each faces the lake via `g.rotation.y = atan2(lakeCx−x, lakeCz−z)`. Exact offsets tuned in
code/testing; each pushes `circles` collision so the player can't walk through it. Doors
swing toward the lake (the approach side).

## Materials / disposal

Reuse shared `mats.*` where possible (plaster/concrete/glass/metalFrame/steelDark/curb/
paving/roofTile). New per-landmark mats (yellow plaster, grey granite, gilt, warm-glow
emissive) go in `localMats`; all geometries in `ownedGeoms`; `makeSign`/clock CanvasTextures
are disposed via `disposeScene` graph-walk (signs are children of `scene`), with explicit
textures pushed to `ownedTextures` where created directly.

## Fidelity (higher detail) per landmark

- **Cathedral**: nave box (grey granite) + two square bell towers with stepped tops +
  spirelets, pointed-arch portal (openable double door), a glowing rose window, lancet
  windows (emissive), a small cross finial.
- **Opera House**: yellow body + projecting portico of Ionic columns + entablature, a
  central dome (grey) on a drum, mansard side roofs, arched + balustraded windows
  (emissive), grand arched entrance doors (openable).
- **Post Office**: symmetrical pale-yellow body, central **clock tower** with a working
  clock face (two hands set to real Hanoi time), arched ground-floor windows (emissive),
  red-tiled cornice, openable central doors.
- **Ngọc Sơn**: retrofit the existing temple — replace the static door with a hinged leaf
  that swings, add window/lantern emissive glow + a warm light, and a status sign at the
  bridge mouth.

## Risks / mitigations

- **Overlap with OSM buildings / lake water**: placing on the promenade ring at a setback
  outside the water edge keeps them clear; verify each doesn't intersect water or block the
  main lake path; tune offsets.
- **Light budget**: only add interior point-lights on hi/mid tiers; rely on emissive window
  mats on low. Cap to one light per landmark.
- **Perf / draw calls**: ~4 unique landmarks, no instancing (each unique); reuse shared
  geometries where trivial; acceptable (~tens of draw calls).
- **Clock correctness**: hour hand = (hr%12)/12·2π, minute = (min/60)·2π, clockwise from
  12 o'clock; verify orientation on the tower face.

## Out of scope

- Enterable interiors (visual open/close only, per decision).
- Exact geographic placement / true OSM positions.
- Per-day variations / holiday hours.
