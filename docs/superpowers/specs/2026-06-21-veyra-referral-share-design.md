# Veyra — Referral + Thẻ khoe (acquisition)

**Ngày:** 2026-06-21
**Trạng thái:** Spec (chờ duyệt)
**Phạm vi:** Sub-project #3 của lộ trình tăng trưởng — kéo người mới (viral loop). Server-authoritative, gắn lên Renown/Rank đã có.

## 1. Bối cảnh & mục tiêu
Hệ Renown/Rank/streak/leaderboard đã chạy server-side. Bước này biến người chơi gắn bó thành **kênh marketing**: khoe thẻ → bạn bè vào qua mã mời → **khi bạn đó đạt Rank 2, cả hai cùng nhận thưởng**.

Vòng lặp: Hộ chiếu/thẻ khoe (mang mã) → link `/u/:code` + ảnh OG → bạn bấm "Vào Veyra" (`/?ref=CODE`) → đăng ký gắn `referredBy` → referee chơi tới Rank 2 → thưởng cả hai.

### Lộ trình lớn (chỉ #3 trong spec này)
1. ✅ Streak + Leaderboard. **2.** ❌ Bộ sưu tập Look (sau). **3. (spec này)** Referral + share.

## 2. Referral (mời bạn)

### 2.1 Dữ liệu (User schema)
- `referralCode: string` — duy nhất, 6 ký tự base32 (chữ HOA + số, bỏ ký tự dễ nhầm), sinh khi đăng ký (retry nếu trùng).
- `referredBy: Types.ObjectId | null` (default null) — ai đã mời mình.
- `referralRewarded: boolean` (default false) — đã trả thưởng cho cặp (referrer, this) chưa.
- `referralCount: number` (default 0) — số lượt mời thành công của user (để khoe).

Index: `referralCode` unique.

### 2.2 Đăng ký
`POST /auth/register` (RegisterDto) nhận thêm `referralCode?: string`:
- Sinh `referralCode` riêng cho user mới (unique).
- Nếu `referralCode` truyền vào hợp lệ và KHÁC mã của chính mình → resolve referrer, set `referredBy = referrer._id`. Mã sai/không có → bỏ qua, vẫn đăng ký thành công.

### 2.3 Mốc trả thưởng = đạt Rank 2 (renown ≥ 100)
Helper `maybeAwardReferral(userId)` trong `ProgressionService`, gọi **sau mọi lần renown tăng** (recordEvent, checkin, quests.claim):
- Load user; nếu `renown < 100` hoặc `!referredBy` hoặc `referralRewarded` → return.
- Atomically set `referralRewarded=true` (findOneAndUpdate với filter `referralRewarded:false` → đảm bảo chạy 1 lần).
- `$inc` thưởng:
  - referee (this user): +50 xu, +30 renown.
  - referrer (`referredBy`): +100 xu, +60 renown, +1 `referralCount`.
- (Số là khởi tạo, tinh chỉnh sau.)

> Vì `quests.claim` nằm ở `QuestsService` (module khác), gọi `maybeAwardReferral` ở đó cần inject `ProgressionService` HOẶC nhân đôi logic. Quyết định: đặt `maybeAwardReferral` trong `ProgressionService`, export; `QuestsModule` import `ProgressionModule`? → tránh vòng phụ thuộc (ProgressionModule import QuestsModule). **Giải pháp:** đặt helper ở một service không phụ thuộc Quests — gọi `maybeAwardReferral` chỉ tại `recordEvent` + `checkin` (đủ phủ: renown tăng qua event/checkin là chính). Quest claim cũng tăng renown nhưng người chơi chắc chắn cũng có event/checkin → mốc sẽ kích hoạt ở lần renown-tăng kế tiếp. Để chắc chắn, thêm gọi ở `quests.claim` bằng cách inject một `ReferralService` nhẹ (chỉ phụ thuộc User model), tránh vòng. **Chốt:** tạo `ReferralService` (chỉ inject User model) chứa `maybeAwardReferral`; cả ProgressionService và QuestsService inject nó.

