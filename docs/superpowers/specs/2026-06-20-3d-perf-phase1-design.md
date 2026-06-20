# Giai đoạn 1 — Nền tảng hiệu suất render 3D (worldHanoi)

Ngày: 2026-06-20
Phạm vi: chỉ hiệu suất. Mọi thay đổi **trung tính về thị giác** — scene trông y hệt, chỉ rẻ hơn.
File chính: `client/app/lib/three/worldHanoi.ts` (engine world đang active).

## Bối cảnh

Engine đã tối ưu sâu: merge ~850 nhà OSM → ~14 draw call, instanced trees/birds/guards,
merged roads/greens, `Water` phản chiếu custom shader, spatial-hash collision, day/night
theo giờ Hà Nội thật, thời tiết Open-Meteo thật. Mục tiêu G1 là cắt chi phí per-frame
*không* đụng tới diện mạo, tạo headroom cho các giai đoạn cảnh sau.

Mục tiêu perf: **cân bằng mọi tier** (đẹp trên desktop, mượt hơn trên mobile/low).

## Các thay đổi

### 0. Dev perf overlay (công cụ đo)
Overlay HTML nhỏ hiển thị FPS / ms / draw calls (`renderer.info.render.calls`) + triangles +
pixel-ratio hiện tại. Ẩn mặc định, bật/tắt bằng phím `~` (backquote). Dọn trong `dispose()`.
Lý do: không có số đo thì "cân bằng mọi tier" chỉ là cảm tính; cần đo trước/sau từng tier.

### 1. Shadow map theo nhịp ~30Hz thay vì mỗi frame  *(win lớn nhất)*
`renderer.shadowMap.autoUpdate = false`. Trong loop, tích lũy `shadowAccum += dt`; khi
`> 1/30` set `renderer.shadowMap.needsUpdate = true` và reset. Force vài lần đầu sau `ready`.
Player dùng blob shadow giả nên không phụ thuộc; NPC trễ bóng 1–2 frame là vô hình.
Tách chi phí bóng (re-render toàn thành phố tĩnh) khỏi tần số khung hình.

### 2. Tách animation cổng/bảo vệ/perimeter ra ngoài vòng `interactables`  *(win sạch, 0 rủi ro)*
Hiện 3 khối `fenceGates` / `liveGuards` / `perim` nằm trong `for (interactables)` (~L2507-2548)
nhưng không dùng biến `it` → bị tính lại N lần/frame (N = số interactables);
`perim.instanceMatrix.needsUpdate` set thừa nhiều lần. Chuyển ra **sau** vòng lặp, chạy 1 lần.
Marker + glow (dùng `it`) vẫn ở trong. Hành vi giữ nguyên (last-write-wins → cùng kết quả).

### 3. Throttle ghi uniform đổi-chậm
`setFacadeNight(night)` + `items.setNightFactor(night)` chỉ gọi khi `|night - lastNight| > 0.01`.
`night` bám theo độ cao mặt trời → đổi rất chậm. Sway/uTime/birds vẫn cập nhật mỗi frame.

### 4. Dynamic resolution theo frame-time  *(mục tiêu cân bằng tier)*
EMA frame-time. Quá ngưỡng (vd < ~45 FPS kéo dài) → giảm pixel ratio theo bước; vượt thoải mái
(> ~58 FPS) → phục hồi dần về trần của tier (`q.maxPixelRatio`). Hysteresis + cooldown chống
dao động; clamp `[0.7 × base .. tier max]`. Áp qua `renderer.setPixelRatio` + `post.setSize`.
Bỏ qua khi tab ẩn / chưa `ready`. Item rủi ro nhất (tương tác EffectComposer) → test kỹ.

## Loại trừ (YAGNI G1)
Không đổi vật liệu/cảnh, không thêm hiệu ứng, không đụng dữ liệu OSM, không LOD/culling mới.

## Kiểm chứng
Engine real-time `@ts-nocheck` → không hợp unit test. Verify thực nghiệm: chạy app, đọc overlay
FPS/draw-call **trước/sau** trên 3 tier (ép tier qua flag), xác nhận không khác biệt thị giác.
Báo cáo số đo thật.

## Lộ trình sau (mỗi cái 1 spec riêng)
- GĐ2: polish cảnh + hiệu ứng động (phản chiếu đèn đêm xuống hồ, sương sớm, lá rơi, cá koi, đông NPC).
- GĐ3: khu vực mới đặc trưng (chợ đêm có sạp + đèn dây, vườn hoa, sân đền Ngọc Sơn).
- GĐ4: cảnh 3D cho màn store/gate.
