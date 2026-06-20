// Realtime presence + seating types. Presence is ephemeral (in-memory only) —
// nothing here is persisted to Mongo.

export type Anim = 'idle' | 'walk' | 'sit';

/** Full per-player state broadcast to everyone in the shared world. */
export interface PlayerState {
  id: string;
  name: string;
  hue: number;
  style: string;
  age: number; // character age (drives the remote avatar's proportions/face)
  authed: boolean;
  x: number;
  z: number;
  rotY: number;
  anim: Anim;
  seatId: string | null;
  msg: string; // latest chat text ('' = none)
  msgAt: number; // server wall-clock ms of the latest chat (0 = never)
}

/** Handshake the client emits once on connect (and again on reconnect). */
export interface JoinPayload {
  id: string;
  name?: string;
  hue?: number;
  style?: string;
  age?: number;
  authed?: boolean;
}

/** High-frequency transform update (client-authoritative movement). */
export interface StatePayload {
  x: number;
  z: number;
  rotY: number;
  anim?: Anim;
  seatId?: string | null;
}

/** A chat message the player typed. */
export interface ChatPayload {
  text: string;
}
