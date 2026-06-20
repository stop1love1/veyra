import { I18nType } from '../common/i18n';

/**
 * Pure progression rules — ranks, per-source point/cap rules, and derivation.
 * Kept free of Nest/Mongo so it is trivially unit-testable and is the single
 * source of truth the client mirrors via GET /progression/config.
 *
 * Future O2O sources (qr-scan, checkin, event) already exist here so the
 * client funnel and the server stay in lock-step without a schema change.
 */
export type RenownSource =
  | 'daily'
  | 'explore'
  | 'stylist'
  | 'curate'
  | 'purchase'
  | 'qr-scan'
  | 'checkin'
  | 'event';

export const RENOWN_SOURCES: RenownSource[] = [
  'daily',
  'explore',
  'stylist',
  'curate',
  'purchase',
  'qr-scan',
  'checkin',
  'event',
];

export interface RankDef {
  index: number;
  name: I18nType;
  threshold: number;
}

export interface RankInfo {
  index: number;
  name: I18nType;
  threshold: number;
  nextThreshold: number | null;
  progress: number;
}

export interface SourceRule {
  points: number;
  dailyCap: number;
}

export const RANKS: RankDef[] = [
  { index: 1, threshold: 0, name: { vi: 'Lữ khách', en: 'Traveler' } },
  { index: 2, threshold: 100, name: { vi: 'Khách quen', en: 'Regular' } },
  { index: 3, threshold: 300, name: { vi: 'Cư dân', en: 'Resident' } },
  { index: 4, threshold: 700, name: { vi: 'Người sành điệu', en: 'Connoisseur' } },
  { index: 5, threshold: 1500, name: { vi: 'Công dân Veyra', en: 'Veyran' } },
];

export const SOURCES: Record<RenownSource, SourceRule> = {
  daily: { points: 10, dailyCap: 1 },
  explore: { points: 10, dailyCap: 8 },
  stylist: { points: 15, dailyCap: 6 },
  curate: { points: 8, dailyCap: 10 },
  purchase: { points: 60, dailyCap: 20 },
  'qr-scan': { points: 150, dailyCap: 5 },
  checkin: { points: 40, dailyCap: 3 },
  event: { points: 100, dailyCap: 3 },
};

export function isRenownSource(v: string): v is RenownSource {
  return Object.prototype.hasOwnProperty.call(SOURCES, v);
}

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

/** Renown to award for one event of `source`, after applying the daily cap. */
export function renownGain(source: RenownSource, earnedTodayForSource: number): number {
  const cfg = SOURCES[source];
  if (!cfg) return 0;
  return earnedTodayForSource >= cfg.dailyCap ? 0 : cfg.points;
}
