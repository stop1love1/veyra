// Pure geometry helpers for the dev teleport map (no THREE / DOM deps, so they
// unit-test without a WebGL context). The engine uses `resolveTeleport` to land
// the player safely; the React overlay uses the fit/projection helpers to draw a
// top-down "Google-Maps" view and turn a click back into world coordinates.

export interface Circle {
  x: number;
  z: number;
  r: number;
}

// Maps a square world region [-r, r] (in both x and z) onto a `size`×`size`
// canvas in CSS pixels. World +x → right, world +z → down (so -z reads as north).
export interface FitTransform {
  scale: number; // world units → pixels
  ox: number; // canvas pixel of world x = 0
  oy: number; // canvas pixel of world z = 0
  size: number;
}

/** Fit the playable disc of radius `r` into a `size`×`size` square canvas. */
export function fitTransform(r: number, size: number): FitTransform {
  const span = Math.max(1e-6, r * 2);
  return { scale: size / span, ox: size / 2, oy: size / 2, size };
}

/** World (x, z) → canvas pixel (px, py). */
export function worldToCanvas(x: number, z: number, tf: FitTransform): { px: number; py: number } {
  return { px: tf.ox + x * tf.scale, py: tf.oy + z * tf.scale };
}

/** Canvas pixel (px, py) → world (x, z). Exact inverse of worldToCanvas. */
export function canvasToWorld(px: number, py: number, tf: FitTransform): { x: number; z: number } {
  return { x: (px - tf.ox) / tf.scale, z: (py - tf.oy) / tf.scale };
}

/**
 * Resolve a teleport target into a position the player can actually stand:
 *   1. clamp inside the playable disc of radius `radius` (0 = no clamp), then
 *   2. push out of any collision blocker it lands inside, so the player can
 *      never be teleported trapped in a building. Two passes settle corners
 *      where pushing out of one blocker nudges into another.
 * Pure — returns a fresh { x, z }.
 */
export function resolveTeleport(x: number, z: number, radius: number, circles: Circle[]): { x: number; z: number } {
  const rr = Math.hypot(x, z);
  if (radius > 0 && rr > radius) {
    const s = radius / rr;
    x *= s;
    z *= s;
  }
  const pad = 0.9;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of circles) {
      const dx = x - b.x;
      const dz = z - b.z;
      const dd = Math.hypot(dx, dz) || 1;
      if (dd < b.r + pad) {
        x = b.x + (dx / dd) * (b.r + pad);
        z = b.z + (dz / dd) * (b.r + pad);
      }
    }
  }
  return { x, z };
}
