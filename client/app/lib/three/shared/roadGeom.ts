// Pure geometry helper for expanding a road polyline into a flat ribbon (no THREE
// deps, so it unit-tests without a WebGL context). Each polyline point gets ONE
// left/right offset built with a MITER join, so the quads either side of a bend
// share their joint edge exactly — no wedge-shaped gap on the outside of curves
// (the "đứt đoạn" / broken-corner artefact you get from extruding each segment
// independently by its own perpendicular).

export type Pt = readonly [number, number];

export interface RibbonEdges {
  left: Array<[number, number]>; // outer edge (point + perpendicular * hw)
  right: Array<[number, number]>; // inner edge (point - perpendicular * hw)
}

/**
 * Offset a polyline by ±`hw` on each side using miter joins.
 *
 * For interior vertices the offset direction bisects the two adjacent segment
 * normals and is lengthened by 1/cos(½turn) so the ribbon keeps a constant width
 * `hw` measured perpendicular to BOTH neighbouring segments. The miter length is
 * clamped (`maxMiter`×hw) so a near-180° hairpin can't shoot a spike to infinity;
 * such a fold falls back to the incoming normal. Endpoints use their single
 * adjacent segment normal.
 *
 * Returns one [x, z] per input point on each side — callers stitch consecutive
 * pairs into quads, guaranteeing segment i's far edge IS segment i+1's near edge.
 */
export function ribbonEdges(pts: ReadonlyArray<Pt>, hw: number, maxMiter = 4): RibbonEdges {
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = i > 0 ? pts[i - 1] : null;
    const next = i < pts.length - 1 ? pts[i + 1] : null;

    // Unit perpendicular of the segment arriving at / leaving p (left-hand normal).
    const n1 = prev ? segNormal(prev, p) : null;
    const n2 = next ? segNormal(p, next) : null;

    let ox: number, oz: number; // offset vector p → left edge
    if (n1 && n2) {
      const dot = n1[0] * n2[0] + n1[1] * n2[1]; // cos(turn angle)
      const denom = 1 + dot;
      if (denom > 1e-3) {
        // miter: (n1+n2)/(1+dot) has perpendicular projection 1 onto each normal
        let mx = (n1[0] + n2[0]) / denom;
        let mz = (n1[1] + n2[1]) / denom;
        const ml = Math.hypot(mx, mz);
        if (ml > maxMiter) {
          const s = maxMiter / ml;
          mx *= s;
          mz *= s;
        }
        ox = mx * hw;
        oz = mz * hw;
      } else {
        // ~180° fold — bisector is undefined; keep the incoming normal.
        ox = n1[0] * hw;
        oz = n1[1] * hw;
      }
    } else {
      const n = (n1 ?? n2)!; // at least one exists for a 2+ point polyline
      ox = n[0] * hw;
      oz = n[1] * hw;
    }

    left.push([p[0] + ox, p[1] + oz]);
    right.push([p[0] - ox, p[1] - oz]);
  }
  return { left, right };
}

// Left-hand unit normal of segment a→b: (-dz, dx)/len. Matches the original road
// builder's `nx = -dz/len, nz = dx/len`.
function segNormal(a: Pt, b: Pt): [number, number] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}
