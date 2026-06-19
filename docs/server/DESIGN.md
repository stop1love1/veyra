# Veyra Server — Design (NestJS + MongoDB)

Date: 2026-06-19 · Status: Design (no implementation yet) · Stack: **NestJS + MongoDB (Mongoose)**

## 1. Goal

Add a backend for Veyra (currently a client-only 3D shopping world) that provides:

1. **Auth & roles** — `admin`, `seller`, `user`, `npc` (npc is BOTH an account role and an in-world entity).
2. **Commerce** — sellers own shops & products; users have carts, orders, coins, quests, vouchers.
3. **3D CMS (the headline)** — an **asset library of Items** (GLB models + metadata) that the admin imports, and a **Map builder** where the admin composes maps by placing those items. The 3D client (`worldKit`) becomes **data-driven**: it loads a published map definition + the referenced item GLBs and assembles the scene at runtime instead of hard-coding the layout.

## 2. Architecture

```
client/ (Next.js + three.js)            server/ (NestJS)                 MongoDB
  ─ 3D worldKit (data-driven loader) ──▶  REST API  ──────────────────▶  collections
  ─ admin Map Editor (drag items)   ──▶  /items /maps (RBAC: admin)       (Mongoose)
  ─ shop/cart/checkout              ──▶  /shops /products /orders
  GLB/asset files  ◀──────────────────  /files (signed URLs)  ◀──────  Object storage
                                                                         (S3 / local /uploads)
```

