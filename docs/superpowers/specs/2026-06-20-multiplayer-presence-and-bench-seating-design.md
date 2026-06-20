# Multiplayer Presence + Shared Bench Seating — Design

**Date:** 2026-06-20
**Status:** Approved (user requested full implementation in one combined spec)

## Goal

Add real-time multiplayer presence to the shared Hoan Kiem world so players see each
other move in real time, and make promenade **benches sittable** with multiple seat
slots so 2, 3, or more players can sit on the same bench when it has room.

## Product decisions (from brainstorming)

- **Topology:** ONE shared world ("world" room), ~20–50 concurrent players.
- **Participants:** everyone — both signed-in players and guests (guests use their
  `veyra_guest_id` temporary identity).
- **Scope:** delivered as one phased spec — (1) multiplayer foundation, (2) bench seating.

## Non-goals (YAGNI)

No chat, voice, friends, private rooms/matchmaking, anti-cheat beyond sanity clamps,
no persistence of presence or seat state (all ephemeral, in-memory).

---

## Architecture

```
Browser (Next.js + three.js)                 NestJS server
┌────────────────────────────┐               ┌─────────────────────────────┐
│ worldHanoi.ts              │   socket.io   │ realtime.gateway.ts         │
│  - local player            │ ───────────▶  │  - "world" room             │
│  - remotePlayers map       │   state/move  │  - presence: Map<id,State>  │
│  - canonical benches+seats │ ◀───────────  │  - seatLocks: Map<seat,id>  │
│                            │   snapshot    │  - 10Hz snapshot broadcast  │
│ lib/net/realtime.ts        │   seat grant  │                             │
│  - socket client           │ ◀──seat:──▶   │  realtime.service.ts        │
└────────────────────────────┘               └─────────────────────────────┘
        ▲ wired by WorldScreen.tsx
```

### Authority model (hybrid)

- **Movement = client-authoritative.** Each client sends its own `{x,z,rotY,anim,seatId}`
  ~10 Hz (throttled, only on change). Server relays; applies only a light sanity clamp
  (finite numbers, within world radius). No server physics.
- **Seat claims = server-authoritative.** The server owns `seatLocks: Map<seatId,
  playerId>`. First `claimSeat` for a free seat wins; later claimers are denied. This is
  what guarantees two players can't occupy the same slot.

---

## Phase 1 — Multiplayer foundation

### Server: `src/realtime/` module

- **Dependencies to add:** `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`.
- **`realtime.gateway.ts`** — `@WebSocketGateway({ cors: { origin: CLIENT_ORIGIN } })`.
  - `handleConnection` — nothing until the client emits `join`.
  - `@SubscribeMessage('join')` payload `{ id, name, hue, style, authed }` → store in
    presence, join the `"world"` room, ack with the current full snapshot + bench layout
    is NOT sent (clients compute benches locally; see Phase 2).
  - `@SubscribeMessage('state')` payload `{ x, z, rotY, anim, seatId }` → update presence
    (sanity-clamped). High frequency; never logged.
  - `@SubscribeMessage('claimSeat')` payload `{ seatId }` → service arbitrates; emit
    `seat:granted {seatId}` to caller or `seat:denied {seatId}` if taken. On grant set the
    player's `seatId` in presence.
  - `@SubscribeMessage('releaseSeat')` → free the player's seat lock + clear presence seatId.
  - `handleDisconnect` — remove from presence, free any held seat, broadcast `leave {id}`.
  - **Broadcast loop** — every 100 ms emit `snapshot` (array of presence states) to the
    `"world"` room. (Simpler than per-message deltas; payload is small at 20–50 players.)
- **`realtime.service.ts`** — holds `presence` and `seatLocks` Maps; pure methods
  (`join/leave/updateState/claimSeat/releaseSeat/snapshot`) so they're unit-testable
  without a socket.
- **Identity:** `id` = auth userId when signed in, else the guest id. No token required
  (guests have none); the gateway trusts the handshake id. Duplicate id → latest socket
  wins (replace presence, disconnect prior).
- **Bootstrap:** socket.io adapter is the NestJS default once `@nestjs/platform-socket.io`
  is installed; no `main.ts` change needed beyond it picking up the gateway. CORS mirrors
  the existing `CLIENT_ORIGIN` allow-list.

### Client: `client/app/lib/net/realtime.ts`

- `createRealtime({ url, identity, onSnapshot, onSeatGranted, onSeatDenied })` →
  `{ sendState(s), claimSeat(seatId), releaseSeat(), dispose() }`.
- Connects with `socket.io-client`; emits `join` on connect (and re-join on reconnect).
- `sendState` throttles to ~10 Hz and skips sends when unchanged.
- Reconnect with backoff is handled by socket.io defaults; on disconnect the world simply
  stops receiving snapshots (remote avatars fade out via stale-timeout).
- URL derives from the existing API base (`client.ts`), swapping the http(s) origin.

### Client: remote avatars in `worldHanoi.ts`

