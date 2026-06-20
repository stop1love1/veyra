# World Chat — Floating Bubbles Above Avatars

**Date:** 2026-06-20
**Status:** Approved (builds on the multiplayer presence layer)

## Goal

Players can type short chat messages that appear as a speech bubble floating above
their avatar's head — visible to everyone in the shared world, fading after a few
seconds.

## Delivery model (simplest that works)

Reuse the realtime layer. Crucially, **server→client delivery is via the existing
presence snapshot**, not a separate broadcast: the sender's latest message is stored
in presence as `msg` + `msgAt` (server wall-clock ms). The 10 Hz snapshot already
carries presence to everyone, so a message reaches all clients within ≤100 ms AND a
late joiner still sees a bubble that's currently on-screen — one mechanism, no echo to
de-dupe. The local sender shows its own bubble **optimistically** on send.

## Server

- **`realtime.types.ts`:** `PlayerState` gains `msg: string` and `msgAt: number`
  (0 = never). New `ChatPayload { text: string }`.
- **`realtime.service.ts`:** `setMessage(id, text): string` — trims, strips control
  chars, caps to `MAX_CHAT = 120`, stores `msg`/`msgAt` (caller passes the timestamp
  so the service stays Date-free/testable). Returns the sanitized text (`''` if empty).
- **`realtime.gateway.ts`:** `@SubscribeMessage('chat')` → `setMessage(id, text,
  Date.now())`. No extra broadcast; the next snapshot carries it.

## Client

- **`realtime.ts`:** `sendChat(text)` emits `chat { text }`. (No `onChat` handler
  needed — chat arrives through `onSnapshot`.)
- **`worldHanoi.ts`:**
  - `makeBubble(text)` — a camera-facing sprite (THREE.Sprite auto-billboards), light
    rounded background, word-wrapped to ≤2 lines, overflow `…`. Positioned at ~y 2.7
    (just above the name tag at 2.25).
  - `say(id, text)` — create/replace the bubble on the target avatar (local player when
    `id === SELF_ID`, else the matching remote group). Tracks `{ sprite, until }` in a
    `bubbles` map keyed by id; new message resets the timer.
  - Frame loop: fade each bubble's opacity in its last second and dispose after
    `BUBBLE_MS = 6000`.
  - `applySnapshot`: for each remote with a fresh message
    (`s.msgAt !== r.lastMsgAt && Date.now() - s.msgAt < BUBBLE_MS`), call `say(s.id,
    s.msg)` and record `r.lastMsgAt`. This is the whole remote-delivery path.
  - Exposed: `net.say(id, text)` is not needed (snapshot-driven); a public `say(text)`
    convenience drives the LOCAL optimistic bubble, called by WorldScreen on send.
- **`WorldScreen.tsx`:** a chat input field (hidden until opened).
  - Open: press **Enter** (when no input is focused) on desktop, or tap a **chat
    button** in the HUD on mobile. **Enter** sends, **Esc** cancels/closes.
  - On send: `rtRef.current.sendChat(text)` + `worldApi.current.say(text)` (optimistic
    local bubble). Movement is safe while typing — the keyboard handler already ignores
    game keys when an INPUT is focused, and clears held keys on blur.

## Error handling

- Empty/whitespace messages are dropped (client and server).
- Length cap enforced server-side (authoritative) and hinted client-side (maxLength).
- Control characters stripped; no HTML rendering (drawn to canvas as plain text).
- Clock skew: freshness uses wall-clock `Date.now()` on both ends; on localhost exact,
  cross-machine skew of a few seconds only shifts the late-joiner cutoff slightly —
  acceptable for an ephemeral bubble.

## Testing

- **Server unit test** (`realtime.service.spec.ts`): `setMessage` trims/caps/strips and
  lands `msg`/`msgAt` in the snapshot; empty input clears to `''`.
- **Live socket drive:** two clients; one emits `chat`, assert the other's snapshot
  shows `msg` within ~100 ms; over-long text is truncated to 120.
- **Manual 2-tab:** type in one tab → bubble appears above that avatar in the other and
  fades after ~6 s.

## Scope (YAGNI)

No chat history/log panel, no DMs/channels, no profanity filtering beyond trim+cap, no
persistence (ephemeral, same as presence). Bubbles show only the latest message.
