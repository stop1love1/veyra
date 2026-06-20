# Veyra Renown/Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a progression storyline ("Renown/Rank") to Veyra where every commerce action earns Renown that climbs a 5-rank ladder, with rank/quest milestones granting real, checkout-usable rewards — built with clean seams for future O2O layers.

**Architecture:** A pure Renown engine (`renown.ts`) defines ranks + per-source point rules and is fully unit-tested. Game state (`useGameState.ts`) holds `renown`, `earnedRewards`, `questProgress`, and funnels every gain through a single `recordRenown(source)` (the seam for later QR/check-in sources). UI surfaces (QuestsScreen, a new PassportScreen, HUD chip, story dialogue) read derived rank state. Game→Real bridge grants voucher entitlements applied at checkout.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest 4 (test runner: `npm test` → `vitest run`), localStorage persistence.

## Global Constraints

- All user-facing copy is bilingual `{ vi, en }` (`Localized` from `client/app/data/types.ts`). Vietnamese is the default/fallback.
- Run all commands from `client/` directory. Test command: `npm test` (vitest). Single file: `npx vitest run app/lib/game/renown.test.ts`.
- Persistence: bump `STATE_VERSION` in `useGameState.ts` from `1` to `2`; the existing loader drops mismatched versions, so add migration defaults rather than relying on old blobs.
- Renown is local-only (like coins today — no server write endpoint exists). Do not add server calls.
- Follow existing code style: callbacks via `React.useCallback`, refs for stable reads, no new dependencies.
- Engine (`renown.ts`) must stay pure (no React, no Date side-effects in exported math fns except where a day-key string is passed in).

---

### Task 1: Renown engine (pure, tested)

**Files:**
- Create: `client/app/lib/game/renown.ts`
- Test: `client/app/lib/game/renown.test.ts`

**Interfaces:**
- Produces:
  - `type RenownSource = 'daily' | 'explore' | 'stylist' | 'curate' | 'purchase' | 'qr-scan' | 'checkin' | 'event'`
  - `interface RankInfo { index: number; name: Localized; threshold: number; nextThreshold: number | null; progress: number }`
  - `const RANKS: { index: number; name: Localized; threshold: number }[]`
  - `const SOURCES: Record<RenownSource, { points: number; dailyCap: number }>`
  - `function deriveRank(renown: number): RankInfo`
  - `function renownGain(source: RenownSource, earnedTodayForSource: number): number`

- [ ] **Step 1: Write the failing test**

```typescript
// client/app/lib/game/renown.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `client/`): `npx vitest run app/lib/game/renown.test.ts`
Expected: FAIL — cannot resolve `./renown`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// client/app/lib/game/renown.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/game/renown.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add client/app/lib/game/renown.ts client/app/lib/game/renown.test.ts
git commit -m "feat(game): pure Renown engine — ranks, source rules, derivation"
```

---

### Task 2: Quest data model + ladder

**Files:**
- Modify: `client/app/data/types.ts` (extend `Quest`)
- Create: `client/app/data/quests.ts`
- Modify: `client/app/data/rewards.ts` (re-export QUESTS from new file; keep VOUCHERS)
- Test: `client/app/data/quests.test.ts`

**Interfaces:**
- Consumes: `RenownSource` from `lib/game/renown.ts`.
- Produces:
  - Extended `Quest`: adds `source: RenownSource`, `renown: number`, `chapter: number` (0 = daily/repeatable, 1..4 = story), `repeatable?: boolean`, `rewardId?: string`, `locked?: boolean`. Keeps existing `id, reward, prog, goal, daily?, title`. `prog` becomes the seed/baseline only — live progress is tracked in game state.
  - `const QUESTS: Quest[]` (the full ladder from the spec).

- [ ] **Step 1: Extend the Quest type**

```typescript
// client/app/data/types.ts — replace the existing Quest interface
import type { RenownSource } from '../lib/game/renown';

export interface Quest {
  id: string;
  reward: Localized;
  prog: number;            // baseline seed; live progress lives in game state
  goal: number;
  daily?: boolean;
  title: Localized;
  source: RenownSource;    // which Renown source this quest feeds
  renown: number;          // Renown awarded on claim
  chapter: number;         // 0 = daily/repeatable, 1..4 = story chapter
  repeatable?: boolean;
  rewardId?: string;       // voucher id granted into earnedRewards on claim
  locked?: boolean;        // coming-soon placeholder (e.g. real-world QR)
}
```

Note: `types.ts` importing from `lib/game/renown` is safe — `renown.ts` only imports `Localized` back from `types.ts` as a *type*, so there is no runtime cycle (type-only imports are erased).

- [ ] **Step 2: Write the failing test**

```typescript
// client/app/data/quests.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/data/quests.test.ts`
Expected: FAIL — cannot resolve `./quests`.

