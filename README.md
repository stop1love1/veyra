# Veyra

Monorepo cho dự án Veyra — immersive commerce.

```
veyra/
  client/   Next.js (App Router, TypeScript) — frontend
  server/   NestJS (TypeScript) — backend API
```

## Chạy toàn bộ project — 1 lệnh ở root

```bash
npm run dev        # = node dev.js
```

Khởi động theo thứ tự: **MongoDB** (127.0.0.1:27017) → đợi sẵn sàng → **API** (http://localhost:3001) + **client** (http://localhost:3000). Log của 3 tiến trình gộp chung với tiền tố màu `[mongo]` / `[server]` / `[client]`. Nhấn `Ctrl+C` để dừng tất cả.

Lần đầu (nếu chưa có `node_modules`):

```bash
npm run install:all
```

## Frontend — `client/`

```bash
cd client
npm install      # lần đầu (node_modules đã có sẵn nếu vừa setup)
npm run dev      # http://localhost:3000
npm run build
```

Mã nguồn app nằm trong `client/app/` (feature-based):

```
app/
  App.tsx                 shell: theme + state + điều hướng + overlays
  data/                   nội dung (strings, catalog, rewards) + types
  lib/game/               Game context + useGameState
  lib/theme/              theme tokens
  lib/three/              engine 3D (gate / store / world)
  components/ui|hud|overlays
  features/<screen>/      mỗi màn một file
```

## Backend — `server/`

```bash
cd server
npm install      # lần đầu
npm run start:dev   # http://localhost:3001
```

> Server mặc định chạy cổng **3001** để không trùng client (3000). Đổi bằng biến môi trường `PORT`.
