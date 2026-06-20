# Store interior: roomier space, floor-select elevator, wall-safe camera

Date: 2026-06-20
Scope: `client/app/lib/three/store.ts` (engine) + `client/app/features/store/StoreScreen.tsx` (UI)
+ `client/app/data/strings.ts` (i18n) + `client/app/globals.css` (styles).
Outdoor world (`world.ts` / `worldHanoi.ts`) is untouched.

## Problem

Inside the walkable 3D shop (`createVeyraStore`):

1. **Camera clips walls.** The orbit camera orbits the player with `dist` up to 22 in a
   room whose walls are only ~10m away, so rotating pushes the camera behind/through walls.
   It reads as the camera "getting stuck on walls" and being hard to move.
2. **Cramped interior.** Each floor is a fixed ~21×23m box with 4.2m walls; upper floors are
   sparse. Feels boxy.
3. **Elevator has no floor buttons.** Today it auto-cycles: stand on the pad → after a short
   dwell it rises one floor, wrapping to 0 after the top. The user wants to *pick* a floor.

## Goals

- Camera never goes behind/through a wall while orbiting; rotation stays smooth at any yaw.
- Roomier, airier interior: larger footprint + taller ceiling, relaid-out fixtures/stairs/
  elevator so movement doesn't snag, plus light interior detailing.
- Elevator is button-driven, via **both** an on-screen floor panel (shown when near the
  elevator) **and** tappable 3D buttons in the cabin. Buttons reflect the live floor state.

## Design

### Part 1 — Camera spring-arm (wall collision)

Each floor's interior is a known axis-aligned box. After computing the desired camera
position `followPos = player + offset(yaw, elev, dist)` each frame, clamp the *effective
distance* so the camera point stays inside the current floor's interior box, inset by a
margin (`CAM_MARGIN ≈ 0.6`) and below the ceiling:

- Interior bounds: `x ∈ [-RX+CAM_MARGIN, RX-CAM_MARGIN]`, `z ∈ [-RZ+CAM_MARGIN, RZ-CAM_MARGIN]`,
  `y ∈ [floorBase+0.4, floorBase+wallH-0.3]`.
- From the pivot (player head, `pp + (0, eyeY, 0)`) along the camera direction, compute the
  largest `t ≤ dist` that keeps `pivot + dir*t` inside the box (slab test against the 3 axis
  pairs, take the nearest positive hit). Use that clamped distance to build `followPos`.

This is pure AABB math (no raycast), so it is allocation-free and cheap. Result: the camera
is always inside the room → never clips walls, and naturally pulls in near corners. The
existing `dist`/zoom controls still work; they're just capped by geometry when needed.

Inspect-mode camera framing is left as-is (it dollies to a pedestal and is already bounded).

### Part 2 — Roomier interior + relayout + detail

Promote the hard-coded room dimensions to tuned constants and let dependent geometry scale:

- `RX 10.5 → 13`, `RZ 11.5 → 14.5`, `wallH 4.2 → 5.2` (`floorH` follows).
- **Lamp grid** spread to the new footprint (keep the low-tier thinning rule).
- **Stairs**: widen the flight slightly and re-derive `zStart`/`zEnd`/corner inset from
  `RX`/`RZ` so flights still seat in the back corners without overlapping fixtures.
- **Product slots**: respace the 6-slot local layout to the wider room (push side columns
  out toward the new walls, keep the stair corners + elevator shaft clear).
- **Elevator shaft** back-center position re-derived from `RZ`.
- **Wall clamp** for the player (`pp.x/pp.z`) updated to the new `RX`/`RZ`.
- **Detail**: skirting trim strip along the wall base per floor; potted plants on upper
  floors too (not just floor 0); a low advisor counter near the NPC. Kept low-poly/flat to
  avoid perf cost.

All magic numbers that depend on room size are derived from the constants so the room can be
retuned without hunting coordinates.

### Part 3 — Elevator floor selection (engine)

Replace the auto-cycle state machine with an explicit target:

- State: `'idle' | 'moving'`. Remove `'dwell'` and the auto-rise on pad-dwell.
- New `goToFloor(n)`: if `n` is a valid floor `≠ curFloor` and not already moving, set
  `fromY=baseY(curFloor)`, `toY=baseY(n)`, `nextFloor=n`, `state='moving'`. Works whether the
  player is on the pad or merely near it — the existing `moving` branch recenters the player
  onto the shaft (`ex,ez`) and carries them vertically, so a multi-floor ride animates
  directly from current to target with an ease-in-out.
- 3D cabin buttons: a vertical strip of `FLOORS` small button meshes on the cabin back panel,
  bottom = floor 1. Each frame, the button matching `curFloor` (idle) or `nextFloor` (moving,
  pulsing) is lit; others use the dim button material. Button meshes are recorded with their
  floor index for hit-testing.
- Tap-to-press: on a pointer *tap* (pointerup with negligible drag, not a camera-rotate
  drag), raycast from the camera through the tap point against the recorded button meshes;
  a hit calls `goToFloor(thatFloor)`. This runs alongside the orbit controller, which only
  acts on drags, so it doesn't fight camera rotation. Inspect mode suppresses it.
- New constructor option `onElevator(state)` fires whenever the elevator's `curFloor` or
  `moving` flag changes, with `{ curFloor, moving, floors }` (0-indexed `curFloor`).
- Returned API gains `goToFloor(n)` and `floors` (count).

### Part 4 — StoreScreen UI + i18n + CSS

- `Store3D` passes `onElevator` into `createVeyraStore` and stores `{curFloor, moving, floors}`
  in state.
- When `near.type === 'elevator'`, instead of the generic CTA prompt, render a floor-picker:
  the existing glass prompt card with a row of `Tầng 1..N` buttons (1-indexed labels),
  current floor highlighted/disabled, others call `api3d.current.goToFloor(n-1)`. While
  `moving`, buttons are disabled and the card shows a "moving" hint.
- New i18n keys in `STR`: `elevator` (vi: "Thang máy" / en: "Elevator"),
  `pickFloor` (vi: "Chọn tầng" / en: "Pick a floor"),
  `floor` (vi: "Tầng" / en: "Floor"),
  `elevatorMoving` (vi: "Đang di chuyển…" / en: "Moving…").
- CSS: a small `.v-floor-pick` row (reusing the glass card) for the floor buttons.

## Data flow

```
tap on cabin button ─┐
on-screen floor btn ─┴─> goToFloor(n) ─> elevator.state='moving'
   frame loop animates platform + carries player ─> on arrival curFloor=n
   ─> onElevator({curFloor,moving,floors}) ─> StoreScreen state ─> panel + (lit button via frame)
```

## Risks / mitigations

- **Magic-number ripple (Part 2):** enlarging the room touches stairs, slots, lamps,
  elevator, wall clamps. Mitigation: derive all from the room constants; manually verify
  walking each floor, climbing stairs, and riding the elevator after the change.
- **Tap vs. drag ambiguity (Part 3):** a press that also rotates the camera must NOT count
  as a button tap. Mitigation: only treat as a tap if total pointer movement < ~6px and
  duration is short, and only when not inspecting.
- **Stairs vs. elevator reachability:** ensure relaid-out fixtures never block the stair
  footprint or elevator pad on any floor.

## Out of scope

- Outdoor world camera/space.
- Persisting elevator floor between visits.
- Real call-from-other-floor queueing (single rider model is fine here).
