# Giai đoạn 2 — Polish cảnh + hiệu ứng môi trường động (Hồ Hoàn Kiếm)

Ngày: 2026-06-20
Tiếp nối GĐ1 (perf). Mục tiêu: thêm "hồn" sống động cho mặt hồ + cảnh đêm, **tier-aware**,
chi phí thấp (đã có headroom từ GĐ1).

## Kiến trúc
Module mới, biệt lập: `client/app/lib/three/shared/hanoiAmbience.ts`, cùng quy ước
`hanoiItems.ts` — builders procedural, tự quản pool geom/mat/texture, `dispose()` đầy đủ,
KHÔNG asset ngoài. API:

```
createHanoiAmbience(THREE, { quality }) -> {
  build({ scene, lakeCx, lakeCz, lakeR, lakeNorthZ }),
  update(t, dt, { camPos, windAmt, windDir, night }),
  dispose(),
}
```

Tích hợp tối thiểu trong `worldHanoi.ts`: khởi tạo cạnh `items`, `build()` sau khi biết hồ,
`update()` trong loop (sau khi tính `night`), `dispose()` trong teardown.

## Bốn hiệu ứng (gate theo tier)
1. **Sương hồ** (mọi tier): Points sprite mềm (texture radial canvas) lơ lửng trên mặt hồ,
   xoay rất chậm quanh tâm hồ (rẻ), opacity = `night × max`. Mạnh lúc bình minh/hoàng hôn/đêm.
2. **Cây liễu rủ** (GĐ3 — thay hiệu ứng lá rơi đã bỏ vì thiếu chân thực): liễu nghiêng ra mặt
   nước dọc bờ hồ THẬT (`lakePoly`), rèm lá rủ đu đưa theo gió qua vertex-shader (swayU). Thân +
   tán + rèm lá mỗi loại 1 InstancedMesh (~3 draw call). Va chạm gốc cây đẩy vào `circles`.
   Spacing theo tier (high 17 m / mid 24 m / low 38 m), fronds/cây high 12 / mid 9 / low 6.
3. **Cá koi** (high 9 / mid 5 / low 0): bóng cá phẳng (ShapeGeometry nằm ngang) lượn vòng chậm
   trong `lakeR×0.7`, tránh khu cầu/đảo phía bắc; đuôi ve vẩy bằng dao động yaw. `renderOrder`
   trên mặt nước + polygonOffset chống z-fight.
4. **Đom đóm/đốm đèn đêm** (high 90 / mid 50 / low 0): Points ấm ven bờ bắc, opacity = `night`,
   nhấp nháy nhẹ + xoay chậm.

## Perf
Mist/fireflies: xoay cả Points object + đặt opacity mỗi frame (O(1)). Leaves: cập nhật mảng vị
trí mỗi frame (~≤220). Koi: cập nhật ma trận instance mỗi frame (N nhỏ). Tất cả `frustumCulled`
phù hợp, không shadow, không thêm draw call đáng kể.

## Loại trừ (YAGNI G2)
Không volumetric fog thật, không phản chiếu đèn dựng riêng (Water đã phản chiếu scene), không
tăng mật độ NPC (giữ để chỉnh sau nếu cần).

## Kiểm chứng
`next build` pass; quan sát trong browser: sương dày lúc sáng sớm/đêm và tan lúc trưa, lá rơi,
koi lượn, đom đóm ban đêm; FPS không tụt rõ (overlay `~`). Báo số đo thật.