- [ ] **Step 4: Create the quest ladder**

```typescript
// client/app/data/quests.ts
// Story quest ladder: every quest feeds the Renown engine via its `source`,
// climbing the 5-rank arc across 4 district chapters. Chapter 0 = daily.
import type { Quest } from './types';

export const QUESTS: Quest[] = [
  // ── Chapter 0: daily / repeatable ──
  { id: 'd-checkin', chapter: 0, daily: true, repeatable: true, source: 'daily',
    prog: 0, goal: 1, renown: 10, reward: { vi: '+20 xu', en: '+20 coins' },
    title: { vi: 'Điểm danh Veyra', en: 'Veyra check-in' } },
  { id: 'd-stroll', chapter: 0, daily: true, repeatable: true, source: 'explore',
    prog: 0, goal: 1, renown: 5, reward: { vi: 'Danh vọng', en: 'Renown' },
    title: { vi: 'Dạo 1 quận bất kỳ', en: 'Stroll a district' } },

  // ── Chapter 1 → Rank 2 · Khách quen (Aria · Mira) ──
  { id: 'c1-explore', chapter: 1, source: 'explore', prog: 0, goal: 3, renown: 30,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Khám phá 3 cửa hàng', en: 'Explore 3 shops' } },
  { id: 'c1-stylist', chapter: 1, source: 'stylist', prog: 0, goal: 1, renown: 30,
    rewardId: 'WELCOME10', reward: { vi: 'Voucher 10%', en: '10% voucher' },
    title: { vi: 'Trò chuyện cùng stylist Mira', en: 'Chat with stylist Mira' } },
  { id: 'c1-curate', chapter: 1, source: 'curate', prog: 0, goal: 3, renown: 20,
    reward: { vi: '+30 xu', en: '+30 coins' },
    title: { vi: 'Lưu 3 món vào yêu thích', en: 'Save 3 favorites' } },

  // ── Chapter 2 → Rank 3 · Cư dân (Lumen · Noa) ──
  { id: 'c2-stylist', chapter: 2, source: 'stylist', prog: 0, goal: 1, renown: 30,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Soi da & tư vấn cùng Noa', en: 'Skin scan with Noa' } },
  { id: 'c2-buy', chapter: 2, source: 'purchase', prog: 0, goal: 1, renown: 60,
    rewardId: 'FREESHIP', reward: { vi: 'Miễn phí ship', en: 'Free shipping' },
    title: { vi: 'Hoàn tất đơn hàng đầu tiên', en: 'Complete first order' } },
  { id: 'c2-look', chapter: 2, source: 'curate', prog: 0, goal: 3, renown: 40,
    reward: { vi: 'Huy hiệu', en: 'Badge' },
    title: { vi: 'Phối 1 "look" hoàn chỉnh', en: 'Style a full look' } },

  // ── Chapter 3 → Rank 4 · Người sành điệu (Nest · Theo) ──
  { id: 'c3-cats', chapter: 3, source: 'purchase', prog: 0, goal: 2, renown: 60,
    reward: { vi: '+80 xu', en: '+80 coins' },
    title: { vi: 'Mua ở 2 danh mục khác nhau', en: 'Buy across 2 categories' } },
  { id: 'c3-collection', chapter: 3, source: 'curate', prog: 0, goal: 1, renown: 80,
    reward: { vi: 'Huy hiệu hiếm', en: 'Rare badge' },
    title: { vi: 'Hoàn thành 1 bộ sưu tập look', en: 'Complete a look collection' } },
  { id: 'c3-review', chapter: 3, source: 'curate', prog: 0, goal: 1, renown: 40,
    reward: { vi: '+50 xu', en: '+50 coins' },
    title: { vi: 'Đánh giá 1 sản phẩm đã mua', en: 'Review a purchase' } },

  // ── Chapter 4 → Rank 5 · Công dân Veyra (Pulse · Vi) ──
  { id: 'c4-allfour', chapter: 4, source: 'explore', prog: 0, goal: 4, renown: 60,
    reward: { vi: '+100 xu', en: '+100 coins' },
    title: { vi: 'Ghé đủ cả 4 quận', en: 'Visit all 4 districts' } },
  { id: 'c4-loyal', chapter: 4, source: 'purchase', prog: 0, goal: 3, renown: 120,
    rewardId: 'VEYRA50', reward: { vi: 'Giảm 50.000₫', en: '50,000₫ off' },
    title: { vi: 'Đạt mốc chi tiêu trung thành', en: 'Reach loyalty spend' } },
  { id: 'c4-qr', chapter: 4, source: 'qr-scan', prog: 0, goal: 1, renown: 150,
    locked: true, reward: { vi: 'Sắp ra mắt', en: 'Coming soon' },
    title: { vi: 'Quét QR tại cửa hàng thật', en: 'Scan QR at a real store' } },
];
```

