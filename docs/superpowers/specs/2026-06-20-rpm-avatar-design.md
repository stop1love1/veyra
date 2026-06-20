# Ready Player Me avatars (rigged GLB) replacing the procedural character

**Date:** 2026-06-20
**Status:** Approved (brainstorming) — autonomous execution authorized by the user
("tạo agent team: code, review, ba … bạn tự quyết định mọi thứ").

## Goal

Replace the procedural capsule avatar everywhere (local player, remote players,
NPCs) with **Ready Player Me (RPM) rigged GLB characters**: full skeletal
animation for actions and ARKit morph targets for facial expressions. The user
creates their own avatar via the RPM creator; the app stores the GLB URL, loads
it at runtime, and lets the user pick expressions and actions from an in-world UI.
The procedural avatar is retained as a hidden fallback so a failed load never
leaves a player invisible.

## Autonomous decisions (open items resolved)

- **RPM subdomain**: default `demo.readyplayer.me`, overridable via
  `NEXT_PUBLIC_RPM_SUBDOMAIN`. Loading an existing GLB by URL needs no subdomain;
  only the creator iframe does.
- **Assets at runtime, not pre-bundled**: avatar GLBs come from the RPM CDN
  (`models.readyplayer.me`); the animation clips come from the open-source RPM
  animation library, loaded from a configurable `NEXT_PUBLIC_RPM_ASSET_BASE`
  (defaults to a public CDN/raw URL). A `scripts/fetch-rpm-assets.js` vendors them
  into `/public/models/` for offline/production. The browser fetches at runtime,
  so the app works end-to-end without the agent pre-downloading anything.
- **Default sample avatar**: a known-good public RPM GLB URL ships as the default
  so the world renders a rigged character before the user makes their own.
- **Performance**: cache loaded GLBs + animation clips by URL; cap concurrent
  loads; NPCs share 1–2 preset avatars; hide/freeze distant avatars; procedural
  fallback on any load error.

## Architecture

A new `glbAvatar.ts` mirrors the procedural `buildAvatar` interface
(`group`, `update(dt, state)`, `setExpression(name)`, `playAction(name)`,
`isEmoting()`, `dispose()`), so `worldHanoi` / preview / remotes swap with minimal
change. A `createAvatar(cfg)` factory returns a GLB avatar when a URL is present
and loads, else the procedural one. Raw three.js + GLTFLoader + DRACOLoader +
AnimationMixer (no React-Three-Fiber).

### Unit: `glbAvatar.ts`
- **Load**: GLTFLoader + DRACOLoader (RPM GLBs are draco-compressed) → returns a
  group + a `ready` promise. Shadows, scale (~1 unit = 1 m; RPM is ~1.7 m so no
  rescale), feet at y=0.
- **Animations**: an `AnimationLibrary` loads clip GLBs once (cached) and retargets
  by bone name onto the RPM rig (RPM clips are authored for the RPM skeleton).
  Locomotion state machine: cross-fade idle ↔ walk ↔ run from `state.moving` /
  `state.running`; one-shot emotes (wave/dance/bow/clap/point/arms-crossed/think)
  that fade back to locomotion; sit/jump hooks from the existing loop state.
- **Expressions**: presets (neutral/happy/surprised/sad/angry) → ARKit morph
  influences (`mouthSmile`, `jawOpen`, `browInnerUp`, `browDownLeft/Right`,
  `eyeWide`, `eyeSquint`, `mouthFrown`, `eyeBlink_L/R`); auto-blink; lerp in
  `update()`. Pure morph-name→preset mapping is unit-testable.

### Unit: `avatarFactory.ts` (`createAvatar(cfg)`)
- `cfg = { url?, hue?, style?, age?, kind? }`. Returns the uniform avatar API.
- GLB path when `url` present; on load failure resolves to procedural and logs.

### Integration
- `worldHanoi.ts`: build local player + remotes + NPCs via the factory; call
  `avatar.update(dt, state)` each frame (mixer + morphs); thread `playAction` /
  `setExpression` through the world API; `makeRemote` loads each remote's `url`
  (cache by URL). Keep the procedural loop pose only for the procedural fallback.
- Presence: `avatarUrl` added to client `Identity` + server `JoinPayload` /
  `PlayerState` (default '' → procedural/preset).

### Setup (CreateScreen)
- An RPM **creator iframe** (`https://<subdomain>.readyplayer.me/avatar?frameApi`);
  on `v1.avatar.exported` postMessage, save `Player.avatarUrl`. The 3D preview
  (`avatarPreview.ts`) loads the GLB via the factory and shows idle + a demo emote.
  Age slider stays for the procedural fallback; hue still tints procedural.

### In-world picker UI
- Replace the emote popover with an **emote/expression panel**: a row of 7 actions
  (wave/dance/bow/clap/point/arms-crossed/think) + a row of 5 expressions
  (neutral/happy/surprised/sad/angry) → `worldApi.emote(name)` /
  `worldApi.setExpression(name)`. Keyboard shortcuts retained.

## Data model & persistence
- `Player.avatarUrl?: string` (+ keep `age/hue/style` for fallback), persisted in
  the existing player blob; synced via presence.

## Phases
1. **Engine**: `glbAvatar.ts` + `avatarFactory.ts` + DRACO + animation library +
   morph expressions + locomotion/emote state machine + procedural fallback;
   world loop uses the factory for the local player with a default sample URL.
2. **Personalization + multiplayer**: RPM creator in setup, `Player.avatarUrl`
   model + persistence + presence sync (client + server), remotes/NPCs load GLBs
   with URL cache + fallback; `fetch-rpm-assets.js`.
3. **Picker UI**: in-world emote/expression panel + setup preview wiring.

## Testing
- Unit: expression→morph mapping, locomotion state selection (idle/walk/run by
  speed), emote one-shot timer/auto-return, factory fallback decision, URL cache.
- Manual (user, needs assets/subdomain): RPM creator → world renders the rigged
  avatar, emotes + expressions switch from the UI, remotes show their avatars.

## Risks / dependencies
- External assets fetched at runtime (RPM CDN + animation library) — agent cannot
  pre-download; mitigated by runtime URLs + `fetch-rpm-assets.js` + procedural
  fallback.
- DRACO decoder must be served (three addons `/draco/` or a CDN decoder path).
- GLB weight in multiplayer — mitigated by per-URL cache, concurrency cap, distance
  culling, NPC preset sharing.
- CORS on the animation library host — mitigated by vendoring via the fetch script
  if a host lacks CORS headers.
