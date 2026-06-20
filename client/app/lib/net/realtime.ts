// Client realtime layer for shared-world multiplayer. Thin wrapper over
// socket.io-client: emits the local player's transform (~10 Hz, throttled),
// claims/releases seats, and surfaces world snapshots to the caller. The world
// engine (worldHanoi) renders remote avatars from the snapshots; WorldScreen
// owns this client's lifecycle.

import { io, type Socket } from 'socket.io-client';
import { BASE_URL } from '../api/client';
import type { PlayerState } from '../three/shared/benches';

export interface Identity {
  id: string;
  name: string;
  hue: number;
  style: string;
  age: number;
  authed: boolean;
}

export interface LocalState {
  x: number;
  z: number;
  rotY: number;
  anim: 'idle' | 'walk' | 'sit';
  seatId: string | null;
}

export interface RealtimeHandlers {
  onSnapshot?: (states: PlayerState[]) => void;
  onLeave?: (id: string) => void;
  onSeatGranted?: (seatId: string) => void;
  onSeatDenied?: (seatId: string) => void;
  onStatus?: (connected: boolean) => void;
}

export interface RealtimeClient {
  sendState(s: LocalState): void;
  claimSeat(seatId: string): void;
  releaseSeat(): void;
  sendChat(text: string): void;
  dispose(): void;
}

const SEND_MS = 100; // hard 10 Hz cap when moving
const IDLE_MS = 1000; // unchanged → heartbeat at most ~1 Hz

/** The socket connects to the API server ORIGIN (not the /api path). */
function socketOrigin(): string {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return 'http://localhost:3001';
  }
}

export function createRealtime(
  identity: Identity,
  handlers: RealtimeHandlers,
): RealtimeClient {
  // Default transports (polling → upgrade to websocket). Forcing websocket-only
  // makes the browser handshake fail with no fallback ("closed before the
  // connection is established"); polling always completes, then upgrades.
  const socket: Socket = io(socketOrigin(), {
    reconnection: true,
    reconnectionDelayMax: 4000,
  });

  let lastSent = 0;
  let lastKey = '';

  const join = () => socket.emit('join', identity);
  socket.on('connect', () => {
    handlers.onStatus?.(true);
    join(); // (re)announce identity on every (re)connect
  });
  socket.on('disconnect', () => handlers.onStatus?.(false));
  socket.on('snapshot', (states: PlayerState[]) =>
    handlers.onSnapshot?.(Array.isArray(states) ? states : []),
  );
  socket.on('leave', (m: { id?: string }) => {
    if (m && typeof m.id === 'string') handlers.onLeave?.(m.id);
  });
  socket.on('seat:granted', (m: { seatId?: string }) => {
    if (m && typeof m.seatId === 'string') handlers.onSeatGranted?.(m.seatId);
  });
  socket.on('seat:denied', (m: { seatId?: string }) => {
    if (m && typeof m.seatId === 'string') handlers.onSeatDenied?.(m.seatId);
  });

  return {
    sendState(s) {
      const now = Date.now();
      if (now - lastSent < SEND_MS) return; // 10 Hz cap
      const key = `${s.x.toFixed(2)}|${s.z.toFixed(2)}|${s.rotY.toFixed(2)}|${s.anim}|${s.seatId}`;
      if (key === lastKey && now - lastSent < IDLE_MS) return; // idle heartbeat throttle
      lastSent = now;
      lastKey = key;
      socket.emit('state', s);
    },
    claimSeat(seatId) {
      socket.emit('claimSeat', { seatId });
    },
    releaseSeat() {
      socket.emit('releaseSeat');
    },
    sendChat(text) {
      const t = (text || '').trim();
      if (t) socket.emit('chat', { text: t });
    },
    dispose() {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