- [ ] **Step 5: Re-export from rewards.ts**

Replace the `QUESTS` array literal in `client/app/data/rewards.ts` with a re-export (keep `VOUCHERS` as-is):

```typescript
// client/app/data/rewards.ts
import type { Voucher } from './types';
export { QUESTS } from './quests';

export const VOUCHERS: Voucher[] = [
  { id: 'WELCOME10', off: 0.1,    label: { vi: 'Giảm 10%', en: '10% off' },  note: { vi: 'Tối đa 50k', en: 'Up to 50k' } },
  { id: 'VEYRA50',   off: 50000,  label: { vi: 'Giảm 50.000₫', en: '50,000₫ off' }, note: { vi: 'Đơn từ 500k', en: 'Orders from 500k' } },
  { id: 'FREESHIP',  off: 0, ship: true, label: { vi: 'Miễn phí ship', en: 'Free shipping' }, note: { vi: 'Mọi đơn', en: 'Any order' } },
];
```

Verify `client/app/data/index.ts` still exposes `QUESTS`/`VOUCHERS` via the `VEYRA` namespace (it re-exports from `rewards`). If it imports the array directly, no change needed.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run app/data/quests.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/app/data/types.ts client/app/data/quests.ts client/app/data/quests.test.ts client/app/data/rewards.ts
git commit -m "feat(data): Renown quest ladder across 4 story chapters"
```

---

### Task 3: Game state — renown, rewards, quest progress, funnel

**Files:**
- Modify: `client/app/lib/game/types.ts` (extend `Game`, `PersistedState` consumers)
- Modify: `client/app/lib/game/useGameState.ts`
- Test: `client/app/lib/game/recordRenown.test.ts` (pure helper extracted for testing)

**Interfaces:**
- Consumes: `deriveRank`, `renownGain`, `RenownSource` from `renown.ts`; `QUESTS` from data.
- Produces (added to `Game`):
  - `renown: number`
  - `rank: import('./renown').RankInfo`
  - `recordRenown(source: RenownSource): void`
  - `questProgress: Record<string, number>`
  - `bumpQuest(id: string, by?: number): void`
  - `earnedRewards: string[]`
  - `hasReward(id: string): boolean`
  - `grantReward(id: string): void`
  - extend `claimQuest(id: string, reward: number, renown?: number, rewardId?: string): void`
- Produces (helper, exported from a new pure module for testability):
  - `client/app/lib/game/renownLedger.ts`: `applyRenown(ledger: RenownLedger, source, dayKey): RenownLedger` where `interface RenownLedger { renown: number; day: string; today: Record<string, number> }`.

- [ ] **Step 1: Write the failing test for the pure ledger**

```typescript
// client/app/lib/game/recordRenown.test.ts
import { describe, it, expect } from 'vitest';
import { applyRenown, emptyLedger } from './renownLedger';
import { SOURCES } from './renown';

