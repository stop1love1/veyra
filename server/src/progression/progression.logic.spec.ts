import {
  RANKS,
  SOURCES,
  deriveRank,
  renownGain,
  isRenownSource,
} from './progression.logic';

describe('progression.logic', () => {
  describe('RANKS', () => {
    it('has 5 ranks with ascending thresholds from 0', () => {
      expect(RANKS).toHaveLength(5);
      expect(RANKS[0].threshold).toBe(0);
      for (let i = 1; i < RANKS.length; i++) {
        expect(RANKS[i].threshold).toBeGreaterThan(RANKS[i - 1].threshold);
      }
    });
  });

  describe('deriveRank', () => {
    it('is rank 1 at 0 renown, next threshold 100', () => {
      const r = deriveRank(0);
      expect(r.index).toBe(1);
      expect(r.progress).toBe(0);
      expect(r.nextThreshold).toBe(100);
    });
    it('is rank 2 exactly at the threshold', () => {
      expect(deriveRank(100).index).toBe(2);
    });
    it('clamps negatives to rank 1', () => {
      expect(deriveRank(-5).index).toBe(1);
    });
    it('caps at the top rank with null next and progress 1', () => {
      const r = deriveRank(99999);
      expect(r.index).toBe(5);
      expect(r.nextThreshold).toBeNull();
      expect(r.progress).toBe(1);
    });
    it('reports fractional progress', () => {
      expect(deriveRank(50).progress).toBeCloseTo(0.5, 5);
    });
  });

  describe('renownGain', () => {
    it('awards points under the cap', () => {
      expect(renownGain('explore', 0)).toBe(SOURCES.explore.points);
    });
    it('awards 0 at/over the cap', () => {
      expect(renownGain('explore', SOURCES.explore.dailyCap)).toBe(0);
      expect(renownGain('explore', SOURCES.explore.dailyCap + 3)).toBe(0);
    });
  });

  describe('isRenownSource', () => {
    it('accepts known sources and rejects others', () => {
      expect(isRenownSource('purchase')).toBe(true);
      expect(isRenownSource('nope')).toBe(false);
    });
  });
});
