import { genCode, REFERRAL_CODE_LENGTH, REFERRAL_ALPHABET } from './referral.codegen';

describe('genCode', () => {
  it('returns a code of the fixed length', () => {
    expect(genCode()).toHaveLength(REFERRAL_CODE_LENGTH);
  });
  it('uses only the safe alphabet (no I/O/0/1)', () => {
    for (let i = 0; i < 50; i++) {
      for (const ch of genCode()) expect(REFERRAL_ALPHABET).toContain(ch);
    }
    expect(REFERRAL_ALPHABET).not.toMatch(/[IO01]/);
  });
  it('is deterministic for a seeded rand', () => {
    const seq = [0, 0.5, 0.99, 0.25, 0.75, 0.1];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    let j = 0;
    const rand2 = () => seq[j++ % seq.length];
    expect(genCode(rand)).toBe(genCode(rand2));
  });
});
