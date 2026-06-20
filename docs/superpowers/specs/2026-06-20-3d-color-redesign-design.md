# Thiết kế lại MÀU SẮC toàn cảnh — Hồ Hoàn Kiếm (true-to-life)

Ngày: 2026-06-20
Cơ sở: khảo sát song song 5 vùng (môi trường/ánh sáng, vật liệu PBR lõi, mặt tiền/mái nhà,
đất/nước/cỏ/landmark, cây/ambience/props). Mục tiêu: bảng màu **thống nhất, chân thực** thay
vì các màu rời rạc "sơn mới, quá tươi, lệch tông lạnh".

## 4 nguyên tắc xuyên suốt
1. **Bớt bão hoà & bớt sáng** chỗ "sơn mới": tường nhà −5..8 L, lá/cỏ/cây hạ sat về 18–35%.
2. **Làm ấm các tông xám** (đất/bê tông/asphalt/curb) — bỏ ánh xanh-lam 220°, về xám-be ấm.
3. **Sửa lỗi tông rõ ràng**: cây hoa đang ra "tán vàng kim", tượng đồng đang "xanh gỉ", liễu/lá cọ thân quá nhạt.
4. **Giữ biểu tượng**: hồ lục thủy, cầu Thê Húc đỏ son, cờ đỏ sao vàng — chỉ tinh chỉnh nhẹ.

---
## A. Môi trường & ánh sáng — environment.ts / postfx.ts
| Mục | Hiện tại | Mới | Lý do |
|---|---|---|---|
| Hemisphere sky | 0xbfd6ff | 0xc4d6d2 | bớt xanh điện, thêm chút lục ẩm nhiệt đới |
| Hemisphere ground bounce | 0x6b5b45 | 0x756b5a | xám-bê thay vì nâu đất |
| Fog ngày (base) | 0xc9d4dc | 0xccd2cc | sương ẩm hơi ngả lục thay vì xám-lam châu Âu |
| Fog đêm | 0x0b1622 | 0x141e2c | nâng nhẹ để quầng đèn đọc được |
| turbidity (trong) | 3.0 | 2.4 | mù nhiệt đới đúng độ, bớt loá |
| Exposure đêm (hệ số) | 0.40 | 0.52 | đêm bớt tối, đèn rõ hơn |
| Bloom threshold | 0.9 | 0.8 | đèn đường/lồng đèn toả nhẹ về đêm |

## B. Vật liệu PBR lõi — materials.ts
| Vật liệu | Hiện tại | Mới | Lý do |
|---|---|---|---|
| asphalt | hsl(220,.03,.16) | hsl(28,.03,.17) | nhựa đường ấm-xám, không lạnh-lam |
| concrete | hsl(30,.02,.50) | hsl(36,.05,.52) | bê tông bụi ấm |
| curb | hsl(30,.02,.58) | hsl(38,.06,.66) | bó vỉa sáng-ấm, phân biệt mặt đường |
| foliage (props) | hsl(110,.30,.32) | hsl(96,.20,.36) | lá nhiệt đới bụi, bớt lime |
| glassDark (kính) | hsl(205,.25,.18) | hsl(195,.16,.24) | kính trung tính/ngả lục, hết cyan |
| water (đài phun) | hsl(205,.18,.32) | hsl(168,.22,.34) | nước ngả jade |
| plaster(hue) chung | sat .12 / L .70 | sat .13 / L .64 | vữa cũ bám bụi |

