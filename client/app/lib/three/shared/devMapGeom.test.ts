import { describe, it, expect } from 'vitest';
import { fitTransform, worldToCanvas, canvasToWorld, resolveTeleport } from './devMapGeom';

describe('fitTransform', () => {
  it('centres world origin and scales the disc to fill the canvas', () => {
    const tf = fitTransform(100, 320);
    expect(tf.ox).toBe(160);
    expect(tf.oy).toBe(160);
    // a point at the disc edge (x=100) lands at the canvas edge
    expect(worldToCanvas(100, 0, tf).px).toBeCloseTo(320);
    expect(worldToCanvas(-100, 0, tf).px).toBeCloseTo(0);
  });

  it('never divides by zero for a degenerate radius', () => {
    const tf = fitTransform(0, 320);
    expect(Number.isFinite(tf.scale)).toBe(true);
  });
});

describe('worldToCanvas / canvasToWorld', () => {
  it('round-trips any world point back to itself', () => {
    const tf = fitTransform(240, 512);
    for (const [x, z] of [[0, 0], [37, -88], [-200, 150], [240, 240]]) {
      const { px, py } = worldToCanvas(x, z, tf);
      const back = canvasToWorld(px, py, tf);
      expect(back.x).toBeCloseTo(x);
      expect(back.z).toBeCloseTo(z);
    }
  });

  it('maps +x to the right and +z downward', () => {
    const tf = fitTransform(100, 200);
    expect(worldToCanvas(50, 0, tf).px).toBeGreaterThan(tf.ox);
    expect(worldToCanvas(0, 50, tf).py).toBeGreaterThan(tf.oy);
  });
});

describe('resolveTeleport', () => {
  it('leaves an in-bounds, unobstructed target untouched', () => {
    const r = resolveTeleport(10, -5, 100, []);
    expect(r.x).toBeCloseTo(10);
    expect(r.z).toBeCloseTo(-5);
  });

  it('clamps a target outside the playable disc back onto the rim', () => {
    const r = resolveTeleport(300, 0, 100, []);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(100);
  });

  it('pushes a target out of a blocker it lands inside', () => {
    const circles = [{ x: 0, z: 0, r: 5 }];
    const r = resolveTeleport(1, 0, 1000, circles);
    // ends up at least the blocker radius (+pad) away from the centre
    expect(Math.hypot(r.x, r.z)).toBeGreaterThanOrEqual(5);
  });

  it('does not move a target already clear of every blocker', () => {
    const circles = [{ x: 0, z: 0, r: 5 }];
    const r = resolveTeleport(20, 20, 1000, circles);
    expect(r.x).toBeCloseTo(20);
    expect(r.z).toBeCloseTo(20);
  });
});
