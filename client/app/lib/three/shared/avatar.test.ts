import { describe, it, expect } from 'vitest';
import { ageProportions, EXPRESSIONS as EXPR_, EMOTES as EMO_, clamp, lerp } from './avatar';

// String-indexable views for the table-driven assertions below.
const EXPRESSIONS = EXPR_ as Record<string, { eyeOpen: number; browY: number; browTilt: number; mouth: string }>;
const EMOTES = EMO_ as Record<string, { dur: number; expr: string }>;

describe('clamp / lerp', () => {
  it('clamps to bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-2, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it('lerps endpoints', () => {
    expect(lerp(2, 4, 0)).toBe(2);
    expect(lerp(2, 4, 1)).toBe(4);
    expect(lerp(2, 4, 0.5)).toBe(3);
  });
});

describe('ageProportions', () => {
  it('makes a 6-year-old small with a relatively large head, no aging', () => {
    const p = ageProportions(6);
    expect(p.bodyScale).toBeCloseTo(0.66, 5);
    expect(p.headRatio).toBeCloseTo(1.35, 5);
    expect(p.aging).toBe(0);
    expect(p.stoop).toBe(0);
    expect(p.hairGrey).toBe(0);
  });

  it('reaches adult proportions by 20 and holds', () => {
    const a20 = ageProportions(20);
    const a35 = ageProportions(35);
    expect(a20.bodyScale).toBeCloseTo(1.0, 5);
    expect(a20.headRatio).toBeCloseTo(1.0, 5);
    expect(a35.bodyScale).toBeCloseTo(1.0, 5);
    expect(a35.headRatio).toBeCloseTo(1.0, 5);
    expect(a35.aging).toBe(0);
  });

  it('ages a 70-year-old: fully grey, stooped, slower', () => {
    const old = ageProportions(70);
    const adult = ageProportions(30);
    expect(old.aging).toBeCloseTo(1, 5);
    expect(old.hairGrey).toBeCloseTo(1, 5);
    expect(old.stoop).toBeGreaterThan(0.1);
    expect(old.idleRate).toBeLessThan(adult.idleRate);
    expect(old.stepRate).toBeLessThan(adult.stepRate);
  });

  it('grows monotonically from child to adult', () => {
    let prev = -Infinity;
    for (let age = 6; age <= 20; age += 2) {
      const s = ageProportions(age).bodyScale;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('clamps wild / missing ages instead of throwing', () => {
    expect(() => ageProportions(undefined)).not.toThrow();
    expect(ageProportions(2).bodyScale).toBe(ageProportions(4).bodyScale); // clamped low
    expect(ageProportions(200).aging).toBe(1);                              // clamped high
  });
});

describe('EXPRESSIONS / EMOTES tables', () => {
  it('has the five expected expressions with valid mouth shapes', () => {
    const mouths = new Set(['smile', 'frown', 'flat', 'open']);
    for (const name of ['neutral', 'happy', 'surprised', 'sad', 'angry']) {
      expect(EXPRESSIONS[name]).toBeTruthy();
      expect(mouths.has(EXPRESSIONS[name].mouth)).toBe(true);
      expect(typeof EXPRESSIONS[name].eyeOpen).toBe('number');
    }
  });
  it('angry pulls the inner brow down, sad pushes it up', () => {
    expect(EXPRESSIONS.angry.browTilt).toBeLessThan(0);
    expect(EXPRESSIONS.sad.browTilt).toBeGreaterThan(0);
  });
  it('emotes have a positive duration and a known expression', () => {
    for (const k of ['wave', 'celebrate']) {
      expect(EMOTES[k].dur).toBeGreaterThan(0);
      expect(EXPRESSIONS[EMOTES[k].expr]).toBeTruthy();
    }
  });
});
