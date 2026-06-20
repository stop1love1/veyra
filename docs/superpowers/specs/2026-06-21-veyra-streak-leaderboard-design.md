# Veyra — "Quay lại & Đua top": Daily Streak + Leaderboard

**Ngày:** 2026-06-21
**Trạng thái:** Spec (chờ duyệt)
**Phạm vi:** Sub-project #1 của lộ trình tăng trưởng — giữ chân (streak) + xã hội/đua top (leaderboard). Server-authoritative, gắn lên hệ Renown đã có.

## 1. Bối cảnh & mục tiêu

Hệ Renown/Rank + quest đã chạy (server-owned: `User.renown`, `POST /me/progress`, `/me/quests`, `/me/vouchers`). Bước này thêm hai đòn bẩy *rẻ và cộng hưởng* để thu hút user:

- **Daily Streak** — biến daily check-in (hiện claim-1-lần) thành **chuỗi ngày liên tiếp** có thưởng leo thang; khai thác tâm lý sợ mất chuỗi (loss aversion) → quay lại mỗi ngày.
- **Leaderboard Tastemaker** — xếp hạng công khai theo `renown`; tạo cạnh tranh + bằng chứng xã hội, và là "thứ để khoe" — mồi cho referral/share (sub-project sau).

Cả hai dựa thẳng trên `renown` đã có nên chi phí thấp.

### Lộ trình lớn (toàn cảnh — chỉ #1 trong spec này)
1. **(spec này)** Streak + Leaderboard — giữ chân + xã hội.
2. Referral + thẻ khoe — kéo người mới.
3. Bộ sưu tập Look (Collector) — chơi sâu.

## 2. Daily Streak

### 2.1 Dữ liệu (User schema)
Thêm vào `server/src/users/schemas/user.schema.ts`:
- `streakCount: number` (default 0) — số ngày liên tiếp hiện tại.
- `streakLastDay: string` (default '') — YYYY-MM-DD (giờ server) của lần điểm danh gần nhất.
- `streakBest: number` (default 0) — chuỗi dài nhất từng đạt.

Expose `streakCount`, `streakBest` qua `/auth/me` (PublicUser).

### 2.2 Endpoint `POST /me/checkin`
Thay cho việc WorldScreen gọi `recordRenown('daily')`. Logic server (trong `ProgressionService` hoặc service mới):
- `today = dayKey()` (giờ server).
- Nếu `streakLastDay == today` → **đã điểm danh**: trả `{ alreadyToday: true, streak, reward: 0 }`, không cộng.
- Nếu `streakLastDay == hôm qua` → `streakCount += 1`.
- Ngược lại → `streakCount = 1` (đứt chuỗi, bắt đầu lại).
- Cập nhật `streakLastDay = today`, `streakBest = max(streakBest, streakCount)`.
- Tính **thưởng theo chu kỳ 7 ngày** (xem 2.3): `$inc` coins + renown vào User; cũng tăng quest `d-checkin` (tái dùng cơ chế bump theo source 'daily') và cấp voucher nếu là mốc ngày 7.
- Trả `{ alreadyToday: false, streak: streakCount, best, reward: { coins, renown, voucherCode? }, rank }`.

> Lưu ý: voucher mốc ngày 7 cấp qua `UserVoucher` (idempotent theo unique (userId, voucherId)), giống cách quest claim cấp voucher. Dùng một voucher seed riêng, ví dụ code `STREAK7`.

### 2.3 Bảng thưởng (chu kỳ 7 ngày, vòng lặp)
`day = ((streakCount - 1) % 7) + 1`:

| day | coins | renown | voucher |
|---|---|---|---|
| 1 | 20 | 10 | — |
| 2 | 25 | 10 | — |
| 3 | 30 | 12 | — |
| 4 | 35 | 12 | — |
| 5 | 40 | 15 | — |
| 6 | 45 | 15 | — |
| **7** | 100 | 30 | `STREAK7` |

Bảng để trong hằng số server (`progression.logic.ts` hoặc `streak.logic.ts`) + pure function `streakReward(streakCount)` — **có unit test**.

