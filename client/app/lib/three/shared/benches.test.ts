import { describe, it, expect } from 'vitest';
import {
  buildSocialBenches,
  benchSlots,
  seatCount,
  reduceSnapshot,
  occupiedSeats,
  allSeats,
  SEAT_PITCH,
  type PlayerState,
} from './benches';

describe('seatCount', () => {
  it('gives 3 slots for a 2.4 m bench and 4 for a 3.1 m bench', () => {
    expect(seatCount(2.4)).toBe(3);
    expect(seatCount(3.1)).toBe(4);
  });
  it('is at least 1 and capped', () => {
    expect(seatCount(0.1)).toBe(1);
    expect(seatCount(100)).toBe(6);
  });
});

describe('buildSocialBenches', () => {
  it('is deterministic for the same lake inputs (cross-client agreement)', () => {
    const a = buildSocialBenches(0, -20, 110);
    const b = buildSocialBenches(0, -20, 110);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect(new Set(a.map((x) => x.id)).size).toBe(12); // unique ids
  });
  it('falls back to a ring outside the water when no polygon is given', () => {
    const benches = buildSocialBenches(0, 0, 100);
    for (const bch of benches) {
      const r = Math.hypot(bch.x, bch.z);
      expect(r).toBeCloseTo(106, 5);
    }
  });
  it('cycles the three bench types', () => {
    const benches = buildSocialBenches(0, 0, 100);
    expect(benches.slice(0, 3).map((b) => b.type)).toEqual(['stone', 'wood', 'modern']);
    expect(new Set(benches.map((b) => b.type))).toEqual(new Set(['stone', 'wood', 'modern']));
  });
  it('samples the shore polygon and pushes benches OUTWARD onto the promenade', () => {
    // A square "lake" centred at origin, half-extent 10. Benches should land
    // ~OFFSET(4) beyond the shore, i.e. further from centre than the edge.
    const poly: Array<[number, number]> = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const benches = buildSocialBenches(0, 0, 12, poly, 8);
    expect(benches).toHaveLength(8);
    for (const b of benches) {
      // Outside the 10×10 water box on at least one axis (pushed onto promenade).
      expect(Math.max(Math.abs(b.x), Math.abs(b.z))).toBeGreaterThan(10);
    }
    // Deterministic.
    expect(buildSocialBenches(0, 0, 12, poly, 8)).toEqual(benches);
  });
});

describe('benchSlots', () => {
  it('produces seatCount anchors spaced by SEAT_PITCH, centred on the bench', () => {
    const bench = { id: 'bench_0', x: 0, z: 0, rotY: 0, len: 2.4, type: 'stone' as const };
    const slots = benchSlots(bench);
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.seatId)).toEqual([
      'bench_0:0',
      'bench_0:1',
      'bench_0:2',
    ]);
    // rotY=0 → right axis is +x; centred → offsets -pitch, 0, +pitch.
    expect(slots[0].x).toBeCloseTo(-SEAT_PITCH, 5);
    expect(slots[1].x).toBeCloseTo(0, 5);
    expect(slots[2].x).toBeCloseTo(SEAT_PITCH, 5);
    expect(slots.every((s) => Math.abs(s.z) < 1e-9)).toBe(true);
  });
  it('lays seats perpendicular to the facing', () => {
    const bench = { id: 'b', x: 0, z: 0, rotY: Math.PI / 2, len: 1.4, type: 'wood' as const };
    const slots = benchSlots(bench);
    expect(slots).toHaveLength(2);
    // rotY=90° → right axis ≈ (cos90, -sin90) = (0,-1): seats spread along z.
    expect(Math.abs(slots[0].x)).toBeLessThan(1e-9);
    expect(Math.abs(slots[1].z - slots[0].z)).toBeCloseTo(SEAT_PITCH, 5);
  });
});

describe('snapshot reducers', () => {
  const mk = (id: string, seatId: string | null = null): PlayerState => ({
    id,
    name: id,
    hue: 1,
    style: 'minimal',
    authed: false,
    x: 0,
    z: 0,
    rotY: 0,
    anim: 'idle',
    seatId,
  });

  it('reduceSnapshot drops the local player', () => {
    const out = reduceSnapshot([mk('me'), mk('a'), mk('b')], 'me');
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('reduceSnapshot tolerates junk', () => {
    const out = reduceSnapshot(
      [null as unknown as PlayerState, mk('a')],
      'me',
    );
    expect(out.map((s) => s.id)).toEqual(['a']);
  });
  it('occupiedSeats lists other players seats, excluding self', () => {
    const occ = occupiedSeats(
      [mk('me', 'bench_0:0'), mk('a', 'bench_0:1'), mk('b', null)],
      'me',
    );
    expect([...occ]).toEqual(['bench_0:1']);
  });
});

describe('allSeats', () => {
  it('flattens every seat across benches', () => {
    const benches = buildSocialBenches(0, -20, 110);
    const seats = allSeats(benches);
    // 12 benches, types cycle stone(3)+wood(2)+modern(4)=9 per trio × 4 = 36.
    expect(seats).toHaveLength(36);
    expect(new Set(seats.map((s) => s.seatId)).size).toBe(36);
  });
});
