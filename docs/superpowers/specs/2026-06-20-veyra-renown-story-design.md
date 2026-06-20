# Veyra — Cốt truyện thăng tiến "Danh vọng" + cầu nối Game ↔ Đời thực

**Ngày:** 2026-06-20
**Trạng thái:** Spec (chờ duyệt)
**Phạm vi spec này:** Lớp **A** (lõi Danh vọng/Rank — cốt truyện thăng tiến) + lớp **B** (Game → Đời thực: phần thưởng thật), **có để sẵn điểm chờ (interface) cho C/D/E**.

---

## 1. Mục tiêu & bối cảnh

Veyra là một **thế giới mua sắm 3D** (Veyra Plaza, phong cách Hà Nội): người chơi tạo nhân vật → qua cổng có bảo vệ → dạo quảng trường → ghé 4 shop (Aria thời trang, Lumen làm đẹp, Nest gia dụng, Pulse công nghệ) → trò chuyện NPC tư vấn (Mira, Noa, Theo, Vi) → mua hàng → làm nhiệm vụ, nhận xu/huy hiệu/voucher. Mọi tương tác đều theo hướng *diegetic* (nhập vai trong thế giới).

**Mục tiêu (do người dùng chốt):**
- **Cân bằng** giữ chân (retention) ↔ chuyển đổi mua hàng.
- Xương sống truyện kiểu **thăng tiến (progression)**.
- Gộp **cả 4 bản sắc đích**: Tastemaker (gu), Citizen (công dân), Collector (sưu tầm), Insider (nội bộ/ưu đãi thật).
- Tầm nhìn cuối: **O2O đầy đủ** (game ↔ đời thực song chiều + sự kiện thật). Spec này làm lát cắt đầu (A+B) và chừa điểm chờ.

### 1.1 Tách lớp (toàn cảnh — KHÔNG làm hết trong spec này)

| | Hệ thống | Hạ tầng | Spec này? |
|---|---|---|---|
| A | Lõi Danh vọng / Rank (cốt truyện, trong game) | frontend + state | ✅ |
| B | Game → Đời thực (rank/quest đổi voucher & giảm giá thật) | dùng lại voucher/đơn/người bán | ✅ |
| C | Đời thực → Game (quét QR, check-in GPS, mua ngoài đời → rank) | QR, định vị, chống gian lận, backend xác minh, merchant | ⛔ seam only |
| D | Phản chiếu O2O (cửa hàng/kho/sự kiện thật vào thế giới 3D) | pipeline merchant, đồng bộ tồn kho | ⛔ tương lai |
| E | Sự kiện & cộng đồng thật (event theo rank, RSVP) | hệ sự kiện, xác minh, vận hành | ⛔ tương lai |

Mỗi lớp về sau có **spec → plan → triển khai riêng**.

---

## 2. Tiền đề & xương sống truyện

**Tiền đề (one-liner):**
> *Veyra là một thành phố mua sắm chỉ mở cửa cho những ai có "gu". Bạn đến như một lữ khách vô danh — và từng bước, bằng con mắt thẩm mỹ của mình, bạn trở thành người mà cả thành phố nể trọng.*

Hệ quả thiết kế: **mọi hành vi thương mại** (xem shop, nghe stylist, phối đồ, mua, hoàn đơn) là *bằng chứng cho "gu"* → chơi = tiến truyện, không cần nhiệm vụ giả tạo.

**5 Rank** (gắn copy có sẵn — "Lữ khách" đã nằm ở thoại bảo vệ cổng):

| Rank | Tên (vi / en) | Ý nghĩa truyện | Mở khoá trụ cột |
|---|---|---|---|
| 1 | Lữ khách / Traveler | Vừa qua cổng, người lạ | — (khởi đầu) |
| 2 | Khách quen / Regular | Được vài shop nhớ mặt | 🛍 Tastemaker |
| 3 | Cư dân / Resident | Có "địa chỉ" ở Veyra | 🏙 Citizen |
| 4 | Người sành điệu / Connoisseur | Gu được công nhận | 🏅 Collector |
| 5 | Công dân Veyra / Veyran | Người trong cuộc | 🔑 Insider |

**Cấu trúc chương:** Prologue (cổng, gieo móc câu) → 4 chương = 4 quận/NPC → kết (Rank 5, lễ công nhận + đặc quyền Insider thật).

---

## 3. Động cơ Danh vọng (Renown)

### 3.1 Đại lượng riêng, chỉ tăng
- Hiện `level = floor(coins / 500) + 1` (xem `useGameState.ts`). KHÔNG để Rank bám vào xu (sẽ thành cày xu & tụt rank khi tiêu).
- Thêm `renown: number` (persisted) — uy tín **không bao giờ mất**. Rank không bao giờ tụt.
- Rank suy ra qua ngưỡng (tạm, sẽ tinh chỉnh theo số liệu):