- `remotePlayers: Map<id, { avatar, parts, target:{x,z,rotY}, anim, seatId, nameTag, last }>`.
- On snapshot: upsert each remote id (build a `buildAvatar` lazily on first sight; never
  build the local player's own id). Record target transform + anim + seatId + `last=now`.
- Each frame: lerp each remote group toward its target (~10×dt); drive walk/idle/sit pose
  from `anim`; if `seatId` set, snap to that seat's world anchor + facing (sit pose).
- Stale GC: if `now - last > 5 s` (or explicit `leave`), dispose + remove.
- Name tag: reuse the existing `setNameTag`/sprite approach per remote player.
- Opts added to `createVeyraWorld`: `onLocalState(cb)` (engine calls cb each tick with the
  local transform so WorldScreen can forward it), plus `applySnapshot`, `applySeat*`
  handled through a small imperative API returned from the engine
  (`world.net = { snapshot(states), seatGranted(id), seatDenied(id), playerLeft(id) }`).

---

## Phase 2 — Shared bench seating

### Canonical, tier-independent benches

Today benches are placed with **device-tier-dependent density**, so two devices disagree
on bench positions and seats couldn't be shared. Replace the seating benches with a
**canonical set computed only from the lake center + radius** (stable map data, identical
on every client and independent of tier):

- `buildSocialBenches(lakeCx, lakeCz, lakeR)` → array of
  `{ id:'bench_'+i, x, z, rotY, len }`, placed at FIXED angles on a ring around the lake
  (north promenade arc), fixed count (e.g. 12), facing the water.
- Render each with collision (reuse `props.bench()` visual; push a collision circle), for
  ALL tiers. The previous tier-dependent decorative benches in `dressPromenade` are
  removed to avoid duplicates.

### Seat slots

- `benchSlots(bench)` → array of `{ seatId:'bench_i:k', x, z, rotY }` world anchors.
- `slots = clamp(floor(SEAT_LENGTH / SEAT_PITCH), 1, MAX)` with `SEAT_PITCH ≈ 0.7 m`.
  A ~2.4 m bench → 3 slots; longer benches → more. Slots are laid along the seat axis,
  centered, each facing `rotY`.
- This is a **pure function** (unit-testable, no three.js objects required for the math).

### Sit / stand flow (local player)

- Proximity: each frame find the nearest bench seat within `SIT_REACH` whose `seatId` is
  not in the known-occupied set. Surface it to WorldScreen as a sit prompt (reuse the
  existing enter-prompt UI, label "Ngồi" / "Sit").
- Action → `claimSeat(seatId)`:
  - On `seat:granted`: set `localSeatId`, snap the player to the slot anchor + facing,
    enter **sit pose**, ignore movement input, broadcast via `state` (seatId field).
  - On `seat:denied`: try the next free slot on that bench; if none, ignore.
- Stand: pressing the action again OR any movement key → `releaseSeat()`, clear
  `localSeatId`, resume walking.
- Occupancy: derived from the snapshot (`state.seatId` of every player) so remote sitters
  render in the correct slot and their seats show as taken in the local prompt logic.

### Sit pose (avatar)

- Add `setSitPose(parts, on)` helper (in the engine, using existing `parts`): bend hips so
  thighs go horizontal (legs rotate ~ -90° at the hip group), lower the group to seat
  height (`SEAT_Y ≈ 0.5`), keep torso upright. Reset to standing when `on=false`.

---

## Error handling

- Reconnect: socket.io auto-reconnect with backoff; re-emit `join` on `connect`.
- Stale players: GC remote avatars after 5 s without an update.
- Seat races: resolved server-side (first claim wins); client always waits for grant
  before snapping (never optimistic).
- Robustness: guard against non-finite transforms; missing avatar parts; duplicate ids.

## Testing

- **Server unit tests** (`realtime.service.spec.ts`, jest): two `claimSeat` on one seat →
  exactly one granted; `releaseSeat`/`leave` frees the lock; `join`/`leave` presence;
  `updateState` clamps non-finite.
- **Client pure-function tests** (`benchSlots`/`buildSocialBenches` + a snapshot→
  remotePlayers reducer) — extracted into a tiny pure module so they test without a DOM.
- **Manual:** two browser tabs (one signed-in, one guest) — see each other move; both sit
  on the same bench in different slots; one stands; refresh frees the seat.

## Rollout / flags

- A client env/const `REALTIME_ENABLED` (default on) so multiplayer can be disabled
  without reverting; when off, the world is single-player and benches still sit locally.
- `SHOW_CITY_NPCS` stays `false` (ambient NPCs removed earlier this session).

## Files

**Server (new):** `src/realtime/realtime.module.ts`, `realtime.gateway.ts`,
`realtime.service.ts`, `realtime.types.ts`, `realtime.service.spec.ts`; edit
`app.module.ts`; add deps to `package.json`.

**Client (new):** `app/lib/net/realtime.ts`, `app/lib/three/shared/benches.ts`
(pure: `buildSocialBenches`, `benchSlots`, snapshot reducer) + `benches.spec`-style test;
add `socket.io-client` dep.

**Client (edit):** `app/lib/three/worldHanoi.ts` (remote avatars, canonical benches,
seating, sit pose, net API), `app/features/world/WorldScreen.tsx` (wire realtime + sit
prompt), `app/lib/three/shared/avatar.ts` if a sit helper is cleaner there.
