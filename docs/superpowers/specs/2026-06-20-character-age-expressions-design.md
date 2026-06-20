# Character: age-parametric avatar with facial expressions & emotes

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — ready for implementation

## Goal

Replace the faceless capsule avatar with an expressive, age-parametric character.
On the setup screen the player picks an **age** (slider, 6–70) and sees a live 3D
preview; the character's body proportions, face, idle behaviour and emotes all
flow from that. The character has facial expressions (blink, happy, surprised,
sad, angry) and basic actions (idle "with soul", walk/run/jump/sit tuned by age,
plus wave and celebrate emotes).

Architecture decision: **evolve the shared `buildAvatar`** (one source of truth
used by the world player, remote players, gate, store and the setup preview).
No external assets — all procedural geometry + canvas textures, matching the
codebase ethos.

Out of scope (v1): real-time broadcast of emotes/expressions to other players
(others see your correct age/look but not your live wave). Gender / hair-style
options are **not** included this round (age + hue + style only).

## 1. Age → proportions (parametric)

Slider age 6–70. `f(age)` drives proportions by **scaling the existing rig**, so
the current `parts` interface and the world loop's walk animation keep working
unchanged.

- `growth t = clamp((age-6)/(20-6), 0, 1)` — childhood → adult by ~20.
- `aging a = clamp((age-50)/20, 0, 1)` — 50 → 70.
- **Body scale** = lerp(0.66, 1.0, t) (≈1.15 m at 6 → ≈1.75 m at ≥20).
- **Head ratio** (head+hair+face sub-group) = lerp(1.35, 1.0, t) — relatively
  larger child head.
- **Aging cues** (`a`): hair lightens + desaturates (grey), slight forward stoop
  (torso tilt), slower idle cadence.

## 2. Face (geometry, on the +z front of a new `headGroup`)

- **Eyes**: 2 white spheres + 2 dark pupils. Blink = squash eye scale-Y → ~0 for
  ~120 ms.
- **Brows**: 2 small dark boxes, tilt per emotion.
- **Mouth**: one mesh whose scale/rotation/position changes (smile up / frown
  down / flat) + a small "open-mouth" sphere toggled for surprise.

## 3. Expressions — `setExpression(name)`

`neutral | happy | surprised | sad | angry`. Each is a preset of (eye openness,
brow tilt, mouth shape) that `update()` lerps toward smoothly. Default `neutral`;
idle occasionally `happy`; jump / nearing an interactable → `surprised`.

## 4. Actions / animation

- **Idle with soul**: subtle breathing, occasional slow head turn/tilt, blinking.
- **Walk/run/jump/sit**: keep the world loop's existing logic, tuned by age
  (young = faster, larger swing; old = slower, stooped).
- **Emotes** `playEmote('wave'|'celebrate')`: wave (right arm raised + waggle +
  happy face) / celebrate (both arms up + small bounce + happy/surprised face).
  `update()` overrides arm rotation while an emote runs; cancels on movement.

## 5. `buildAvatar` API (backward compatible)

Keep `group, parts, mats, acc, setStyle`. Add:
`setAge(age)`, `setExpression(name)`, `playEmote(name)`, `setHue(hue)`,
`update(dt, { moving, running, grounded })`. The world loop calls
`player.update(...)` each frame for blink/idle/expression/emote.

## 6. Setup screen — live 3D preview

- New helper `lib/three/avatarPreview.ts`:
  `createAvatarPreview(container, cfg) → { setAge, setHue, setStyle, dispose }`
  — a mini Three.js scene (one avatar + light + soft backdrop), slow turntable,
  cycling a demo expression.
- `CreateScreen`: replace the 2D `<Avatar>` pedestal with the 3D canvas; add an
  **age slider**; dragging it calls `setAge` live. Persist `age` to `g.player`.

## 7. Data & multiplayer

- `Player.age?: number` (default 24), persisted to localStorage; passed to
  `createVeyraWorld` as `playerAge`.
- Realtime presence payload gains `age`; `makeRemote` builds the avatar at that
  age so others see the correct character.
- v2 (noted, not built): live emote/expression broadcast.

## 8. Emote UI (both triggers)

- **HUD button** opening a small emote popover (wave / celebrate) →
  `worldApi.emote(name)`.
- **Keyboard**: `1` = wave, `2` = celebrate (a keydown listener in `worldHanoi`,
  like the existing dev keys).

## 9. Implementation phases

**Phase 1 — Engine.** Upgrade `avatar.ts` (age proportions + face + expressions +
emotes + `update`); integrate into the world loop (face/idle/emote, age-tuned
walk, emote keys + `emote` API, `makeRemote` accepts age). Defaults age 24 so it
works before the UI exists.

**Phase 2 — Setup UX.** `avatarPreview.ts` + age slider & live 3D preview in
`CreateScreen`; `Player.age` model + persistence + presence sync; emote HUD
button.

## Files touched

`avatar.ts`, `worldHanoi.ts`, `WorldScreen.tsx`, `CreateScreen.tsx`, `types.ts`,
`useGameState.ts`, `realtime.ts`, new `avatarPreview.ts` + an emote-button
component, `strings.ts` / i18n, `globals.css`.

## Testing

- Unit-test the pure logic: `proportions(age)` (scale/headRatio/aging monotonic +
  endpoints), expression preset selection, emote timer/auto-cancel state.
- Geometry/visual correctness verified by running the app (preview screen + world).
