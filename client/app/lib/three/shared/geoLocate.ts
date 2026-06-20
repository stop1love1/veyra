// Pure geo helpers for placing the player from a real GPS fix (no DOM/THREE deps,
// so they unit-test without a browser). They mirror the equirectangular projection
// `scripts/gen-hanoi.js` used to bake the map: a local-metre frame about the Hoan
// Kiem origin, with x = east (m), z = south(+)/north(-).

export interface MapCenter {
  lat0: number; // reference latitude (degrees)
  lon0: number; // reference longitude (degrees)
}

const M_PER_DEG_LAT = 111320; // metres per degree of latitude (matches gen-hanoi.js)

/**
 * Convert a GPS fix (degrees) to world metres in the map's local frame.
 * Equirectangular about `center`: longitude is scaled by cos(lat0) so x/z stay in
 * metres, and north maps to -z (the engine's convention).
 */
export function gpsToWorld(lat: number, lon: number, center: MapCenter): { x: number; z: number } {
  const mLon = M_PER_DEG_LAT * Math.cos((center.lat0 * Math.PI) / 180);
  const x = (lon - center.lon0) * mLon;
  const z = -(lat - center.lat0) * M_PER_DEG_LAT;
  return { x, z };
}

/** True when (x, z) lies within the playable disc of radius `r` (rim counts as inside). */
export function isInsideMap(x: number, z: number, r: number): boolean {
  return Math.hypot(x, z) <= r;
}
