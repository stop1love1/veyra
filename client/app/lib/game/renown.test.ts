import { describe, it, expect } from 'vitest';
import { RANKS, SOURCES, deriveRank, renownGain } from './renown';

describe('RANKS', () => {
  it('has 5 ranks with ascending thresholds starting at 0', () => {
    expect(RANKS).toHaveLength(5);
    expect(RANKS[0].threshold).toBe(0);
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].threshold).toBeGreaterThan(RANKS[i - 1].threshold);
    }
  });
});

describe('deriveRank', () => {
  it('returns rank 1 at 0 renown with progress 0', () => {
    const r = deriveRank(0);
    expect(r.index).toBe(1);
    expect(r.progress).toBe(0);
    expect(r.nextThreshold).toBe(100);
  });
  it('returns rank 2 exactly at the threshold', () => {
    expect(deriveRank(100).index).toBe(2);
  });
  it('clamps negative renown to rank 1', () => {
    expect(deriveRank(-50).index).toBe(1);
  });
  it('caps at the top rank with null nextThreshold and progress 1', () => {
    const r = deriveRank(99999);
    expect(r.index).toBe(5);
    expect(r.nextThreshold).toBeNull();
    expect(r.progress).toBe(1);
  });
  it('reports fractional progress toward the next rank', () => {
    // rank 1 spans [0,100): 50 renown => halfway
    expect(deriveRank(50).progress).toBeCloseTo(0.5, 5);
  });
});

describe('renownGain', () => {
  it('awards full points when under the daily cap', () => {
    expect(renownGain('explore', 0)).toBe(SOURCES.explore.points);
  });
  it('awards 0 once the daily cap is reached', () => {
    expect(renownGain('explore', SOURCES.explore.dailyCap)).toBe(0);
  });
  it('never awards more than the remaining cap room', () => {
    const cap = SOURCES.explore.dailyCap;
    expect(renownGain('explore', cap - 1)).toBe(SOURCES.explore.points);
    expect(renownGain('explore', cap + 5)).toBe(0);
  });
});