- **NestJS** modules (one per domain): `auth`, `users`, `shops`, `products`, `items`, `maps`, `npcs`, `cart`, `orders`, `quests`, `vouchers`, `files`, `media`.
- **MongoDB / Mongoose** — document model fits the map scene + item metadata (flexible, nested). Relational links via `ObjectId` refs; embed where a sub-doc is owned and bounded (dialogue lines, map environment, order lines).
- **Auth**: JWT access + refresh tokens; `passport-jwt`. `RolesGuard` + `@Roles()` decorator for RBAC; `@Public()` for open routes. Optional per-resource ownership guard (seller can only touch own shop).
- **File storage**: GLB/thumbnail/texture binaries live in object storage (S3 or local `/uploads` in dev); Mongo stores only metadata + URL/key. `files` module issues upload (presigned/multipart) + read URLs.
- **Validation**: `class-validator` DTOs; Mongoose schema validation as a second layer.
- **Config**: `@nestjs/config`, env-driven (Mongo URI, JWT secrets, storage creds).
- **i18n fields**: text shown in-game is bilingual → stored as `{ vi: string, en: string }` (matches the client's `tx()` pattern).

## 3. Roles & permissions matrix

| Capability | admin | seller | user | npc |
|---|---|---|---|---|
| Manage users / assign roles | ✅ | — | — | — |
| Import/CRUD **Items** (asset library) | ✅ | — | — | — |
| Build/publish **Maps** | ✅ | — | — | — |
| Place shops/NPCs into a map | ✅ | request only | — | — |
| Manage own Shop + Products | ✅ (any) | ✅ (own) | — | — |
| Manage NPC entities | ✅ | own advisors | — | — |
| Browse world / shops | ✅ | ✅ | ✅ | n/a |
| Cart / Order / Quests / Coins | ✅ | ✅ | ✅ | — |
| Edit own avatar/profile | ✅ | ✅ | ✅ | — |

- **npc account role**: a non-interactive/scripted account type (no password login by default; created by admin) used when an NPC needs to "own" data (e.g., a system shopkeeper) or act in flows. Distinct from the **NPC entity** (the placeable in-world character, see `npcs`).

## 4. Data model (MongoDB collections)

Conventions: `_id: ObjectId`, `createdAt/updatedAt` (timestamps), `status` enums for soft lifecycle. `I18n = { vi: string, en: string }`. Refs noted as `→ collection`.

### 4.1 `users`
```
{ _id, email (unique), passwordHash?, name,
  role: 'admin'|'seller'|'user'|'npc',
  status: 'active'|'suspended'|'system',
  avatar: { name, hue:Number, skin:Number, style:String },
  coins: Number,
  sellerProfile?: { displayName, bio, payout:{...}, approved:Boolean },  // present when role=seller
  lastLoginAt, createdAt, updatedAt }
```
Indexes: `email` unique, `role`.

### 4.2 `shops`  (a seller's storefront; also a map placement target)
```
{ _id, sellerId → users, name:I18n, slug (unique), category:I18n, blurb:I18n,
  hue:Number, featured:Boolean,
  status:'draft'|'published'|'suspended',
  advisorNpcId? → npcs,            // the in-store NPC advisor
  interiorMapId? → maps,           // optional custom shop interior map
  stats:{ rating, sold }, createdAt, updatedAt }
```
Indexes: `sellerId`, `slug` unique, `status`.

### 4.3 `products`
```
{ _id, shopId → shops, name:I18n, blurb?:I18n,
  price:Number, currency:'VND',
  colors:[Number], sizes:[String], tags:[I18n],
  modelItemId? → items,            // optional 3D model for the product
  images:[{url}], rating:Number, sold:Number, stock:Number,
  status:'active'|'hidden', createdAt, updatedAt }
```
Indexes: `shopId`, `status`, text index on `name`.

### 4.4 `items`  ★ ASSET LIBRARY — the building blocks the admin imports
```
{ _id, key (unique slug), name:I18n,
  category:'building'|'road'|'prop'|'nature'|'fixture'|'npc'|'sign'|'light'|'ground',
  source:'kenney'|'upload'|'builtin', license:String,
  asset: { glb:{ url, key, sizeBytes, sha256 }, textures:[{url,key}]?, thumbnail:{url} },
  transformDefaults: { scale:Number(=7), yOffset:Number, faceAxis:'+z' },
  bbox: { size:{x,y,z}, center:{x,y,z} },     // measured on import
  collision: { type:'none'|'circle'|'box', radius?:Number, half?:{x,z} },
  snap: { gridTiles:Number(=1), walkable:Boolean },   // for the map grid editor
  tags:[String], version:Number,
  createdBy → users(admin), status:'active'|'archived', createdAt, updatedAt }
```
Indexes: `key` unique, `category`, `tags`. **This is what "admin tự dựng item để import" maps to.**

### 4.5 `maps`  ★ a composition built from items (the world / a district / a shop interior)
```
{ _id, name, slug (unique), kind:'world'|'district'|'shop-interior'|'gate',
  description?, version:Number, status:'draft'|'published'|'archived',
  tileSize:Number(=7),
  environment: { skyColor, sun:{intensity,azimuth,elevation,color},
                 fog:{near,far,color}, ibl:'room'|'none' },
  bounds: { outerRadius:Number },
  spawnPoints: [{ id, pos:{x,z}, ry:Number }],
  zones: [{ id, kind:'walkable'|'road'|'blocked', polygon:[{x,z}] }],
  shopSlots: [{ id, pos:{x,z}, ry, shopId? → shops }],   // where shops attach
  npcSlots:  [{ id, pos:{x,z}, ry, npcId?  → npcs }],
  publishedAt, createdBy → users(admin), createdAt, updatedAt }
```
**Placed item instances live in their own collection** (a big map can hold thousands; keep the map doc small, avoid the 16MB doc limit):

### 4.6 `mapInstances`  (one doc per placed item; the actual scene graph)
```
{ _id, mapId → maps, itemId → items,
  transform: { pos:{x,y,z}, rot:{x,y,z}, scale:Number },
  layer:'ground'|'roads'|'buildings'|'props'|'skyline',
  shadow:Boolean, collisionOverride?, props?:{},   // per-instance tweaks
  zoneTags?:[String] }
```
Indexes: `mapId` (+ `layer`). Read a map = its `maps` doc + `mapInstances` where `mapId=…` (paginated/streamed).

### 4.7 `npcs`  ★ in-world entity (placeable like an item; can link to an npc account)
```
{ _id, name, persona:I18n,                  // role/title shown in-game
  appearance:{ hue, skin, style },
  modelItemId? → items,                      // 3D model (else default avatar)
  dialogue:[{ id, lines:[I18n], picks?:[String], action?:{type,payload} }],
  shopId? → shops,                           // if this NPC is a shop advisor
  behavior:{ kind:'idle'|'wander', radius?:Number },
  accountUserId? → users(role=npc),          // optional linked account
  createdBy → users, status, createdAt, updatedAt }
```

### 4.8 Commerce & progression
- `carts`: `{ userId → users (unique), lines:[{ productId, size, color, qty }], updatedAt }`
- `orders`: `{ userId, lines:[{ productId, shopId, name:I18n, price, qty, size, color }], total, status:'pending'|'paid'|'shipped'|'done'|'cancelled', payment:{method}, shipping:{...}, voucherId?, createdAt }`
- `quests`: `{ key, title:I18n, goal:{ type, count }, reward:{ coins?, voucherId? }, active }`
- `userQuests`: `{ userId, questId, progress:Number, claimed:Boolean }` (unique userId+questId)
- `vouchers`: `{ code (unique), type:'percent'|'amount'|'freeship', value, sellerId?, expiresAt, maxUses, uses }`
- `userVouchers`: `{ userId, voucherId, usedAt? }`

### 4.9 Ops
- `files`: `{ _id, key, url, mime, sizeBytes, sha256, ownerId, kind:'glb'|'texture'|'image'|'thumb', createdAt }`
- `auditLogs`: `{ actorId, action, target:{collection,id}, diff?, at }` (item import, map publish, role change)
- `refreshTokens`: `{ userId, tokenHash, expiresAt, revoked }`

### 4.10 ERD (relationships)
```
users(1)─<(n)shops ; shops(1)─<(n)products ; products(1)─?(1)items(model)
users(seller)─<sellerProfile(embedded)
items(1)─<(n)mapInstances>─(1)maps ; maps(1)─<(n)mapInstances
maps.shopSlots → shops ; maps.npcSlots → npcs ; shops.advisorNpcId → npcs
npcs.modelItemId → items ; npcs.accountUserId → users(npc)
users(1)─(1)carts ; users(1)─<(n)orders ; orders.lines→products(snapshot)
users─<userQuests>─quests ; users─<userVouchers>─vouchers
```

## 5. The Item → Map builder mechanism (headline feature)

### 5.1 Item import (admin "tự dựng item để import")
1. Admin uploads a GLB (+ optional thumbnail/textures) via `POST /items` (multipart) or registers a built-in (e.g. Kenney kit pieces already in `client/public/models`).
2. Server stores the binary in object storage, computes `sha256`/size, (optionally) parses the GLB to fill `bbox`; admin sets `category`, `collision`, `snap`, `transformDefaults`, `tags`.
3. Item appears in the **library**, filterable by category/tag — the palette the map editor draws from.

### 5.2 Map build (admin "dùng item đó để dựng map")
1. Admin creates a `maps` doc (kind=world/district/shop-interior/gate) + sets `environment`, `tileSize`, `bounds`.
2. In the **Map Editor** (client admin UI), admin drags items from the library onto a grid → each drop creates a `mapInstances` doc `{ itemId, transform }`. Grid snap uses `item.snap.gridTiles`. Move/rotate/scale/delete update instances.
3. Admin paints **zones** (walkable/road/blocked), drops **spawnPoints**, defines **shopSlots** (assign a `shopId`) and **npcSlots** (assign an `npcId`).
4. Save = draft; **Publish** bumps `version`, sets `status=published`, stamps `publishedAt` (immutable snapshot the client serves).

### 5.3 Client runtime (data-driven world)
`worldKit` is refactored into a generic loader:
1. `GET /maps/:slug?published=1` → map doc (environment, slots, spawn, zones).
2. `GET /maps/:id/instances` (paged/streamed) → placements.
3. Collect the unique `itemId`s → resolve their GLB URLs → `kit.preload(urls)` (reuse the existing `assets.ts` loader, generalized to absolute URLs).
4. For each instance: `kit.get(item)` clone, apply `transform`, assign to `layer`, set collision from `item.collision` (+ overrides) → build blockers.
5. Attach shops at `shopSlots` (interactable + proximity), NPCs at `npcSlots` (dialogue from `npcs`), spawn player at a `spawnPoint`. Keep player/controls/coins/HUD as today.
6. The current hard-coded Kenney layout becomes the **seed "world" map** authored once via this same system (a migration script registers the Kenney pieces as Items and emits a default map).

### 5.4 Map scene JSON (contract: editor ⇄ server ⇄ client)
```jsonc
{ "map": { "slug":"veyra-central", "kind":"world", "tileSize":7,
           "environment":{...}, "bounds":{"outerRadius":420},
           "spawnPoints":[{"id":"s1","pos":{"x":0,"z":58},"ry":3.14}],
           "shopSlots":[{"id":"a1","pos":{"x":..},"ry":..,"shopId":"..."}],
           "npcSlots":[...] , "zones":[...] },
  "items": { "build:building-a":{"glb":"<url>","collision":{"type":"circle","radius":4.5},"scale":7}, ... },
  "instances":[ {"itemId":"build:building-a","transform":{"pos":{...},"rot":{...},"scale":7},"layer":"buildings","shadow":true}, ... ] }
```

## 6. API surface (REST; RBAC in brackets)

```
auth:     POST /auth/register · POST /auth/login · POST /auth/refresh · GET /auth/me
users:    GET/PATCH /users/:id [admin|self] · GET /users [admin] · PATCH /users/:id/role [admin]
shops:    GET /shops · GET /shops/:slug · POST/PATCH/DELETE /shops [seller(own)|admin] · GET /shops/:id/products
products: GET /products?shop= · GET /products/:id · POST/PATCH/DELETE /products [seller(own)|admin]
items:    GET /items?category=&tag= [admin] · POST /items (upload) [admin] · PATCH/DELETE /items/:id [admin]
maps:     GET /maps/:slug (published) [public] · GET /maps/:id/instances [public if published]
          POST /maps · PATCH /maps/:id · POST /maps/:id/publish [admin]
          POST /maps/:id/instances · PATCH/DELETE /maps/:id/instances/:iid [admin]  (editor ops)
npcs:     GET /npcs · POST/PATCH/DELETE /npcs [admin|seller(own advisors)]
cart:     GET /cart · PUT /cart/lines · DELETE /cart/lines/:k [user]
orders:   POST /orders · GET /orders [user(own)|seller(own shop)|admin] · PATCH /orders/:id/status [seller|admin]
quests:   GET /quests · GET /me/quests · POST /me/quests/:id/claim [user]
vouchers: GET /vouchers [admin|seller(own)] · POST /me/vouchers/:code/redeem [user]
files:    POST /files (presign/upload) [admin|seller] · GET /files/:id
```

## 7. Phasing (implementation order, when approved)
1. Bootstrap NestJS + Mongo + config + auth (JWT, RolesGuard) + users.
2. `files` + `items` (asset library, upload, Kenney seed importer).
3. `maps` + `mapInstances` + publish + the seed "world" map migration.
4. Refactor client `worldKit`/`assets` into the data-driven loader against `/maps/:slug`.
5. Admin **Map Editor** UI (drag items, zones, slots, publish).
6. Commerce: `shops`/`products`/`cart`/`orders`, then `quests`/`vouchers`.
7. NPC entity + placement + dialogue wiring.

## 8. Open decisions
- Object storage: S3 (prod) vs local `/uploads` (dev) — config-switchable.
- Big map streaming: paginate `mapInstances` vs a single packed binary/`.json.gz` snapshot served on publish (recommended: publish emits a cached snapshot file the client fetches in one request; DB stays the editable source of truth).
- GLB parsing on import (bbox/validation): do server-side (node-three / gltf-transform) vs trust client-supplied metadata.
- Payments: stub (cash-on-delivery / coins) now; real gateway later.
```
