# Veyra — Bộ sưu tập Look (Collector engagement)

**Ngày:** 2026-06-21
**Trạng thái:** Spec (chờ duyệt)
**Phạm vi:** Sub-project #4 (cuối lộ trình tăng trưởng) — chơi sâu (engagement) cho trụ cột Collector. Server sở hữu định nghĩa + claim/reward; điều kiện hoàn thành do FE báo (giống mô hình `recordProgress`).

## 1. Bối cảnh
Renown/streak/leaderboard/referral đã chạy server-side. Trụ cột Collector (Rank 4) cần cơ chế thật: **bộ sưu tập look** với phễu *favorite → mua*. `favorites`/`cart` hiện FE-local; checkout là mock (không order thật) → server không tự xác minh được, nên dùng mô hình client-reported + server cấp thưởng/giữ cờ (như `recordProgress`).

## 2. Cơ chế
Mỗi bộ = tập sản phẩm + **2 tầng**:
- **Đã phối (styled):** favorite đủ tất cả món → thưởng nhỏ (coins + renown).
- **Đã sở hữu (owned):** mua đủ tất cả món → thưởng lớn (coins + renown + voucher/huy hiệu).
Mỗi tầng claim đúng 1 lần.

## 3. Backend (server-owned)
### 3.1 Schema
- `Collection` (seed, `@Schema timestamps`): `key: string (unique)`, `title: I18n`, `productIds: string[]` (FE catalog ids), `styledReward: {coins, renown}`, `ownedReward: {coins, renown, voucherCode?}`, `active: boolean`.
- `UserCollection`: `{ userId, collectionKey: string, styledClaimed: boolean, ownedClaimed: boolean }`, unique `(userId, collectionKey)`.

### 3.2 Service `CollectionsService`
- `listActive()` → active collections.
- `listForUser(userId)` → `[{ collection, userCollection|null }]` (giống quests listForUser).
- `claim(userId, key, tier)`:
  - tìm collection theo key (404 nếu không có).
  - tier ∈ {'styled','owned'}; field cờ tương ứng.
  - atomically set cờ `…Claimed=true` (filter cờ=false → đảm bảo 1 lần, conflict nếu đã claim).
  - `$inc` reward (coins+renown) vào User; nếu owned có `voucherCode` → cấp UserVoucher (idempotent, như quests.claim).
  - gọi `referral.maybeAwardReferral(userId)` sau khi renown tăng.
  - trả UserCollection mới.

### 3.3 Endpoints (CollectionsController)
- `@Public() GET /collections` → listActive.
- `GET /me/collections` (auth) → listForUser.
- `POST /me/collections/:key/claim` (auth, body `{tier}`) → claim.

### 3.4 Module
`CollectionsModule` imports UsersModule + VouchersModule (UserVoucher/Voucher) + ReferralModule; provides CollectionsService; đăng ký ở app.module. Schema Collection + UserCollection qua MongooseModule.forFeature.

### 3.5 Seed (idempotent, upsert theo key)
- *Thanh lịch công sở* (`work-elegant`): `['blazer','trousers','tote']`; styled {coins:40,renown:30}; owned {coins:200,renown:80, voucherCode:'WELCOME10'}.
- *Dạo phố cuối tuần* (`weekend-casual`): `['linen','skirt','knit']`; styled {coins:40,renown:30}; owned {coins:200,renown:80, voucherCode:'FREESHIP'}.
(Voucher codes đã seed sẵn.)

## 4. Frontend
### 4.1 Theo dõi sở hữu (FE-local)
- Thêm `purchased: string[]` vào persisted state (veyra_state). Ghi khi thanh toán: tại CheckoutScreen "payNow", trước khi `go('success')`, gọi `g.recordPurchase(cartProductIds)` (gộp unique vào `purchased`).
- `favorites` đã có.

### 4.2 API + state
- api: `getCollections()`, `getMyCollections()`, `claimCollection(key, tier)`. Types `ApiCollection`, `ApiUserCollection`, `ApiCollectionEntry`.
- useGameState: `collections: ApiCollectionEntry[]` + `refreshCollections()`; `claimCollection(key,tier)` → POST rồi re-sync (me + collections); `purchased` + `recordPurchase`.
- Helper hoàn thành: `styledDone = productIds.every(id => favorites.includes(id))`; `ownedDone = productIds.every(id => purchased.includes(id))`.

### 4.3 UI (PassportScreen)
- Khối **"Bộ sưu tập"** (tab info, dưới Trụ cột): mỗi bộ hiện tên + 2 hàng tiến trình (Phối x/n, Sở hữu x/n) + nút **Nhận** cho từng tầng (bật khi đủ & chưa claim; "Đã nhận" khi rồi).
- `g.refreshCollections()` khi mở.

## 5. Kiểm thử
- Server: unit test `claim` logic thuần nếu tách được (hoặc tin tsc + e2e). e2e smoke: GET /collections trả 2 bộ; claim styled khi… (server không kiểm điều kiện → claim luôn được nếu chưa claim; test cấp thưởng + cờ + chống claim lặp); claim owned cấp voucher.
- Client: tsc sạch; vitest pass. Helper styledDone/ownedDone test nếu tách pure.

## 6. Non-goal
- Không tạo order thật; không chuyển favorites lên server; server KHÔNG xác minh điều kiện (client-reported, giống recordProgress) — chống lặp bằng cờ claim 1 lần.

## 7. Câu hỏi mở
- Mức thưởng (styled 40/30, owned 200/80) — số khởi tạo.
- Mở rộng catalog để có nhiều bộ hơn — sau.
