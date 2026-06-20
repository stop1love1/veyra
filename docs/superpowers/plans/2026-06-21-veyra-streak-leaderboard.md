# Veyra Streak + Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a daily-streak retention loop and a public Tastemaker leaderboard, both server-authoritative on top of the existing Renown system.

**Architecture:** Server owns streak state (3 fields on User) advanced by `POST /me/checkin` with an escalating 7-day reward table (pure, tested), and a `GET /leaderboard` query over `renown`. The client replaces its daily `recordRenown('daily')` call with `checkin()`, shows a streak chip + reward popup, and a leaderboard tab on the passport.

**Tech Stack:** NestJS 11 + Mongoose (server, jest `*.spec.ts`), Next 16 + React 19 + TS (client, vitest).

## Global Constraints
- Bilingual copy `{ vi, en }`; Vietnamese default.
- Server: run from `server/`; tests `npx jest`; typecheck `npx tsc --noEmit -p tsconfig.json`.
- Client: run from `client/`; tests `npm test`; typecheck `npx tsc --noEmit`.
- Progression is account-bound: guests (no token) do not check in / rank.
- DO NOT COMMIT (standing user instruction this session) — leave changes in the working tree. The commit steps below are documented for completeness; skip them.
- Server day key = server-local `YYYY-MM-DD` (reuse the existing `dayKey()` pattern in ProgressionService).

---

### Task 1: Streak reward logic (pure, tested)

**Files:** Create `server/src/progression/streak.logic.ts`, `server/src/progression/streak.logic.spec.ts`

**Produces:**
- `interface StreakReward { coins: number; renown: number; voucherCode?: string }`
- `const STREAK_VOUCHER_CODE = 'STREAK7'`
- `function streakReward(streakCount: number): StreakReward` — uses `((streakCount-1)%7)+1` as the cycle day.
- `type CheckinOutcome = 'continued' | 'reset' | 'same-day'`
- `function streakOutcome(lastDay: string, today: string, yesterday: string): CheckinOutcome`

- [ ] **Step 1: failing test** — assert day 1 = {20,10}, day 7 = {100,30,STREAK7}, day 8 cycles back to day-1 reward; `streakOutcome` returns 'same-day' when lastDay==today, 'continued' when lastDay==yesterday, 'reset' otherwise.
- [ ] **Step 2:** `npx jest streak.logic` → FAIL (no module).
- [ ] **Step 3: implement**

```typescript
// streak.logic.ts
export interface StreakReward { coins: number; renown: number; voucherCode?: string }
export const STREAK_VOUCHER_CODE = 'STREAK7';
const TABLE: { coins: number; renown: number }[] = [
  { coins: 20, renown: 10 }, { coins: 25, renown: 10 }, { coins: 30, renown: 12 },
  { coins: 35, renown: 12 }, { coins: 40, renown: 15 }, { coins: 45, renown: 15 },
  { coins: 100, renown: 30 },
];
export function streakReward(streakCount: number): StreakReward {
  const day = ((Math.max(1, streakCount) - 1) % 7) + 1;
  const base = TABLE[day - 1];
  return day === 7 ? { ...base, voucherCode: STREAK_VOUCHER_CODE } : { ...base };
}
export type CheckinOutcome = 'continued' | 'reset' | 'same-day';
export function streakOutcome(lastDay: string, today: string, yesterday: string): CheckinOutcome {
  if (lastDay === today) return 'same-day';
  if (lastDay === yesterday) return 'continued';
  return 'reset';
}
```

- [ ] **Step 4:** `npx jest streak.logic` → PASS.

---

### Task 2: User streak fields + expose in /auth/me

**Files:** Modify `server/src/users/schemas/user.schema.ts`, `server/src/auth/auth.service.ts`