## C. Mặt tiền & mái — hanoiFacades.ts (+ worldHanoi roof)
Hạ sáng ~6 L cho mọi tường + sửa các tông quá bão hoà (đặc biệt terracotta S45→28):
tube-ochre 38/.40/.62→/.28/.54 · tube-yellow 48/.50/.68→/.34/.58 · tube-faded-green 96/.18/.60→/.13/.52
· tube-faded-blue 200/.20/.62→/.20/.57 · tube-faded-pink 355/.28/.70→/.20/.60 · tube-terracotta 18/.45/.50→/.28/.47
· tube-mint 160/.20/.66→/.16/.55 · colonial-cream 44/.28/.78→/.26/.70 · colonial-yellow 46/.42/.70→/.32/.63
· colonial-grey 40/.06/.72→/.06/.64 · modern-blue 210/.08/.72→/.08/.64 · modern-warm 35/.06/.74→/.08/.66
· plain-concrete 30/.03/.60→/.04/.64 · plain-wash 40/.08/.70→/.08/.63.
Mái: roofMat hsl(28,.06,.34)→hsl(30,.05,.32); roofTileMat & landmark roofTile hsl(14,.5,.34)→hsl(17,.55,.37) (terracotta ấm hơn).
Chi tiết mái: tankMat 0x2f6fb0→0x4a7a98 (bồn nhựa bớt chói), acMat 0xcfcdc6→0xbcb6ac (điều hoà xám công nghiệp).
Skyline: SKY_HUES [40,205,20,120,350] → [40,200,12,120,210,35,180] (thêm xám/gỉ/lạnh, bớt lặp mẫu).

## D. Đất / nước / cỏ / landmark — worldHanoi.ts
| Mục | Hiện tại | Mới | Lý do |
|---|---|---|---|
| groundMat | hsl(40,.10,.42) | hsl(38,.05,.40) | nền xám-gritty, bớt ochre sa mạc |
| lawnMat (color×texture) | hsl(96,.12,.66) | hsl(96,.13,.50) | cỏ tối/mid-tone thật |
| pitchMat | hsl(128,.22,.60) | hsl(120,.20,.50) | sân cỏ |
| grass texture (blades) | sat 44–70% | sat 38–54%, hue 88–110 | bớt lá chói/quá vàng-lam |
| lake water | hsl(146,.50,.19) | hsl(150,.46,.22) | jade hơi sáng hơn, đỡ đen |
| redPaint (cầu Thê Húc) | 0xc0392b | 0xcf3b29 | đỏ son tươi hơn (giữ tông ấm, KHÔNG ngả hồng) |
| bronze (Lý Thái Tổ) | hsl(150,.28,.30) | hsl(30,.32,.32) | đồng oxy-hoá nâu-ấm, hết "xanh gỉ" |

## E. Cây & ambience — worldHanoi (tree species) / hanoiAmbience.ts
| Mục | Hiện tại | Mới | Lý do |
|---|---|---|---|
| broadleaf tint / spread | [104,.40,.36] / 30 | [104,.34,.35] / 24 | bớt sat, bớt lan ra lime |
| slender tint | [116,.42,.34] | [112,.32,.36] | bớt sat |
| **flower tint (LỖI)** | **[40,.50,.50]** | **[104,.38,.37]** | đang cho "tán vàng kim"; trả về nền lá xanh (hoa đỏ đã do texture `warm`) |
| palm trunk | hsl(34,.22,.50) | hsl(32,.20,.40) | thân cọ xám-nâu, không sáng |
| willow fronds | 0x93b257 | 0x82a449 | rèm liễu trầm sage, không vàng-nhạt |
| koi calico | hsl(20,.50,.72) | hsl(20,.60,.62) | rõ hoa văn hơn |
| firefly | 0xffd98a | 0xffe1a0 | bớt neon |

## F. Props/items — hanoiItems.ts
lanternMat 0xff7a3c→0xff8a4e (lồng đèn dịu) · fruitOrange hsl(30,.85,.50)→hsl(30,.75,.52) · skin hsl(28,.40,.72)→hsl(28,.38,.68)
· traffic green 0x33dd55→0x2bd24a (xanh đèn chuẩn). Cờ đỏ/vàng, banner, terracotta, wood, bark, steel: GIỮ (đã đúng).

---
## Phạm vi & rủi ro
~70 thay đổi giá trị màu trên 5 file, **không đụng hình học/logic**. Rủi ro thấp (chỉ literal màu).
Kiểm chứng: `next build` pass + xem browser ở 3 mốc giờ (sáng/trưa/tối) — màu là chủ quan, cần mắt người chốt.