| Rank | Renown cần |
|---|---|
| 1 Lữ khách | 0 |
| 2 Khách quen | 100 |
| 3 Cư dân | 300 |
| 4 Người sành điệu | 700 |
| 5 Công dân Veyra | 1500 |

### 3.2 Một cửa nạp duy nhất (SEAM cốt lõi cho C/D/E)

```
recordRenown(source, ctx?)
  source ∈ 'daily' | 'explore' | 'stylist' | 'curate' | 'purchase'   // A+B (làm ngay)
           | 'qr-scan' | 'checkin' | 'event'                          // C/D/E (cắm sau)
```

- Mỗi `source` cấu hình: điểm thưởng + **trần mỗi ngày** (chống cày; là sẵn chỗ chống gian lận cho QR/GPS).
- C/D/E về sau gọi **đúng hàm này** sau khi xác minh → cùng thanh Danh vọng, cùng Rank, không sửa lõi.

### 3.3 Bốn trụ cột = cổng mở khoá theo Rank (không phải 4 loại tiền)

| Trụ cột | Mở ở Rank | Bám code có sẵn |
|---|---|---|
| 🛍 Tastemaker | 2 | NPC `chips`/`picks` — gợi ý "riêng cho bạn" trong `NpcDialogue` |
| 🏙 Citizen | 3 | Mở khoá quận/khu trên bản đồ (`SHOPS` + world) |
| 🏅 Collector | 4 | "Bộ sưu tập look" + huy hiệu, dựng trên `favorites` |
| 🔑 Insider | 5 | Voucher độc quyền + sale sớm (`VOUCHERS`/checkout) |

---

## 4. Cầu nối Game → Đời thực (B)

- Hiện `VOUCHERS` tĩnh, `usedVoucher` chỉ là cờ hiển thị.
- Thêm `earnedRewards: string[]` (persisted) — voucher/ưu đãi **kiếm được qua Rank/nhiệm vụ**.
- Mốc Rank / nhiệm vụ gọi `grantReward(id)` → ghi `earnedRewards`. Checkout áp các voucher này → **giảm tiền thật** trên đơn thật (hạ tầng đơn/người bán đã có).
- **SEAM backend:** hôm nay `grantReward` ghi local; sau đổi ruột thành gọi API phát mã thật — *không đụng UI*. Đánh dấu bằng comment rõ ràng.

---

## 5. Cách kể truyện (qua surface có sẵn)

- **Prologue ở cổng:** mở rộng `GuardDialogue` — gieo móc câu, đặt đích "trở thành Công dân".
- **Mốc thoại NPC khi lên Rank:** NPC chủ quận (Mira→Noa→Theo→Vi) bật đoạn 3–4 câu công nhận + hé lộ. Dùng lại `NpcDialogue`.
- **Màn "Hộ chiếu Veyra" (mới):** thanh Danh vọng, Rank, 4 trụ cột đã/đang mở, phần thưởng thật đã nhận, tiến trình chương.
- **Khoảnh khắc lên Rank:** overlay ăn mừng + trao thưởng (xu game + voucher thật).

---

## 6. Kiến trúc & thay đổi code

### 6.1 State mới
- Bump `STATE_VERSION` 1 → 2 (`useGameState.ts`); migration mặc định `renown=0`, `earnedRewards=[]`, `questProgress={}`.
- Persist thêm: `renown`, `earnedRewards`, `questProgress: Record<string, number>`.
- Context `g` thêm: `renown`, `rank`, `rankProgress`, `recordRenown(source, ctx?)`, `grantReward(id)`, `hasReward(id)`.

### 6.2 File mới
- `client/app/lib/game/renown.ts` — engine: `RANKS`, `SOURCES` (điểm + trần/ngày), `recordRenown` (phễu duy nhất, *seam C/D/E*), `deriveRank(renown)`. **Có unit test** (`renown.test.ts`).
- `client/app/data/quests.ts` — bộ nhiệm vụ. Mở rộng type `Quest`: thêm `source`, `renown`, `chapter`, `repeatable`, `rewardId?`.
- `client/app/data/story.ts` — thoại prologue + mốc NPC theo rank (song ngữ vi/en).
- `client/app/features/passport/PassportScreen.tsx` — màn Hộ chiếu. Thêm `'passport'` vào `ScreenName` (`lib/game/types.ts`) + `SCREENS` (`App.tsx`) + lối vào ở HUD.
- Overlay lên-rank (component nhỏ trong `components/overlays`).