- [ ] **Step 1:** Add to User schema after `renownToday`:
```typescript
@Prop({ type: Number, default: 0 }) streakCount: number;
@Prop({ type: String, default: '' }) streakLastDay: string;
@Prop({ type: Number, default: 0 }) streakBest: number;
```
- [ ] **Step 2:** `PublicUser` interface += `streakCount: number; streakBest: number;`; `toPublic` returns `streakCount: user.streakCount ?? 0, streakBest: user.streakBest ?? 0`.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` → clean.

---

### Task 3: checkin service + endpoint + STREAK7 seed

**Files:** Modify `server/src/progression/progression.service.ts`, `progression.controller.ts`, `server/src/seed/seed.ts`

**Interfaces:**
- Consumes: `streakReward`, `streakOutcome`, `STREAK_VOUCHER_CODE` (Task 1); `deriveRank` (existing).
- Produces: `ProgressionService.checkin(userId): Promise<CheckinResult>` where
  `interface CheckinResult { alreadyToday: boolean; streak: number; best: number; reward: { coins: number; renown: number; voucherCode?: string }; renown: number; rank: RankInfo }`

- [ ] **Step 1:** In ProgressionService inject `UserVoucher` + `Voucher` models (add to ProgressionModule imports: it already imports QuestsModule [Quest/UserQuest] + UsersModule; also import VouchersModule for UserVoucher/Voucher). Implement `checkin`:
  - load user; `today=dayKey()`, `yesterday` = dayKey(new Date(Date.now()-86400000))… but `Date.now` is fine in Nest runtime. Compute yesterday from a Date.
  - `outcome = streakOutcome(user.streakLastDay, today, yesterday)`.
  - if `same-day`: return `{ alreadyToday: true, streak: user.streakCount, best: user.streakBest, reward: {coins:0,renown:0}, renown: user.renown, rank: deriveRank(user.renown) }`.
  - else compute `newStreak = outcome==='continued' ? user.streakCount+1 : 1`; `reward = streakReward(newStreak)`; `best = max(user.streakBest, newStreak)`.
  - `$set streakCount=newStreak, streakLastDay=today, streakBest=best; $inc renown+=reward.renown, coins+=reward.coins`.
  - bump `d-checkin` quest (reuse the same pipeline update used in recordEvent for source 'daily').
  - if `reward.voucherCode`: resolve voucher by code, idempotently create UserVoucher (same try/catch E11000 pattern as quests.claim).
  - return result with `renown: user.renown + reward.renown`, `rank: deriveRank(...)`.
- [ ] **Step 2:** Controller: `@Post('me/checkin') checkin(@CurrentUser() u) { return this.progression.checkin(u.userId); }`
- [ ] **Step 3:** Seed: add `STREAK7` to the voucher upsert map (`['STREAK7', await upsertVoucher('STREAK7','percent',15)]`).
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.json` → clean; `npx jest` → all pass.

---

### Task 4: leaderboard service + endpoint

**Files:** Modify `server/src/progression/progression.service.ts`, `progression.controller.ts`

**Produces:** `leaderboard(limit: number, viewerId?: string): Promise<{ top: LeaderRow[]; me?: { position: number; renown: number; rankName: I18nType } }>`
where `interface LeaderRow { position: number; name: string; avatarHue: number; renown: number; rankIndex: number; rankName: I18nType }`.

- [ ] **Step 1:** Implement `leaderboard`:
  - `rows = userModel.find({ renown: { $gt: 0 } }).sort({ renown: -1 }).limit(limit).select('name avatar renown').exec()`.
  - map to LeaderRow with `position = i+1`, `name = doc.name || 'Lữ khách'`, `avatarHue = doc.avatar?.hue ?? 0`, `rank = deriveRank(doc.renown)`.
  - if viewerId: load viewer renown; `position = countDocuments({ renown: { $gt: viewerRenown } }) + 1`; include `me`.
- [ ] **Step 2:** Controller: `@Public() @Get('leaderboard') board(@Query('limit') limit?: string, @CurrentUser() u?: AuthUser)`. Note: `@Public()` skips auth, so `@CurrentUser()` may be undefined — read viewerId via `u?.userId`. Parse limit (default 20, clamp 1..100).
  - **Caveat:** with `@Public()` the JwtAuthGuard does not populate `request.user` unless a valid token is present. Confirm the guard still attaches user when a token IS sent on a public route; if not, expose `me` via a separate authenticated call `GET /me/leaderboard-position`. Implement the combined form first; if `me` is always undefined when logged in, split it.
