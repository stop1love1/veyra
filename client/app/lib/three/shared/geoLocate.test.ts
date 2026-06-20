import { describe, it, expect } from 'vitest';
import { gpsToWorld, isInsideMap } from './geoLocate';

// The map's Hoan Kiem reference origin (mirrors scripts/gen-hanoi.js).
const CENTER = { lat0: 21.0287, lon0: 105.8524 };

describe('gpsToWorld', () => {
  it('maps the reference origin to the world origin', () => {
    const { x, z } = gpsToWorld(CENTER.lat0, CENTER.lon0, CENTER);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it('maps north (higher latitude) to negative z', () => {
    // +0.001° latitude ≈ 111.32 m north; north is -z in the world.
    const { x, z } = gpsToWorld(CENTER.lat0 + 0.001, CENTER.lon0, CENTER);
    expect(x).toBeCloseTo(0, 3);
    expect(z).toBeCloseTo(-111.32, 1);
  });

  it('maps east (higher longitude) to positive x, scaled by cos(lat)', () => {
    // +0.001° longitude at lat 21.0287 ≈ 111320·cos(21.0287°)·0.001 ≈ 103.9 m east.
    const { x, z } = gpsToWorld(CENTER.lat0, CENTER.lon0 + 0.001, CENTER);
    expect(x).toBeCloseTo(103.9, 0);
    expect(z).toBeCloseTo(0, 3);
  });

  it('is linear and sign-correct in both axes at once', () => {
    const { x, z } = gpsToWorld(CENTER.lat0 - 0.002, CENTER.lon0 - 0.001, CENTER);
    expect(x).toBeLessThan(0); // west → -x
    expect(z).toBeGreaterThan(0); // south → +z
    expect(z).toBeCloseTo(222.64, 1); // 0.002° lat south
  });
});

describe('isInsideMap', () => {
  it('is true at the centre and inside the radius', () => {
    expect(isInsideMap(0, 0, 520)).toBe(true);
    expect(isInsideMap(300, -200, 520)).toBe(true);
  });

  it('is false beyond the radius', () => {
    expect(isInsideMap(500, 500, 520)).toBe(false);
  });

  it('treats the exact rim as inside', () => {
    expect(isInsideMap(520, 0, 520)).toBe(true);
  });
});
