// Pure daily-streak rules: the escalating 7-day reward cycle + the
// continue/reset/same-day decision. Free of Nest/Mongo so it is unit-testable.

export interface StreakReward {
  coins: number;
  renown: number;
  voucherCode?: string;
}

// Voucher granted at the day-7 milestone of each streak cycle.
export const STREAK_VOUCHER_CODE = 'STREAK7';

const TABLE: { coins: number; renown: number }[] = [
  { coins: 20, renown: 10 },
  { coins: 25, renown: 10 },
  { coins: 30, renown: 12 },
  { coins: 35, renown: 12 },
  { coins: 40, renown: 15 },
  { coins: 45, renown: 15 },
  { coins: 100, renown: 30 },
];

/** Reward for the Nth consecutive day. Day 7 of each cycle adds the voucher. */
export function streakReward(streakCount: number): StreakReward {
  const day = ((Math.max(1, streakCount) - 1) % 7) + 1;
  const base = TABLE[day - 1];
  return day === 7 ? { ...base, voucherCode: STREAK_VOUCHER_CODE } : { ...base };
}

export type CheckinOutcome = 'continued' | 'reset' | 'same-day';

/** Decide how today's check-in relates to the last one (by YYYY-MM-DD keys). */
export function streakOutcome(
  lastDay: string,
  today: string,
  yesterday: string,
): CheckinOutcome {
  if (lastDay === today) return 'same-day';
  if (lastDay === yesterday) return 'continued';
  return 'reset';
}
