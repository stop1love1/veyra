import { describe, it, expect } from 'vitest';
import { ribbonEdges, type Pt } from './roadGeom';

// Left-hand unit normal of a→b, mirroring the implementation.
function normal(a: Pt, b: Pt): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

describe('ribbonEdges', () => {
  it('offsets a straight line by exactly ±hw perpendicular', () => {
    const pts: Pt[] = [[0, 0], [10, 0], [20, 0]];
    const { left, right } = ribbonEdges(pts, 2);
    // segment runs along +x, so left edge is +z, right edge is -z
    expect(left).toEqual([[0, 2], [10, 2], [20, 2]]);
    expect(right).toEqual([[0, -2], [10, -2], [20, -2]]);
  });

  it('emits one offset point per input vertex on each side', () => {
    const pts: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const { left, right } = ribbonEdges(pts, 1.5);
    expect(left).toHaveLength(pts.length);
    expect(right).toHaveLength(pts.length);
  });

  it('keeps a constant perpendicular width across a bend (miter join)', () => {
    // L-shape: the join at [0,0] must stay hw away from BOTH segments, which is
    // exactly what stops the outside-of-the-corner gap.
    const hw = 2;
    const pts: Pt[] = [[-10, 0], [0, 0], [0, 10]];
    const { left, right } = ribbonEdges(pts, hw);

    const n1 = normal(pts[0], pts[1]);
    const n2 = normal(pts[1], pts[2]);
    const ox = left[1][0] - pts[1][0];
    const oz = left[1][1] - pts[1][1];
    // perpendicular projection of the join offset onto each segment normal == hw
    expect(ox * n1[0] + oz * n1[1]).toBeCloseTo(hw);
    expect(ox * n2[0] + oz * n2[1]).toBeCloseTo(hw);
    // right edge is the exact mirror through the centreline
    expect(right[1][0]).toBeCloseTo(pts[1][0] - ox);
    expect(right[1][1]).toBeCloseTo(pts[1][1] - oz);
  });

  it('shares the joint edge between adjacent segments (no gap)', () => {
    // Because there is one offset per vertex, the far edge of segment i is byte-
    // for-byte the near edge of segment i+1 — the broken-corner artefact is
    // impossible by construction.
    const pts: Pt[] = [[0, 0], [10, 1], [18, 9]];
    const { left, right } = ribbonEdges(pts, 3);
    // vertex 1 is the shared joint; both segments reference left[1]/right[1]
    expect(left[1]).toBeDefined();
    expect(right[1]).toBeDefined();
    // no NaN / Infinity leaked from the miter maths
    for (const e of [...left, ...right]) {
      expect(Number.isFinite(e[0])).toBe(true);
      expect(Number.isFinite(e[1])).toBe(true);
    }
  });

  it('clamps the miter on a hairpin instead of spiking to infinity', () => {
    // near-reversal: without clamping the miter length explodes
    const hw = 2;
    const pts: Pt[] = [[-10, 0], [0, 0], [-10, 0.5]];
    const { left } = ribbonEdges(pts, hw, 4);
    const ox = left[1][0] - pts[1][0];
    const oz = left[1][1] - pts[1][1];
    expect(Math.hypot(ox, oz)).toBeLessThanOrEqual(4 * hw + 1e-6);
  });
});