- [ ] **Step 3:** `npx tsc --noEmit` clean; `npx jest` pass.

---

### Task 5: Client API methods + types

**Files:** Modify `client/app/lib/api/client.ts`

- [ ] Add to `PublicUser`: `streakCount?: number; streakBest?: number;`
- [ ] Add types: `ApiCheckinResult`, `ApiLeaderRow`, `ApiLeaderboard` mirroring the server shapes.
- [ ] Add methods: `checkin(): Promise<ApiCheckinResult>` → `http.post('/me/checkin')`; `getLeaderboard(limit=20): Promise<ApiLeaderboard>` → `http.get('/leaderboard', {query:{limit}})`.
- [ ] `npx tsc --noEmit` clean.

---

### Task 6: useGameState — streak + checkin + leaderboard; WorldScreen

**Files:** Modify `client/app/lib/game/useGameState.ts`, `client/app/lib/game/types.ts`, `client/app/features/world/WorldScreen.tsx`

- [ ] State `streak`, `streakBest` (seed from cached user). `streakRewardPopup` (CheckinResult | null) + dismiss.
- [ ] `checkin()` (authed only): `api.checkin()` → set streak/best/renown from result; if `!alreadyToday && (reward.coins||reward.renown)` set popup + refreshProgress (for the granted voucher).
- [ ] `leaderboard` getter: `getLeaderboard()` returns the promise (screen fetches) OR cache state + `refreshLeaderboard()`. Use a `leaderboard` state + `refreshLeaderboard()` callback.
- [ ] Adopt `streakCount/streakBest` in login/register/refresh from `u`.
- [ ] Game type: add `streak: number; streakBest: number; checkin: () => void; streakRewardPopup; dismissStreakReward; leaderboard; refreshLeaderboard`.
- [ ] WorldScreen mount: replace `g.recordRenown('daily')` with `g.checkin()`.
- [ ] `npx tsc --noEmit` clean.

---

### Task 7: Passport streak chip + leaderboard tab + popup + css

**Files:** Modify `client/app/features/passport/PassportScreen.tsx`, add `client/app/components/overlays/StreakReward.tsx`, modify `overlays/index.ts`, `App.tsx`, `globals.css`, `data/strings.ts`

- [ ] Passport: streak chip "🔥 {streak}" near the rank card; tabs `info | leaderboard`. Leaderboard tab calls `g.refreshLeaderboard()` on open, renders top rows (🥇🥈🥉 for top 3, bold "you" by matching `g.auth.user?.id`… but rows have no id; match by position via `me`), pinned `me` row if outside list.
- [ ] StreakReward overlay (mirror RankUp): shows streak day + reward; rendered in App when `g.streakRewardPopup != null`.
- [ ] strings: `streak`, `streakReward`, `leaderboard`, `you`, `keepStreak`.
- [ ] css: `.v-streakchip`, `.v-lb-*`.
- [ ] `npx tsc --noEmit` clean; `npm test` pass.

---

### Task 8: Verify end-to-end
- [ ] `cd server && npm run seed` (Mongo up) — confirms STREAK7 seeds.
- [ ] Start server; smoke: `POST /me/checkin` twice (2nd → alreadyToday:true); `GET /leaderboard` returns sorted rows + `me`.
- [ ] Client tsc + vitest clean.

## Self-Review
- Spec §2 streak data/endpoint/table/FE → Tasks 1,2,3,6,7. ✓
- Spec §3 leaderboard endpoint/FE → Tasks 4,6,7. ✓
- Spec §4 files → covered. ✓ §5 testing → Tasks 1,8. ✓
- Placeholder scan: Task 4 flags a real guard caveat with a concrete fallback (not a TODO). Reward table values are explicit. ✓
- Type consistency: `CheckinResult`/`ApiCheckinResult`, `LeaderRow`/`ApiLeaderRow`, `streakReward`, `streakOutcome` used consistently. ✓
