import {
  streakReward,
  streakOutcome,
  STREAK_VOUCHER_CODE,
} from './streak.logic';

describe('streakReward', () => {
  it('day 1 gives the base reward, no voucher', () => {
    expect(streakReward(1)).toEqual({ coins: 20, renown: 10 });
  });
  it('day 7 gives the milestone reward + voucher', () => {
    expect(streakReward(7)).toEqual({ coins: 100, renown: 30, voucherCode: STREAK_VOUCHER_CODE });
  });
  it('day 8 cycles back to day-1 reward', () => {
    expect(streakReward(8)).toEqual(streakReward(1));
  });
  it('day 14 is another milestone', () => {
    expect(streakReward(14).voucherCode).toBe(STREAK_VOUCHER_CODE);
  });
  it('clamps non-positive counts to day 1', () => {
    expect(streakReward(0)).toEqual(streakReward(1));
  });
});

describe('streakOutcome', () => {
  it('same-day when last == today', () => {
    expect(streakOutcome('2026-06-21', '2026-06-21', '2026-06-20')).toBe('same-day');
  });
  it('continued when last == yesterday', () => {
    expect(streakOutcome('2026-06-20', '2026-06-21', '2026-06-20')).toBe('continued');
  });
  it('reset when last is older (or empty)', () => {
    expect(streakOutcome('2026-06-18', '2026-06-21', '2026-06-20')).toBe('reset');
    expect(streakOutcome('', '2026-06-21', '2026-06-20')).toBe('reset');
  });
});