### 2.4 Endpoint
- `GET /me/referral` (auth) → `{ code, count }`. Link do FE dựng từ code.
- `GET /u/:code` (public) → thẻ công khai (mục 3.1).

## 3. Thẻ khoe (public page + ảnh OG)

### 3.1 Public profile endpoint
`GET /u/:code` (public, không cần token): tìm user theo `referralCode`; trả
`{ name, avatarHue, rankName: {vi,en}, rankIndex, renown, streak, referralCount }`. Không có → 404. KHÔNG lộ email/id.

### 3.2 Frontend (Next App Router)
**LƯU Ý (AGENTS.md):** đọc `node_modules/next/dist/docs/` cho route động, metadata, và `next/og` `ImageResponse` TRƯỚC khi code phần này.
- **Trang công khai** `client/app/u/[code]/page.tsx` (server component): fetch `GET /u/:code` (server-side, BASE_URL nội bộ), render thẻ tĩnh (rank, 🔥 streak, danh vọng, lượt mời) + nút **"Vào Veyra"** → `/?ref=CODE`. Nếu 404 → trang "không tìm thấy" nhẹ + CTA vào Veyra.
- **Ảnh OG động** `client/app/u/[code]/opengraph-image.tsx` (`next/og` `ImageResponse`): vẽ thẻ (tên, rank, danh vọng, streak) trên nền thương hiệu. `generateMetadata` của page trỏ OG/twitter image vào đây để link unfurl. Ảnh cũng là file tải về.
- **Đọc `?ref=CODE`**: ở App shell, khi mount đọc query `ref`; lưu vào localStorage `veyra_ref` (chờ tới khi đăng ký). Truyền vào `auth.register(... referralCode)`. Sau đăng ký thành công → xoá `veyra_ref`.
- **Mục "Mời bạn"** trong `PassportScreen` (tab info hoặc khối riêng): hiện mã + link `'{origin}/u/{code}'` + nút **Copy** + **Share** (Web Share API nếu có) + số lượt mời (`count`) + link "Xem thẻ của tôi".

### 3.3 API client + state
- `api/client.ts`: `getReferral()` → `{code,count}`; `getPublicProfile(code)` → card; `register` thêm `referralCode?`.
- `useGameState`: `referral` state `{code,count}` + `refreshReferral()`; đọc/ghi `veyra_ref` cho register.

## 4. File đụng tới
**Server:** `users/schemas/user.schema.ts` (4 field), `auth/dto/register.dto.ts` (+referralCode), `auth/auth.service.ts` (sinh code, gán referredBy, expose code/count optionally), `referral/referral.service.ts` (+ module, maybeAwardReferral, code-gen util + test), `referral/referral.controller.ts` (`GET /me/referral`, `GET /u/:code`), `progression/progression.service.ts` + `quests/quests.service.ts` (gọi maybeAwardReferral), `app.module.ts`.
**Client:** `lib/api/client.ts`, `lib/game/useGameState.ts`, `lib/game/types.ts`, `app/u/[code]/page.tsx` (mới), `app/u/[code]/opengraph-image.tsx` (mới), `components/auth/AuthModal.tsx` + `features/gate/GateTicket.tsx` (referralCode khi register), `features/passport/PassportScreen.tsx` (mục Mời bạn), `data/strings.ts`, `globals.css`.

## 5. Kiểm thử
- Server: unit test code-gen (độ dài/charset/không trùng trên tập mẫu) + `maybeAwardReferral` thuần (điều kiện rank/đã-thưởng/không-tự-mời). e2e smoke: register B với mã của A → B đẩy renown ≥100 → cả A,B nhận thưởng đúng 1 lần; `GET /u/:codeA` trả thẻ.
- Client: tsc sạch; vitest pass. Trang `/u/:code` build được (Next).

## 6. Non-goal
- Không analytics/tracking click; không referral nhiều cấp (1 cấp); không chống gian lận nâng cao (đa tài khoản cùng thiết bị) ngoài mốc Rank 2 + cờ 1-lần.

## 7. Câu hỏi mở
- Mức thưởng referral (100/60 vs 50/30) — số khởi tạo.
- `referralCode` có nên cho user tự đặt (vanity) không? Tạm: tự sinh, không cho đổi.