### 2.4 Frontend
- `api/client.ts`: `checkin(): Promise<ApiCheckinResult>`; `PublicUser += streakCount, streakBest`.
- `useGameState.ts`: state `streak`, `streakBest`; `checkin()` thay `recordRenown('daily')` ở `WorldScreen` mount (gọi 1 lần/mount; server tự bỏ qua nếu đã điểm danh hôm nay). Adopt streak từ `/auth/me` + kết quả checkin.
- **Chip chuỗi** trên Hộ chiếu (và HUD): "🔥 {streak} ngày" (xám khi 0).
- **Popup nhận thưởng** khi `alreadyToday=false`: hiện ngày chuỗi + phần thưởng; tái dùng style overlay (giống RankUp).
- Đứt chuỗi: không popup riêng; chip về 1 và lời nhắc "Đừng để đứt chuỗi!".

### 2.5 Non-goal
- Không "vé giữ chuỗi"/ngày ân hạn (để dành sau). Đứt là reset.
- Không thông báo đẩy (push) — chỉ in-app.

## 3. Leaderboard Tastemaker

### 3.1 Endpoint `GET /leaderboard?limit=20`
- Public. Trả top N user theo `renown` giảm dần, lọc `renown > 0`.
- Mỗi dòng: `{ position, name, avatarHue, renown, rankIndex, rankName }` (rank suy từ `deriveRank`). `name` trống → "Lữ khách". KHÔNG lộ email.
- Khi request có token: trả kèm `me: { position, renown, rankName }` (vị trí của người gọi trong toàn bảng, kể cả ngoài top N) — tính bằng `countDocuments({ renown: { $gt: myRenown } }) + 1`.
- Shape: `{ top: LeaderRow[], me?: { position, renown, rankName } }`.

`avatarHue` lấy từ `User.avatar.hue`.

### 3.2 Frontend
- `api/client.ts`: `getLeaderboard(limit?): Promise<ApiLeaderboard>`.
- **Tab "Bảng xếp hạng"** trong `PassportScreen` (cạnh nội dung hộ chiếu): danh sách top 20, huy hiệu 🥇🥈🥉 cho top 3, **tô đậm dòng "bạn"**; nếu người gọi ngoài top 20, ghim 1 dòng cuối "Bạn · hạng {position}".
- Fetch khi mở tab; offline → ẩn gọn (empty state).

### 3.3 Non-goal
- Chỉ bảng *toàn cục, all-time*. Bảng theo tuần / bạn bè để dành.

## 4. Kiến trúc & file đụng tới

**Server:**
- `users/schemas/user.schema.ts` — thêm 3 field streak.
- `auth/auth.service.ts` (PublicUser + toPublic) — thêm streakCount/streakBest.
- `progression/streak.logic.ts` (mới, pure) — `streakReward(streakCount)` + bảng; `.spec.ts`.
- `progression/progression.service.ts` — `checkin(userId)`, `leaderboard(limit, viewerId?)`.
- `progression/progression.controller.ts` — `POST /me/checkin`, `GET /leaderboard` (public).
- `seed/seed.ts` — thêm voucher `STREAK7` (percent, ví dụ 15%); không cần quest mới.

**Client:**
- `lib/api/client.ts` — `checkin`, `getLeaderboard`, types, PublicUser += streak.
- `lib/game/useGameState.ts` — streak state + `checkin()` + `leaderboard` fetch helper; thay `recordRenown('daily')` ở WorldScreen.
- `lib/game/types.ts` — Game thêm `streak`, `streakBest`, `checkin`, leaderboard cache/getter.
- `features/world/WorldScreen.tsx` — gọi `g.checkin()` thay `recordRenown('daily')`.
- `features/passport/PassportScreen.tsx` — chip streak + tab leaderboard.
- `components/overlays/` — popup nhận thưởng streak (hoặc tái dùng flash/RankUp style).
- `globals.css` — style chip/leaderboard/streak popup.

## 5. Kiểm thử
- Server: unit test `streakReward` (chu kỳ 7, mốc ngày 7) + logic checkin (nối/đứt/đã-điểm-danh) qua test thuần; leaderboard query (memory mongo nếu có, hoặc tin tsc + e2e smoke). e2e smoke: checkin 2 lần (lần 2 alreadyToday), leaderboard trả đúng thứ tự.
- Client: tsc sạch; vitest hiện có vẫn pass.

## 6. Câu hỏi mở
- Voucher mốc `STREAK7`: tạm percent 15% (chỉnh khi vào plan).
- Bảng thưởng streak là số khởi tạo — tinh chỉnh theo dữ liệu.
