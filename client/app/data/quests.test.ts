import { describe, it, expect } from 'vitest';
import { QUESTS } from './quests';
import { SOURCES } from '../lib/game/renown';

describe('QUESTS ladder', () => {
  it('has unique ids', () => {
    const ids = QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('uses only known Renown sources', () => {
    for (const q of QUESTS) expect(SOURCES[q.source]).toBeDefined();
  });
  it('has bilingual titles and positive goals', () => {
    for (const q of QUESTS) {
      expect(q.title.vi.length).toBeGreaterThan(0);
      expect(q.title.en.length).toBeGreaterThan(0);
      expect(q.goal).toBeGreaterThan(0);
    }
  });
  it('covers chapters 0 (daily) through 4', () => {
    const chapters = new Set(QUESTS.map((q) => q.chapter));
    [0, 1, 2, 3, 4].forEach((c) => expect(chapters.has(c)).toBe(true));
  });
  it('marks the real-world QR quest as locked', () => {
    const qr = QUESTS.find((q) => q.source === 'qr-scan');
    expect(qr?.locked).toBe(true);
  });
});