describe('applyRenown', () => {
  it('adds source points on a fresh day', () => {
    const next = applyRenown(emptyLedger(), 'explore', '2026-06-20');
    expect(next.renown).toBe(SOURCES.explore.points);
    expect(next.today.explore).toBe(1);
    expect(next.day).toBe('2026-06-20');
  });
  it('stops awarding once the daily cap is hit', () => {
    let l = emptyLedger();
    for (let i = 0; i < SOURCES.explore.dailyCap + 3; i++) {
      l = applyRenown(l, 'explore', '2026-06-20');
    }
    expect(l.renown).toBe(SOURCES.explore.points * SOURCES.explore.dailyCap);
  });
  it('resets the daily counters when the day changes', () => {
    let l = applyRenown(emptyLedger(), 'explore', '2026-06-20');
    l = applyRenown(l, 'explore', '2026-06-21');
    expect(l.today.explore).toBe(1);
    expect(l.day).toBe('2026-06-21');
    expect(l.renown).toBe(SOURCES.explore.points * 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/game/recordRenown.test.ts`
Expected: FAIL — cannot resolve `./renownLedger`.

- [ ] **Step 3: Implement the pure ledger**

```typescript
// client/app/lib/game/renownLedger.ts
// Pure daily-capped Renown accumulator. Day rollover resets per-source counts.
import { renownGain, type RenownSource } from './renown';

export interface RenownLedger {
  renown: number;
  day: string;                       // YYYY-MM-DD (local) of `today` counts
  today: Record<string, number>;     // events counted per source for `day`
}

export function emptyLedger(): RenownLedger {
  return { renown: 0, day: '', today: {} };
}

export function applyRenown(ledger: RenownLedger, source: RenownSource, dayKey: string): RenownLedger {
  const sameDay = ledger.day === dayKey;
  const today = sameDay ? { ...ledger.today } : {};
  const usedToday = today[source] ?? 0;
  const gain = renownGain(source, usedToday);
  today[source] = usedToday + (gain > 0 ? 1 : 0);
  return { renown: ledger.renown + gain, day: dayKey, today };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/game/recordRenown.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire ledger + rewards into useGameState**

In `client/app/lib/game/useGameState.ts`:

1. Add imports at top:
```typescript
import { deriveRank, type RenownSource } from './renown';
import { applyRenown, emptyLedger, type RenownLedger } from './renownLedger';
```

2. Bump version and extend `PersistedState`:
```typescript
const STATE_VERSION = 2;   // was 1
```
```typescript
interface PersistedState {
  lang?: Lang;
  player?: Player;
  screen?: ScreenName;
  params?: ScreenParams;
  cart?: CartLine[];
  coins?: number;
  favorites?: string[];
  claimedQuests?: string[];
  usedVoucher?: string | null;
  renownLedger?: RenownLedger;
  earnedRewards?: string[];
  questProgress?: Record<string, number>;
}
```

3. Add state hooks (next to the other `useState`s):
```typescript
const [renownLedger, setRenownLedger] = React.useState<RenownLedger>(saved.renownLedger || emptyLedger());
const [earnedRewards, setEarnedRewards] = React.useState<string[]>(saved.earnedRewards || []);
const [questProgress, setQuestProgress] = React.useState<Record<string, number>>(saved.questProgress || {});
```

4. Add stable refs after the existing refs:
```typescript
const earnedRef = React.useRef(earnedRewards); earnedRef.current = earnedRewards;
```

5. Add to the persist effect's `state` object and its dependency array:
```typescript
state: { lang, player, screen, params, cart, coins, favorites, claimedQuests, usedVoucher,
         renownLedger, earnedRewards, questProgress },
```
(append `renownLedger, earnedRewards, questProgress` to the effect deps array too.)

6. Add the local day-key helper (module scope, near `deriveLevel`):
```typescript
// Local calendar day key (YYYY-MM-DD) for daily Renown caps.
function dayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
```

7. Add the funnel + reward callbacks (near `claimQuest`):
```typescript
const recordRenown = React.useCallback((source: RenownSource) => {
  setRenownLedger((l) => applyRenown(l, source, dayKey()));
}, []);

const hasReward = React.useCallback((id: string) => earnedRef.current.includes(id), []);
const grantReward = React.useCallback((id: string) => {
  // SEAM (layer B→real): today this records a local entitlement. When a
  // coupon-issuing endpoint exists, swap the body to call it and store the
  // returned code — callers/UI stay unchanged.
  setEarnedRewards((r) => (r.includes(id) ? r : [...r, id]));
}, []);

const bumpQuest = React.useCallback((id: string, by: number = 1) => {
  setQuestProgress((p) => ({ ...p, [id]: (p[id] ?? 0) + by }));
}, []);
```

8. Replace the existing `claimQuest` to also award Renown + reward:
```typescript
const claimQuest = React.useCallback((id: string, reward: number, renown: number = 0, rewardId?: string) => {
  if (claimedRef.current.includes(id)) return;
  claimedRef.current = [...claimedRef.current, id];
  setClaimedQuests(claimedRef.current);
  if (renown > 0) setRenownLedger((l) => applyRenown({ ...l, renown: l.renown + renown }, '__manual__' as RenownSource, l.day || dayKey()));
  if (rewardId) setEarnedRewards((r) => (r.includes(rewardId) ? r : [...r, rewardId]));
  if (reward > 0) {
    setCoins((v) => v + reward);
    flashMsg('+' + reward + ' ' + t('coinUnit'));
  } else {
    flashMsg(t('flashRewardGot'));
  }
}, [flashMsg, t]);
```
Note: the `'__manual__'` source has no SOURCES entry, so `renownGain` returns 0 and the cap logic is bypassed — we add the quest's fixed `renown` directly via the spread. Keep this explicit so quest Renown is not daily-capped (story rewards should always pay out).

9. Compute derived rank and add everything to the `g` memo:
```typescript
const rank = React.useMemo(() => deriveRank(renownLedger.renown), [renownLedger.renown]);
```
Add to the `g` object literal:
```typescript
renown: renownLedger.renown, rank, recordRenown,
questProgress, bumpQuest,
earnedRewards, hasReward, grantReward,
```
Add `renownLedger.renown, rank, questProgress, earnedRewards, recordRenown, bumpQuest, hasReward, grantReward` to the `g` memo dependency array.

10. Update `Game` interface in `client/app/lib/game/types.ts`:
```typescript
import type { RankInfo, RenownSource } from './renown';
// ...inside Game, after the coins block:
renown: number;
rank: RankInfo;
recordRenown: (source: RenownSource) => void;
questProgress: Record<string, number>;
bumpQuest: (id: string, by?: number) => void;
earnedRewards: string[];
hasReward: (id: string) => boolean;
grantReward: (id: string) => void;
// and update the claimQuest signature:
claimQuest: (id: string, reward: number, renown?: number, rewardId?: string) => void;
```

- [ ] **Step 6: Typecheck + full test run**

Run (from `client/`): `npx tsc --noEmit` then `npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/app/lib/game/renownLedger.ts client/app/lib/game/recordRenown.test.ts client/app/lib/game/useGameState.ts client/app/lib/game/types.ts
git commit -m "feat(game): renown ledger, quest progress, earned rewards in state"
```

---

### Task 4: Hook recordRenown into commerce actions

**Files:**
- Modify: `client/app/lib/game/useGameState.ts` (toggleFavorite → curate)
- Modify: `client/app/features/success/SuccessScreen.tsx` (order → purchase)
- Modify: `client/app/features/store/StoreScreen.tsx` or `WorldScreen.tsx` (visit shop → explore)
- Modify: `client/app/components/overlays/NpcDialogue.tsx` (talk → stylist)

**Interfaces:**
- Consumes: `g.recordRenown` from Task 3.

- [ ] **Step 1: Curate on favorite (add)**

In `toggleFavorite` (`useGameState.ts`), award Renown only when adding (not removing):
```typescript
const toggleFavorite = React.useCallback((id: string) => {
  setFavorites((f) => {
    const adding = !f.includes(id);
    if (adding) setRenownLedger((l) => applyRenown(l, 'curate', dayKey()));
    return adding ? [...f, id] : f.filter((x) => x !== id);
  });
}, []);
```

- [ ] **Step 2: Explore on shop visit**

Find where a shop opens (search for `go('store'` in `WorldScreen.tsx`/`StoreScreen.tsx`). At the store-open entry point, call `g.recordRenown('explore')` once per open. If the store screen mounts per visit, add in a mount effect keyed on `params.shop`:
```typescript
React.useEffect(() => { g.recordRenown('explore'); }, [g.params.shop]);
```
(Place inside `StoreScreen`, guarded so it fires on each distinct shop.)

- [ ] **Step 3: Stylist on NPC dialogue open**

In `NpcDialogue.tsx`, add a mount effect:
```typescript
React.useEffect(() => { g.recordRenown('stylist'); }, [g.npcOpen]);
```

- [ ] **Step 4: Purchase on order success**

In `SuccessScreen.tsx`, add a mount effect that fires once:
```typescript
React.useEffect(() => { g.recordRenown('purchase'); }, []);
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open the app: visit a shop, open an NPC, favorite an item, complete a checkout. Confirm via React devtools or a temporary `console.log(g.renown)` that renown increases for each (respecting caps). Remove any temp logs.

- [ ] **Step 6: Commit**

```bash
git add client/app/lib/game/useGameState.ts client/app/features/success/SuccessScreen.tsx client/app/features/store/StoreScreen.tsx client/app/components/overlays/NpcDialogue.tsx
git commit -m "feat(game): feed Renown from explore/stylist/curate/purchase actions"
```

---

### Task 5: QuestsScreen — live progress + Renown/reward claim

**Files:**
- Modify: `client/app/features/quests/QuestsScreen.tsx`

**Interfaces:**
- Consumes: `g.questProgress`, `g.claimQuest`, quest fields `renown`, `rewardId`, `locked`, `chapter`.

- [ ] **Step 1: Use live progress + pass renown/reward on claim**

Replace the quest mapping so progress reads from `g.questProgress[q.id] ?? q.prog`, locked quests are visibly disabled, and claim passes the new args:
```tsx
{tab === 'quests' && VEYRA.QUESTS.map((q) => {
  const prog = g.questProgress[q.id] ?? q.prog;
  const full = prog >= q.goal;
  const claimed = g.claimedQuests.includes(q.id);
  const canClaim = full && !claimed && !q.locked;
  return (
    <div key={q.id} className={'v-quest' + (q.locked ? ' is-locked' : '')}>
      <div className={'v-quest-ic' + (full ? ' is-done' : '')}>
        <Ic name={q.locked ? 'lock' : q.daily ? 'spark' : 'quest'} size={20} />
      </div>
      <div className="v-quest-mid">
        <div className="v-quest-title">{VEYRA.tx(q.title, g.lang)}</div>
        <div className="v-quest-bar"><span style={{ width: Math.min(100, prog / q.goal * 100) + '%' }} /></div>
        <div className="v-mono v-quest-prog">{Math.min(prog, q.goal)}/{q.goal} · +{q.renown} {g.t('renownUnit')} · {VEYRA.tx(q.reward, g.lang)}</div>
      </div>
      <button
        className={'v-quest-claim' + (canClaim ? ' is-on' : '')}
        disabled={!canClaim}
        onClick={() => g.claimQuest(q.id, questCoins(q), q.renown, q.rewardId)}
      >
        {q.locked ? g.t('comingSoon') : claimed ? g.t('claimed') : full ? g.t('claim') : ''}
      </button>
    </div>
  );
})}
```

- [ ] **Step 2: Add strings**

In `client/app/data/strings.ts` add:
```typescript
renownUnit:  { vi: 'DV',          en: 'RP' },
comingSoon:  { vi: 'Sắp ra mắt', en: 'Coming soon' },
lock_:       { vi: 'Khoá',        en: 'Locked' },
```
And ensure an `Ic name="lock"` icon exists in `components/ui/Icon.tsx`; if not, add a simple lock glyph (copy an existing icon entry's structure).

- [ ] **Step 3: Manual verification + typecheck**

Run `npx tsc --noEmit`. Run `npm run dev`, open Quests: progress bars reflect real actions, claimed quests award coins + renown + (where set) a voucher into `earnedRewards`, locked quest shows "Sắp ra mắt" and cannot be claimed.

- [ ] **Step 4: Commit**

```bash
git add client/app/features/quests/QuestsScreen.tsx client/app/data/strings.ts client/app/components/ui/Icon.tsx
git commit -m "feat(quests): live progress, Renown + real-reward claims, locked quests"
```

---

### Task 6: Passport screen + HUD rank chip

**Files:**
- Create: `client/app/features/passport/PassportScreen.tsx`
- Modify: `client/app/features/index.ts` (export)
- Modify: `client/app/lib/game/types.ts` (`ScreenName` += `'passport'`)
- Modify: `client/app/App.tsx` (register screen)
- Modify: `client/app/components/hud/HudDock.tsx` or `HudTop.tsx` (entry point + rank chip)

**Interfaces:**
- Consumes: `g.rank`, `g.renown`, `g.earnedRewards`, `RANKS`, `QUESTS`.

- [ ] **Step 1: Add the screen name**

In `types.ts`: `... | 'quests' | 'passport' | 'seller' | 'admin-map';`

- [ ] **Step 2: Build PassportScreen**

```tsx
// client/app/features/passport/PassportScreen.tsx
import React from 'react';
import { VEYRA } from '../../data';
import { RANKS } from '../../lib/game/renown';
import { Ic, Coin } from '../../components/ui';
import { HudDock } from '../../components/hud';
import type { ScreenProps } from '../../lib/game/types';

const PILLARS = [
  { rank: 2, icon: 'spark',  label: { vi: 'Gu thẩm mỹ', en: 'Tastemaker' } },
  { rank: 3, icon: 'map',    label: { vi: 'Công dân',    en: 'Citizen' } },
  { rank: 4, icon: 'quest',  label: { vi: 'Sưu tầm',     en: 'Collector' } },
  { rank: 5, icon: 'ticket', label: { vi: 'Nội bộ',      en: 'Insider' } },
] as const;

export function PassportScreen({ g, embed }: ScreenProps) {
  const { rank, renown } = g;
  const next = rank.nextThreshold;
  const body = (
    <div className="v-passport">
      <div className="v-pp-card">
        <div className="v-pp-rank">{VEYRA.tx(rank.name, g.lang)}</div>
        <div className="v-pp-sub v-mono">{renown} {g.t('renownUnit')}{next ? ` / ${next}` : ''}</div>
        <div className="v-quest-bar"><span style={{ width: (rank.progress * 100) + '%' }} /></div>
      </div>

      <div className="v-pp-section">{g.t('pillars')}</div>
      <div className="v-pp-pillars">
        {PILLARS.map((p) => {
          const open = rank.index >= p.rank;
          return (
            <div key={p.rank} className={'v-pp-pillar' + (open ? ' is-on' : '')}>
              <Ic name={open ? p.icon : 'lock'} size={20} />
              <span>{VEYRA.tx(p.label, g.lang)}</span>
              <span className="v-mono v-pp-need">{open ? g.t('unlocked') : 'R' + p.rank}</span>
            </div>
          );
        })}
      </div>

      <div className="v-pp-section">{g.t('rewards')}</div>
      <div className="v-pp-rewards">
        {g.earnedRewards.length === 0 && <div className="v-pp-empty">{g.t('noRewards')}</div>}
        {g.earnedRewards.map((id) => {
          const vc = VEYRA.VOUCHERS.find((v) => v.id === id);
          return <div key={id} className="v-vcard is-on"><Ic name="ticket" size={22} />
            <span>{vc ? VEYRA.tx(vc.label, g.lang) : id}</span></div>;
        })}
      </div>
    </div>
  );
  if (embed) return <div className="v-embed">{body}</div>;
  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('passport')}</span>
        <Coin value={g.coins} size="sm" />
      </div>
      {body}
      <HudDock g={g} active="profile" />
    </div>
  );
}
```

- [ ] **Step 3: Register + export + strings**

`features/index.ts`: `export { PassportScreen } from './passport/PassportScreen';`
`App.tsx`: import `PassportScreen` and add `passport: PassportScreen,` to `SCREENS`.
`strings.ts` add: `passport {vi:'Hộ chiếu Veyra',en:'Veyra Passport'}`, `pillars {vi:'Trụ cột',en:'Pillars'}`, `unlocked {vi:'Đã mở',en:'Unlocked'}`, `noRewards {vi:'Chưa có phần thưởng',en:'No rewards yet'}`.

- [ ] **Step 4: HUD rank chip → opens passport**

In `HudTop.tsx` (or wherever level/coins show), render the rank name and make it navigate:
```tsx
<button className="v-rankchip" onClick={() => g.go('passport')}>
  {VEYRA.tx(g.rank.name, g.lang)}
</button>
```
Add minimal `.v-rankchip` / `.v-passport` styles near the existing quest styles in the global stylesheet (search for `.v-quest-bar` to find the file).

- [ ] **Step 5: Typecheck + manual check**

`npx tsc --noEmit`; `npm run dev`: rank chip shows current rank, opens the passport, pillars lock/unlock by rank, earned rewards list populates after claiming a reward quest.

- [ ] **Step 6: Commit**

```bash
git add client/app/features/passport/ client/app/features/index.ts client/app/lib/game/types.ts client/app/App.tsx client/app/components/hud/ client/app/data/strings.ts
git commit -m "feat(passport): Veyra Passport screen + HUD rank chip"
```

---

### Task 7: Story beats — prologue, rank-up overlay, NPC milestones

**Files:**
- Create: `client/app/data/story.ts`
- Create: `client/app/components/overlays/RankUp.tsx`
- Modify: `client/app/components/overlays/index.ts`
- Modify: `client/app/App.tsx` (render RankUp overlay)
- Modify: `client/app/lib/game/useGameState.ts` (detect rank crossing)
- Modify: `client/app/features/gate/GuardDialogue.tsx` (prologue hook line)

**Interfaces:**
- Consumes: `g.rank`, `RANKS`, story data.
- Produces: `RANK_BEATS: Record<number, Localized>` in `story.ts`; `rankUp: number | null` + `dismissRankUp()` on `Game`.

- [ ] **Step 1: Story data**

```typescript
// client/app/data/story.ts
import type { Localized } from './types';

// Hook line gated at the gate (prologue) — sets the season-long goal.
export const PROLOGUE: Localized = {
  vi: 'Ai cũng vào được Veyra. Nhưng ở lại được hay không là chuyện khác.',
  en: 'Anyone can enter Veyra. Whether you belong here is another matter.',
};

// Recognition line shown when the player reaches each rank (keyed by rank index).
export const RANK_BEATS: Record<number, Localized> = {
  2: { vi: 'Vài cửa hàng đã bắt đầu nhớ mặt bạn.', en: 'A few shops are starting to remember you.' },
  3: { vi: 'Bạn đã có một chỗ đứng ở Veyra — chào mừng cư dân mới.', en: 'You have a place in Veyra now — welcome, resident.' },
  4: { vi: 'Gu của bạn được cả khu công nhận.', en: 'Your taste is recognized across the district.' },
  5: { vi: 'Bạn giờ là người trong cuộc. Cánh cửa nội bộ Veyra đã mở.', en: 'You are an insider now. Veyra\'s inner doors are open to you.' },
};
```

- [ ] **Step 2: Detect rank crossing in state**

In `useGameState.ts`, add `rankUp` state and an effect comparing previous rank index:
```typescript
const [rankUp, setRankUp] = React.useState<number | null>(null);
const prevRankRef = React.useRef(0);
React.useEffect(() => {
  const idx = deriveRank(renownLedger.renown).index;
  if (prevRankRef.current && idx > prevRankRef.current) setRankUp(idx);
  prevRankRef.current = idx;
}, [renownLedger.renown]);
const dismissRankUp = React.useCallback(() => setRankUp(null), []);
```
Initialize `prevRankRef.current` from the loaded renown so an existing player doesn't trigger a spurious popup on first mount — set it in a `useRef(deriveRank(saved.renownLedger?.renown ?? 0).index)` instead of `useRef(0)`.
Add `rankUp` and `dismissRankUp` to `g` and the `Game` type.

- [ ] **Step 3: RankUp overlay**

```tsx
// client/app/components/overlays/RankUp.tsx
import React from 'react';
import { VEYRA } from '../../data';
import { RANKS } from '../../lib/game/renown';
import { RANK_BEATS } from '../../data/story';
import { Ic } from '../ui';
import type { Game } from '../../lib/game/types';

export function RankUp({ g }: { g: Game }) {
  const idx = g.rankUp;
  if (idx == null) return null;
  const rank = RANKS.find((r) => r.index === idx);
  const beat = RANK_BEATS[idx];
  return (
    <div className="v-rankup" role="dialog" onClick={g.dismissRankUp}>
      <div className="v-rankup-card" onClick={(e) => e.stopPropagation()}>
        <Ic name="spark" size={32} />
        <div className="v-rankup-rank">{rank ? VEYRA.tx(rank.name, g.lang) : ''}</div>
        {beat && <div className="v-rankup-beat">{VEYRA.tx(beat, g.lang)}</div>}
        <button className="v-quest-claim is-on" onClick={g.dismissRankUp}>{g.t('continue')}</button>
      </div>
    </div>
  );
}
```
Export from `components/overlays/index.ts`; render in `App.tsx` near the other overlays: `{g.rankUp != null && <RankUp g={g} />}`. Add `.v-rankup*` styles near `.v-flash`.

- [ ] **Step 4: Prologue line at the gate**

In `GuardDialogue.tsx`, import `PROLOGUE` and show it once in the guard's opening copy (append below `guardAskName`/`guardAskTicket` flavor, using `VEYRA.tx(PROLOGUE, g.lang)`). Keep it non-blocking (display only).

- [ ] **Step 5: Typecheck + manual check**

`npx tsc --noEmit`; `npm run dev`: earn enough Renown (claim a couple of quests) to cross a rank → overlay appears with the recognition beat; dismiss works; gate shows the prologue hook line.

- [ ] **Step 6: Commit**

```bash
git add client/app/data/story.ts client/app/components/overlays/RankUp.tsx client/app/components/overlays/index.ts client/app/App.tsx client/app/lib/game/useGameState.ts client/app/lib/game/types.ts client/app/features/gate/GuardDialogue.tsx
git commit -m "feat(story): prologue hook, rank-up overlay, NPC recognition beats"
```

---

### Task 8: Game→Real — apply earned vouchers at checkout

**Files:**
- Modify: `client/app/features/checkout/CheckoutScreen.tsx`

**Interfaces:**
- Consumes: `g.earnedRewards`, `g.useVoucher`, `VEYRA.VOUCHERS`.

- [ ] **Step 1: Surface earned vouchers as selectable at checkout**

In `CheckoutScreen.tsx`, where vouchers are applied, filter the selectable list to include `VEYRA.VOUCHERS` the player has earned (`g.earnedRewards.includes(v.id)`) plus any always-available welcome voucher, and apply the real discount via the existing voucher math. Show earned ones with a "đã mở khoá / unlocked" tag. Reuse the existing `g.useVoucher(id)` + discount calculation already wired into cart/checkout totals — do not duplicate the math.

- [ ] **Step 2: Manual verification**

`npm run dev`: claim a reward quest (e.g. `c1-stylist` → WELCOME10), go to checkout, confirm the earned voucher is selectable and reduces the real order total; a not-yet-earned voucher is not selectable.

- [ ] **Step 3: Commit**

```bash
git add client/app/features/checkout/CheckoutScreen.tsx
git commit -m "feat(checkout): apply Renown-earned vouchers to real order total"
```

---

## Self-Review

**Spec coverage:**
- §2 ranks/arc → Task 1 (RANKS) + Task 7 (beats/prologue). ✓
- §3 Renown engine + single funnel + daily cap → Task 1 + Task 3 (`applyRenown`, `recordRenown`). ✓
- §3.3 four pillars as rank gates → Task 6 (PassportScreen PILLARS). Tastemaker/Citizen/Collector deeper mechanics deferred (spec §8 step 7 "theo từng phần") — passport surfaces the gating now; richer per-pillar behavior is a follow-up plan. ✓ (noted)
- §4 game→real earnedRewards/grantReward/checkout → Task 3 + Task 8. ✓
- §5 story delivery (prologue, NPC milestone, passport, rank-up) → Tasks 6, 7. ✓
- §6 state/version/files → Task 3. ✓
- §7 quest ladder → Task 2. ✓
- §8 build sequence → Tasks ordered 1→8. ✓
- §9 non-goals (no QR/GPS/server) → respected; qr-scan quest is `locked`. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. The one runtime seam (`grantReward`) is intentionally documented, not a placeholder.

**Type consistency:** `recordRenown(source)`, `applyRenown(ledger, source, dayKey)`, `deriveRank(renown): RankInfo`, `renownGain(source, count)`, `claimQuest(id, reward, renown?, rewardId?)`, `RenownLedger {renown, day, today}` used consistently across Tasks 1, 3, 4, 5, 7.

**Known follow-ups (out of this plan, for later specs):** richer Collector "look collections", Citizen district unlock on the 3D map, Tastemaker personalized NPC picks, and layers C/D/E (QR/GPS/O2O/events) via the `RenownSource` seam.
