# Veyra Collections Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** Look collections with a favorite→buy funnel: styled tier (favorite all) + owned tier (purchase all), each claimed once for a reward. Server owns definitions + claim state + reward; completion is client-reported.

**Tech Stack:** NestJS + Mongoose (jest), Next 16 + React 19 (vitest).

## Global Constraints
- Bilingual `{vi,en}`; VN default. Server from `server/`, client from `client/`.
- Completion (favorite/purchase) is FE-local + client-reported (favorites local; new FE `purchased[]`). Server grants reward + one-time claim flag (no server-side condition check) — same trust model as recordProgress.
- DO NOT commit unless asked.

---

### Task 1: Collection + UserCollection schemas + service + module + endpoints + seed
**Files:** `server/src/collections/schemas/collection.schema.ts`, `schemas/user-collection.schema.ts`, `collections.service.ts`, `collections.controller.ts`, `collections.module.ts`, `dto/claim-collection.dto.ts`; modify `seed/seed.ts`, `app.module.ts`.
- [ ] `collection.schema.ts`: `key (unique)`, `title (I18nSchema)`, `productIds: [String]`, `styledReward {coins,renown}` (sub-schema), `ownedReward {coins,renown,voucherCode?}`, `active (default true)`.
- [ ] `user-collection.schema.ts`: `userId (ObjectId)`, `collectionKey (String)`, `styledClaimed (bool)`, `ownedClaimed (bool)`; unique index `(userId, collectionKey)`.
- [ ] `claim-collection.dto.ts`: `@IsIn(['styled','owned']) tier`.
- [ ] `collections.service.ts`: inject Collection, UserCollection, User, Voucher, UserVoucher models + ReferralService. `listActive()`, `listForUser(userId)` (join like quests), `claim(userId, key, tier)`:
  - find collection by key (404); pick `field = tier==='styled'?'styledClaimed':'ownedClaimed'`, `reward = tier==='styled'?styledReward:ownedReward`.
  - ensure a UserCollection exists (`updateOne {userId,collectionKey} $setOnInsert{styledClaimed:false,ownedClaimed:false} upsert`).
  - atomic claim: `findOneAndUpdate({userId,collectionKey,[field]:false},{$set:{[field]:true}},{new:true})`; if null → ConflictException('already claimed').
  - `$inc` user coins+renown; if owned `voucherCode` → resolve voucher + create UserVoucher (idempotent E11000 swallow).
  - `await referral.maybeAwardReferral(userId)`.
  - return updated UserCollection.
- [ ] `collections.controller.ts`: `@Public() GET /collections` → listActive; `GET /me/collections` → listForUser; `POST /me/collections/:key/claim` (body ClaimCollectionDto) → claim.
- [ ] `collections.module.ts`: MongooseModule.forFeature(Collection, UserCollection) + imports UsersModule, VouchersModule, ReferralModule; provide CollectionsService; controller.
- [ ] seed: upsert 2 collections (work-elegant: blazer/trousers/tote, voucher WELCOME10; weekend-casual: linen/skirt/knit, voucher FREESHIP); styled {40,30}, owned {200,80,voucher}.
- [ ] app.module: import + register CollectionsModule.
- [ ] `npx tsc --noEmit -p tsconfig.json` clean; `npx jest` pass.

### Task 2: Client API + state + purchase tracking
**Files:** `lib/api/client.ts`, `lib/game/useGameState.ts`, `lib/game/types.ts`, `features/checkout/CheckoutScreen.tsx`.
- [ ] api: types `ApiCollection {key,title,productIds,styledReward,ownedReward}`, `ApiUserCollection {styledClaimed,ownedClaimed}`, `ApiCollectionEntry {collection,userCollection}`. Methods `getCollections`, `getMyCollections`, `claimCollection(key,tier)`.
- [ ] useGameState: persisted `purchased: string[]` (PersistedState + state + persist effect); `recordPurchase(ids)` (union into purchased); `collections` state + `refreshCollections()` (authed); `claimCollection(key,tier)` → POST then refresh me (coins/renown) + collections + progress (voucher). Reset `collections=[]` on logout. Add to g + deps + Game type. `purchased` exposed on g.
- [ ] CheckoutScreen payNow: `g.recordPurchase(g.cart.map(l=>l.id))` before `g.go('success')`.
- [ ] tsc clean.

### Task 3: Passport Collections UI + strings + css
**Files:** `features/passport/PassportScreen.tsx`, `data/strings.ts`, `globals.css`.
- [ ] In info tab, after pillars (or after rewards): "Bộ sưu tập" section. For each entry: title; two rows — Phối {styledDone count}/{n} + claim btn (styled), Sở hữu {ownedDone}/{n} + claim btn (owned). `styledDone = productIds.every(id=>g.favorites.includes(id))`, `ownedDone = productIds.every(id=>g.purchased.includes(id))`. Btn enabled when done && !claimed; label Nhận/Đã nhận.
- [ ] `g.refreshCollections()` on passport mount (add to existing effect).
- [ ] strings: `collections`, `styled`, `owned`. css `.v-coll*`.
- [ ] tsc clean; `npm test` pass.

### Task 4: Verify e2e
- [ ] `npm run seed` (adds collections); start server. Smoke: `GET /collections` → 2; `POST /me/collections/work-elegant/claim {tier:'styled'}` → reward + flag; repeat → 409; claim owned → voucher granted; `GET /me/collections` shows flags.
- [ ] client tsc + vitest.

## Self-Review
- Spec §3 schemas/service/endpoints/seed → T1. §4 client/purchased/UI → T2,T3. §5 testing → T1,T4. ✓
- Placeholder scan: reward numbers explicit; claim logic concrete. ✓
- Type consistency: `claim(userId,key,tier)`, `ApiCollectionEntry`, `getCollections/getMyCollections/claimCollection`, `recordPurchase`, `purchased` consistent. ✓
