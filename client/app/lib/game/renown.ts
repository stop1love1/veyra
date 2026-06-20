// Pure progression engine: ranks, per-source point rules, and derivation.
// Stays free of React/state so it is trivially unit-testable. The single
// `recordRenown` funnel in useGameState applies these rules; future O2O
// sources (qr-scan, checkin, event) plug in here with no core changes.
import type { Localized } from '../../data/types';

export type RenownSource =
  | 'daily' | 'explore' | 'stylist' | 'curate' | 'purchase'  // A+B (live)
  | 'qr-scan' | 'checkin' | 'event';                          // C/D/E (seam)

export interface RankInfo {
  index: number;            // 1..5
  name: Localized;
  threshold: number;        // renown at which this rank begins
  nextThreshold: number | null;
  progress: number;         // 0..1 toward next rank (1 at top rank)
}

export const RANKS: { index: number; name: Localized; threshold: number }[] = [
  { index: 1, threshold: 0,    name: { vi: 'Lữ khách',        en: 'Traveler' } },
  { index: 2, threshold: 100,  name: { vi: 'Khách quen',      en: 'Regular' } },
  { index: 3, threshold: 300,  name: { vi: 'Cư dân',          en: 'Resident' } },
  { index: 4, threshold: 700,  name: { vi: 'Người sành điệu', en: 'Connoisseur' } },
  { index: 5, threshold: 1500, name: { vi: 'Công dân Veyra',  en: 'Veyran' } },
];

// points = Renown granted per qualifying event; dailyCap = max events/day
// counted for that source (anti-grind; also the anti-fraud seam for QR/GPS).
export const SOURCES: Record<RenownSource, { points: number; dailyCap: number }> = {
  daily:     { points: 10,  dailyCap: 1 },
  explore:   { points: 10,  dailyCap: 8 },
  stylist:   { points: 15,  dailyCap: 6 },
  curate:    { points: 8,   dailyCap: 10 },
  purchase:  { points: 60,  dailyCap: 20 },
  'qr-scan': { points: 150, dailyCap: 5 },
  checkin:   { points: 40,  dailyCap: 3 },
  event:     { points: 100, dailyCap: 3 },
};

export function deriveRank(renown: number): RankInfo {
  const safe = Math.max(0, renown);
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (safe >= RANKS[i].threshold) idx = i;
  }
  const cur = RANKS[idx];
  const next = RANKS[idx + 1] ?? null;
  const progress = next
    ? (safe - cur.threshold) / (next.threshold - cur.threshold)
    : 1;
  return {
    index: cur.index,
    name: cur.name,
    threshold: cur.threshold,
    nextThreshold: next ? next.threshold : null,
    progress: Math.min(1, Math.max(0, progress)),
  };
}

// Returns Renown to award for one event of `source`, respecting the daily cap.
export function renownGain(source: RenownSource, earnedTodayForSource: number): number {
  const cfg = SOURCES[source];
  if (!cfg) return 0;
  return earnedTodayForSource >= cfg.dailyCap ? 0 : cfg.points;
}
