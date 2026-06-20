# Giai đoạn 5 — Cây & cỏ chân thực hơn

Ngày: 2026-06-20
Phản hồi người dùng: cây (Kenney low-poly) + cỏ (màu phẳng) trông quá thô sơ, không thực.
Mục tiêu: nâng độ chân thực mà KHÔNG cần asset tải ngoài, vẫn rẻ + instanced + tier-aware.

## Cây — `buildRealisticTrees` (thay model Kenney GLB)
- **Tán lá = thẻ alpha (billboard cards)**: nhiều quad chéo nhau, map bằng `makeLeafTexture()`
  (canvas RGBA: ~320 chiếc lá ellipse xanh phân bố gaussian → bóng lá hữu cơ, mép mềm). Dùng
  `alphaTest` (không `transparent`) → không lỗi sort, không cần sắp xếp.
- Thân: cylinder thuôn (bark). Mỗi cây CARDS thẻ (high 6 / mid 5 / low 4), nghiêng/cao/cỡ
  ngẫu nhiên → tán tròn đầy nhìn từ mọi góc.
- **1 InstancedMesh thân + 1 cho toàn bộ thẻ lá** (~2 draw call). Tint xanh theo cây qua
  instanceColor. Đu đưa theo gió qua shared sway shader. Thẻ lá KHÔNG đổ bóng (tránh bóng vuông
  xấu của alpha); thân đổ bóng (high). Va chạm gốc giữ nguyên.
- Gỡ phụ thuộc Kenney: xoá `buildGltfTrees`/`attachSway`/`TREE_GLBS`, bỏ preload GLB cây (nhanh load hơn).

## Cỏ — texture procedural
- `makeGrassTexture()`: canvas tileable — nền xanh + ~700 cụm xanh biến thiên + ~2600 nét cỏ
  + vài đốm khô → mặt cỏ có chi tiết thay vì phẳng lì.
- Áp vào `lawnMat`/`pitchMat`. Giữ lại UV của `ShapeGeometry` (UV = toạ độ mét) + `repeat=0.3`
  → map tile liền mạch giữa các mảng công viên, không seam. Pitch tint lạnh hơn để phân biệt.

## Tier / perf
Thẻ lá: high N×6 (~2160 thẻ với 360 cây) — vài nghìn tam giác, không đáng kể. Tận dụng headroom
GĐ1. Không thêm draw call đáng kể.

## Kiểm chứng
`next build` pass; xem browser: tán lá hữu cơ + cỏ có chi tiết. Tinh chỉnh cỡ thẻ/tile theo mắt.
