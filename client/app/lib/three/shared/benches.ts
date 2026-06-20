// Pure (no three.js) geometry + reducers for the shared, sittable promenade
// benches. Kept dependency-free so the math is identical on every client and is
// unit-testable without a DOM. worldHanoi.ts consumes these to render benches,
// compute seat anchors, and reconcile the multiplayer snapshot.

export type BenchType = 'stone' | 'wood' | 'modern';

export interface Bench {
  id: string;
  x: number;
  z: number;
  rotY: number; // facing (toward the lake); sitters face this way
  len: number; // seat length along the side-by-side axis
  type: BenchType;
}

export const BENCH_TYPES: BenchType[] = ['stone', 'wood', 'modern'];
// Seat length per type → drives how many people fit (see seatCount).
export const TYPE_LEN: Record<BenchType, number> = { stone: 2.6, wood: 1.6, modern: 3.2 };

export interface Seat {
  seatId: string; // `${bench.id}:${k}`
  x: number;
  z: number;
  rotY: number;
}

export interface PlayerState {
  id: string;
  name: string;
  hue: number;
  style: string;
  authed: boolean;
  x: number;
  z: number;
  rotY: number;
  anim: 'idle' | 'walk' | 'sit';
  seatId: string | null;
  msg?: string; // latest chat text
  msgAt?: number; // server ms of the latest chat
}

export const SEAT_PITCH = 0.7; // metres between adjacent sitters
export const MAX_SLOTS = 6;

/** Seat count a bench of `len` provides (≥1, capped). */
export function seatCount(len: number): number {
  return Math.max(1, Math.min(MAX_SLOTS, Math.floor(len / SEAT_PITCH)));
}

const typeFor = (i: number): BenchType => BENCH_TYPES[i % BENCH_TYPES.length];

function mkBench(i: number, x: number, z: number, lakeCx: number, lakeCz: number): Bench {
  const type = typeFor(i);
  // Face the lake centre (avatar yaw convention: atan2(toCentreX, toCentreZ)).
  const rotY = Math.atan2(lakeCx - x, lakeCz - z);
  return { id: 'bench_' + i, x, z, rotY, len: TYPE_LEN[type], type };
}

/**
 * Canonical social benches around the lake. Deterministic + tier-independent so
 * every client agrees on positions and seat ids.
 *
 * When the real lake SHORE polygon is available, benches are sampled evenly
 * along the actual shore and pushed a few metres OUTWARD onto the promenade,
 * facing the water — this hugs the real (non-circular) Hoan Kiem outline instead
 * of a naive circle, which kept dropping benches into the water or onto rooftops.
 * Falls back to a ring around the centre only when no polygon is known.
 */
export function buildSocialBenches(
  lakeCx: number,
  lakeCz: number,
  lakeR: number,
  poly?: Array<[number, number]> | null,
  count = 12,
): Bench[] {
  const benches: Bench[] = [];
  const OFFSET = 4.0; // metres outward from the shore onto the walkable promenade

  if (Array.isArray(poly) && poly.length >= 3) {
    let perim = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const spacing = perim / count;
    let acc = 0, next = spacing * 0.5, made = 0;
    for (let i = 0; i < poly.length && made < count; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (segLen < 1e-6) continue;
      while (next <= acc + segLen && made < count) {
        const t = (next - acc) / segLen;
        const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
        const ux = px - lakeCx, uz = pz - lakeCz, ul = Math.hypot(ux, uz) || 1;
        benches.push(mkBench(made, px + (ux / ul) * OFFSET, pz + (uz / ul) * OFFSET, lakeCx, lakeCz));
        made++; next += spacing;
      }
      acc += segLen;
    }
    return benches;
  }

  // Fallback: a ring just outside the water rim.
  const ring = lakeR + 6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    benches.push(mkBench(i, lakeCx + Math.cos(a) * ring, lakeCz + Math.sin(a) * ring, lakeCx, lakeCz));
  }
  return benches;
}

/**
 * World-space seat anchors for a bench, laid out along the seat axis (the right
 * vector, perpendicular to the facing) and centred on the bench. Each sitter
 * faces `bench.rotY`.
 */
export function benchSlots(bench: Bench): Seat[] {
  const n = seatCount(bench.len);
  // right (seat) axis = perpendicular to the facing direction.
  const rx = Math.cos(bench.rotY);
  const rz = -Math.sin(bench.rotY);
  const seats: Seat[] = [];
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * SEAT_PITCH;
    seats.push({
      seatId: bench.id + ':' + k,
      x: bench.x + rx * off,
      z: bench.z + rz * off,
      rotY: bench.rotY,
    });
  }
  return seats;
}

/** All seats across all benches (flat) — handy for nearest-seat search. */
export function allSeats(benches: Bench[]): Seat[] {
  const out: Seat[] = [];
  for (const b of benches) for (const s of benchSlots(b)) out.push(s);
  return out;
}

/** Remote players only: drop the local id and any malformed entries. */
export function reduceSnapshot(
  states: PlayerState[],
  selfId: string,
): PlayerState[] {
  if (!Array.isArray(states)) return [];
  return states.filter(
    (s) => s && typeof s.id === 'string' && s.id !== selfId,
  );
}

/** Set of seatIds currently occupied by OTHER players (for the local prompt). */
export function occupiedSeats(
  states: PlayerState[],
  selfId: string,
): Set<string> {
  const set = new Set<string>();
  for (const s of states) {
    if (s && s.seatId && s.id !== selfId) set.add(s.seatId);
  }
  return set;
}
