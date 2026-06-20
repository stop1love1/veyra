// Referral code generator. Pure (rand injectable) so it is unit-testable.
// Charset excludes easily-confused glyphs (I, O, 0, 1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 6;

export function genCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return out;
}

export { ALPHABET as REFERRAL_ALPHABET };