### 6.3 Điểm móc `recordRenown`
- ghé shop → `WorldScreen` / `StoreScreen`
- nói chuyện NPC → `NpcDialogue`
- lưu yêu thích → `toggleFavorite` (trong `useGameState`)
- mua xong → `SuccessScreen`

### 6.4 Quest tiến trình thật
- Hiện `QUESTS[].prog` là số tĩnh. Thay bằng `questProgress[id]` (persisted), hiển thị suy ra. `claimedQuests` giữ trạng thái đã nhận. `claimQuest` award xu + `renown` + `grantReward` (nếu có `rewardId`).

---

## 7. Bộ nhiệm vụ (cốt truyện theo chương)

**Hằng ngày (lặp lại):**
| Nhiệm vụ (vi) | source | Renown | Thưởng |
|---|---|---|---|
| Điểm danh Veyra | daily | +10 | +20 xu |
| Dạo 1 quận bất kỳ | explore | +5 | — |

**Chương 1 → Rank 2 · Khách quen (Aria · Mira):**
| Nhiệm vụ | source | Renown | Thưởng |
|---|---|---|---|
| Khám phá 3 cửa hàng | explore | +30 | +50 xu |
| Trò chuyện cùng stylist Mira | stylist | +30 | 🎟 WELCOME10 (thật) |
| Lưu 3 món vào yêu thích | curate | +20 | +30 xu |

**Chương 2 → Rank 3 · Cư dân (Lumen · Noa):**
| Nhiệm vụ | source | Renown | Thưởng |
|---|---|---|---|
| Soi da & tư vấn cùng Noa | stylist | +30 | +50 xu |
| Hoàn tất đơn hàng đầu tiên | purchase | +60 | 🎟 FREESHIP (thật) |
| Phối 1 "look" hoàn chỉnh (≥3 món) | curate | +40 | huy hiệu |

**Chương 3 → Rank 4 · Người sành điệu (Nest · Theo):**
| Nhiệm vụ | source | Renown | Thưởng |
|---|---|---|---|
| Mua ở 2 danh mục khác nhau | purchase | +60 | +80 xu |
| Hoàn thành 1 bộ sưu tập look | curate | +80 | 🏅 huy hiệu hiếm |
| Đánh giá 1 sản phẩm đã mua | curate | +40 | +50 xu |

**Chương 4 → Rank 5 · Công dân Veyra (Pulse · Vi):**
| Nhiệm vụ | source | Renown | Thưởng |
|---|---|---|---|
| Ghé đủ cả 4 quận | explore | +60 | +100 xu |
| Đạt mốc chi tiêu trung thành | purchase | +120 | 🎟 VEYRA50 (thật) |
| 🔒 Quét QR tại cửa hàng thật | qr-scan | +150 | "Sắp ra mắt" — **chỗ chờ C** |

Nhiệm vụ cuối hiển thị dạng *khoá/coming-soon*: hé lộ tầm nhìn O2O + điểm cắm sẵn cho lớp C.

---

## 8. Thứ tự triển khai (MVP trước)

1. **Engine + state:** `renown.ts` (RANKS/SOURCES/recordRenown/deriveRank) + unit test; thêm state `renown/earnedRewards/questProgress`, bump version + migration. *Chưa cần UI.*
2. **Móc `recordRenown`** vào 4 nguồn (explore/stylist/curate/purchase).
3. **Quest ladder:** `quests.ts` + nâng cấp `QuestsScreen` dùng tiến trình thật; claim → renown + reward.
4. **Hộ chiếu Veyra:** `PassportScreen` + chip Rank trên HUD.
5. **Kể truyện:** prologue ở cổng + mốc thoại NPC + overlay lên-rank.
6. **Game→Real:** `earnedRewards` + `grantReward` + checkout áp voucher kiếm được (comment seam backend).
7. **Cổng trụ cột:** Tastemaker picks → Citizen mở quận → Collector bộ sưu tập → Insider voucher (làm theo từng phần).

---

## 9. Phi mục tiêu (Non-goals của spec này)
- KHÔNG làm quét QR / GPS / xác minh mua ngoài đời (lớp C).
- KHÔNG đồng bộ cửa hàng/tồn kho thật vào 3D (lớp D).
- KHÔNG hệ sự kiện/RSVP thật (lớp E).
- KHÔNG ghi Renown lên server (chưa có endpoint coins write; Renown lưu local như coins hiện tại). Sẽ đồng bộ khi backend sẵn sàng — dùng cùng seam.

## 10. Câu hỏi mở
- Ngưỡng Rank (0/100/300/700/1500) và điểm/source là số khởi tạo — cần tinh chỉnh theo dữ liệu thực tế.
- "Bộ sưu tập look" (Collector) cần định nghĩa cụ thể các bộ (chương 3) — chốt khi vào plan.
