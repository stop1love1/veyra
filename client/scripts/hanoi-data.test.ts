import { describe, it, expect } from 'vitest';
import data from '../public/data/hanoi.json';

describe('hanoi.json shape (post-enrichment)', () => {
  it('keeps the core layers', () => {
    expect(Array.isArray(data.buildings)).toBe(true);
    expect(data.buildings.length).toBeGreaterThan(10000); // full 1500m extent, not the 700m subset
    expect(Array.isArray(data.roads)).toBe(true);
    expect(Array.isArray(data.water)).toBe(true);
  });

  it('carries the new enrichment fields', () => {
    expect(Array.isArray(data.pois)).toBe(true);
    expect(Array.isArray(data.barriers)).toBe(true);
    // at least some inner buildings are tagged
    expect(data.buildings.some((b: any) => b.tags)).toBe(true);
    // at least one named road
    expect(data.roads.some((r: any) => r.name)).toBe(true);
    // pois are well-formed
    if (data.pois.length) expect(data.pois[0]).toHaveProperty('kind');
  });
});
