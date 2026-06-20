// Tiny typed fetch wrapper for the Veyra REST API (NestJS backend, see
// docs/server/DESIGN.md). Designed so every caller can try/catch and fall back
// to the static client data when the server is offline — nothing here throws at
// import time, and there are no hardcoded secrets.
//
//   import { api } from '../api/client';
//   try { const { map } = await api.getMap('veyra-central'); ... }
//   catch { /* offline → use the bundled world */ }

// Base URL comes from the public env var (NEXT_PUBLIC_* is inlined at build
// time and safe to ship). Falls back to the dev server default.
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api').replace(/\/+$/, '');

const TOKEN_KEY = 'veyra_token';

/** Read the bearer token from localStorage, if we're in the browser. */
function getToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist (or clear) the bearer token. Used by login/register helpers. */
export function setToken(token: string | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / quota — ignore */
  }
}

export interface RequestOptions {
  /** Query params appended to the URL (undefined/null values are dropped). */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Per-request AbortSignal (e.g. component unmount). */
  signal?: AbortSignal;
}

/** An HTTP error carrying the status + parsed body, so callers can branch. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('http')
    ? path
    : BASE_URL + (path.startsWith('/') ? path : '/' + path);
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? url + (url.includes('?') ? '&' : '?') + qs : url;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const init: RequestInit = { method, headers, signal: opts.signal };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(buildUrl(path, opts.query), init);

  // Parse JSON when present; tolerate empty 204 bodies.
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : null) || `${method} ${path} failed (${res.status})`;
    throw new ApiError(res.status, msg, parsed);
  }

  return parsed as T;
}

/** Low-level verb helpers. */
export const http = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
};

// ── API response shapes (subset, matching docs/server/DESIGN.md) ───────────
// Intentionally loose: the client treats these as best-effort and falls back to
// static data, so optional fields keep the wiring resilient to schema drift.

export interface I18nField {
  vi: string;
  en: string;
}

export interface ApiMapEnvironment {
  skyColor?: string;
  sun?: { intensity?: number; azimuth?: number; elevation?: number; color?: string };
  fog?: { near?: number; far?: number; color?: string };
  ibl?: 'room' | 'none';
}

export interface ApiSpawnPoint {
  id: string;
  pos: { x: number; z: number };
  ry?: number;
}

export interface ApiSlot {
  id: string;
  pos: { x: number; z: number };
  ry?: number;
  shopId?: string;
  npcId?: string;
}

export interface ApiMap {
  _id?: string;
  id?: string;
  name?: string;
  slug: string;
  kind?: 'world' | 'district' | 'shop-interior' | 'gate';
  tileSize?: number;
  environment?: ApiMapEnvironment;
  bounds?: { outerRadius?: number };
  spawnPoints?: ApiSpawnPoint[];
  zones?: { id: string; kind: string; polygon: { x: number; z: number }[] }[];
  shopSlots?: ApiSlot[];
  npcSlots?: ApiSlot[];
  // The server may inline the item dictionary on the map payload (see §5.4).
  items?: Record<string, ApiItemDef>;
}

export interface ApiItemDef {
  glb?: string;
  glbUrl?: string;
  collision?: { type: 'none' | 'circle' | 'box'; radius?: number; half?: { x: number; z: number } };
  scale?: number;
}

export interface ApiTransform {
  pos: { x: number; y?: number; z: number };
  rot?: { x?: number; y?: number; z?: number };
  scale?: number;
}

export interface ApiMapInstance {
  _id?: string;
  itemId: string;
  transform: ApiTransform;
  layer?: 'ground' | 'roads' | 'buildings' | 'props' | 'skyline';
  shadow?: boolean;
}

// ── Orders ─────────────────────────────────────────────────────────────────
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'done' | 'cancelled';

export interface ApiOrderLine {
  productId?: string;
  shopId?: string;
  name?: I18nField | string;
  price?: number;
  qty?: number;
  size?: string;
  color?: number;
}

export interface ApiOrder {
  _id?: string;
  id?: string;
  userId?: string;
  lines?: ApiOrderLine[];
  total?: number;
  status?: OrderStatus | string;
  createdAt?: string;
  updatedAt?: string;
}

// ── Items (admin palette) ──────────────────────────────────────────────────
export interface ApiItem {
  _id?: string;            // ObjectId — REQUIRED to place an instance
  id?: string;
  key?: string;
  name?: I18nField | string;
  category?: string;
  tags?: string[];
  status?: string;
  asset?: { glb?: { url?: string }; thumbnail?: { url?: string } };
  transformDefaults?: { scale?: number; yOffset?: number; faceAxis?: string };
}

/** Mirrors server CreateMapInstanceDto. pos/rot are partial Vec3. */
export interface MapInstanceDto {
  itemId: string;          // 24-hex ObjectId (item._id)
  transform?: {
    pos?: { x?: number; y?: number; z?: number };
    rot?: { x?: number; y?: number; z?: number };
    scale?: number;
  };
  layer?: 'ground' | 'roads' | 'buildings' | 'props' | 'skyline';
  shadow?: boolean;
  props?: Record<string, unknown>;
}

export interface ApiShop {
  _id?: string;
  id?: string;
  slug?: string;
  name?: I18nField | string;
  category?: I18nField | string;
  blurb?: I18nField | string;
  hue?: number;
  featured?: boolean;
  advisorNpcId?: string;
}

export interface ApiProduct {
  _id?: string;
  id?: string;
  shopId?: string;
  shop?: string;
  name?: I18nField | string;
  blurb?: I18nField | string;
  price?: number;
  rating?: number;
  sold?: number;
  colors?: (number | string)[];
  sizes?: string[];
  tag?: I18nField | string;
  images?: { url: string }[];
  link?: string;
  stock?: number;
}

/** The authenticated user doc as returned by /auth/me and login/register. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: string;
  coins?: number;
  renown?: number;
  streakCount?: number;
  streakBest?: number;
}

// ── Daily streak ───────────────────────────────────────────────────────────
export interface ApiCheckinResult {
  alreadyToday: boolean;
  streak: number;
  best: number;
  reward: { coins: number; renown: number; voucherCode?: string };
  renown: number;
  rank: ApiRankInfo;
}

// ── Leaderboard ────────────────────────────────────────────────────────────
export interface ApiLeaderRow {
  position: number;
  name: string;
  avatarHue: number;
  renown: number;
  rankIndex: number;
  rankName: I18nField;
}

export interface ApiLeaderboard {
  top: ApiLeaderRow[];
  me?: { position: number; renown: number; rankName: I18nField };
}

// ── Progression (Renown / Rank) ────────────────────────────────────────────
export interface ApiRankDef {
  index: number;
  name: I18nField;
  threshold: number;
}

export interface ApiProgressConfig {
  ranks: ApiRankDef[];
  sources: Record<string, { points: number; dailyCap: number }>;
}

export interface ApiRankInfo {
  index: number;
  name: I18nField;
  threshold: number;
  nextThreshold: number | null;
  progress: number;
}

export interface ApiProgressResult {
  renown: number;
  rank: ApiRankInfo;
  gained: number;
}

export interface ApiQuest {
  _id: string;
  key: string;
  title: I18nField;
  goal: { type: string; count: number };
  reward?: { coins?: number; renown?: number; voucherId?: string };
  source: string;
  chapter: number;
  daily?: boolean;
  locked?: boolean;
}

export interface ApiUserQuest {
  progress: number;
  claimed: boolean;
}

export interface ApiQuestEntry {
  quest: ApiQuest;
  userQuest: ApiUserQuest | null;
}

export interface ApiVoucher {
  _id: string;
  code: string;
  type: 'percent' | 'amount' | 'freeship';
  value: number;
}

export interface AuthResult {
  accessToken?: string;
  token?: string;
  refreshToken?: string;
  user?: PublicUser;
}

export interface Credentials {
  email: string;
  password: string;
  name?: string;
  /** Self-serve seller signup (register only). Server constrains to user|seller. */
  role?: 'user' | 'seller';
  /** Inviter's referral code from a share link (register only). */
  referralCode?: string;
}

// ── Referral / share ─────────────────────────────────────────────────────
export interface ApiReferral {
  code: string;
  count: number;
}

export interface ApiPublicProfile {
  name: string;
  avatarHue: number;
  rankName: I18nField;
  rankIndex: number;
  renown: number;
  streak: number;
  referralCount: number;
}

/** Product create/update payload — mirrors the server CreateProductDto. */
export interface ProductDto {
  shopId: string;
  name: I18nField;
  blurb?: I18nField;          // description → blurb
  price: number;
  colors?: number[];          // hex ints
  sizes?: string[];
  tags?: I18nField[];
  images?: { url: string }[];
  link?: string;              // external buy URL
  stock?: number;             // server default 100
}

/** Shop create payload — mirrors the server CreateShopDto. */
export interface ShopDto {
  name: I18nField;
  slug: string;
  category?: I18nField;
  blurb?: I18nField;
  hue?: number;
  status?: string;
}

// ── Typed endpoint helpers ─────────────────────────────────────────────────
// Each one is a thin wrapper; callers wrap in try/catch and fall back. Lists
// tolerate either a bare array or a `{ data: [...] }` envelope.

function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data)) {
    return (v as { data: T[] }).data;
  }
  return [];
}

export const api = {
  /** Published map definition (+ inline items if the server provides them). */
  getMap(slug: string, opts?: RequestOptions): Promise<{ map: ApiMap }> {
    return http
      .get<ApiMap | { map: ApiMap }>(`/maps/${encodeURIComponent(slug)}`, {
        ...opts,
        query: { published: 1, ...(opts?.query || {}) },
      })
      .then((res) => ('map' in (res as object) ? (res as { map: ApiMap }) : { map: res as ApiMap }));
  },

  /** Placed item instances for a map (by map id). */
  getMapInstances(id: string, opts?: RequestOptions): Promise<ApiMapInstance[]> {
    return http
      .get<ApiMapInstance[] | { data: ApiMapInstance[] }>(`/maps/${encodeURIComponent(id)}/instances`, opts)
      .then(asArray<ApiMapInstance>);
  },

  /** All published shops. */
  getShops(opts?: RequestOptions): Promise<ApiShop[]> {
    return http.get<ApiShop[] | { data: ApiShop[] }>('/shops', opts).then(asArray<ApiShop>);
  },

  /** Products, optionally filtered to one shop (by id or slug). */
  getProducts(shop?: string, opts?: RequestOptions): Promise<ApiProduct[]> {
    return http
      .get<ApiProduct[] | { data: ApiProduct[] }>('/products', {
        ...opts,
        query: { ...(shop ? { shop } : {}), ...(opts?.query || {}) },
      })
      .then(asArray<ApiProduct>);
  },

  /** Email/password login. Persists the returned token for later requests. */
  login(creds: Credentials, opts?: RequestOptions): Promise<AuthResult> {
    return http.post<AuthResult>('/auth/login', creds, opts).then((res) => {
      const tok = res.accessToken || res.token;
      if (tok) setToken(tok);
      return res;
    });
  },

  /** Register a new account (optionally as a seller). Persists the token. */
  register(creds: Credentials, opts?: RequestOptions): Promise<AuthResult> {
    return http.post<AuthResult>('/auth/register', creds, opts).then((res) => {
      const tok = res.accessToken || res.token;
      if (tok) setToken(tok);
      return res;
    });
  },

  /** The currently-authenticated user doc (requires a bearer token). */
  me(opts?: RequestOptions): Promise<PublicUser> {
    return http.get<PublicUser>('/auth/me', opts);
  },

  /** Shops owned by the current seller. */
  myShops(opts?: RequestOptions): Promise<ApiShop[]> {
    return http.get<ApiShop[] | { data: ApiShop[] }>('/shops/mine', opts).then(asArray<ApiShop>);
  },

  /** Create a shop (server sets sellerId from the token). */
  createShop(dto: ShopDto, opts?: RequestOptions): Promise<ApiShop> {
    return http.post<ApiShop>('/shops', dto, opts);
  },

  /** Create a product in a shop the caller owns. */
  createProduct(dto: ProductDto, opts?: RequestOptions): Promise<ApiProduct> {
    return http.post<ApiProduct>('/products', dto, opts);
  },

  /** Update an owned product. */
  updateProduct(id: string, dto: Partial<ProductDto>, opts?: RequestOptions): Promise<ApiProduct> {
    return http.patch<ApiProduct>(`/products/${encodeURIComponent(id)}`, dto, opts);
  },

  /** Delete an owned product. */
  deleteProduct(id: string, opts?: RequestOptions): Promise<void> {
    return http.delete<void>(`/products/${encodeURIComponent(id)}`, opts);
  },

  // ── Orders (role-scoped server-side) ──
  /** Orders visible to the caller (admin=all, seller=own shops, user=own). */
  getOrders(opts?: RequestOptions): Promise<ApiOrder[]> {
    return http.get<ApiOrder[] | { data: ApiOrder[] }>('/orders', opts).then(asArray<ApiOrder>);
  },

  /** Advance/cancel an order's status (seller/admin). */
  updateOrderStatus(id: string, status: OrderStatus, opts?: RequestOptions): Promise<ApiOrder> {
    return http.patch<ApiOrder>(`/orders/${encodeURIComponent(id)}/status`, { status }, opts);
  },

  // ── Items (admin palette) ──
  /** Item dictionary (admin only). */
  getItems(opts?: RequestOptions): Promise<ApiItem[]> {
    return http.get<ApiItem[] | { data: ApiItem[] }>('/items', opts).then(asArray<ApiItem>);
  },

  // ── Map editor (admin) ──
  /** Resolve a map by slug to its document (so the editor can read its id). */
  getMapBySlug(slug: string, opts?: RequestOptions): Promise<ApiMap | null> {
    return http
      .get<ApiMap | { map: ApiMap }>(`/maps/${encodeURIComponent(slug)}`, opts)
      .then((res) => (res && 'map' in (res as object) ? (res as { map: ApiMap }).map : (res as ApiMap)));
  },

  /** Place a new item instance on a (draft) map. itemId must be a 24-hex ObjectId. */
  createMapInstance(mapId: string, dto: MapInstanceDto, opts?: RequestOptions): Promise<ApiMapInstance> {
    return http.post<ApiMapInstance>(`/maps/${encodeURIComponent(mapId)}/instances`, dto, opts);
  },

  /** Update a placed instance (transform/layer/etc). */
  updateMapInstance(
    mapId: string,
    iid: string,
    dto: Partial<MapInstanceDto>,
    opts?: RequestOptions,
  ): Promise<ApiMapInstance> {
    return http.patch<ApiMapInstance>(
      `/maps/${encodeURIComponent(mapId)}/instances/${encodeURIComponent(iid)}`,
      dto,
      opts,
    );
  },

  /** Remove a placed instance. */
  deleteMapInstance(mapId: string, iid: string, opts?: RequestOptions): Promise<void> {
    return http.delete<void>(
      `/maps/${encodeURIComponent(mapId)}/instances/${encodeURIComponent(iid)}`,
      opts,
    );
  },

  /** Publish a draft map. */
  publishMap(mapId: string, opts?: RequestOptions): Promise<ApiMap> {
    return http.post<ApiMap>(`/maps/${encodeURIComponent(mapId)}/publish`, undefined, opts);
  },

  // ── Progression (Renown / Rank / quests / earned vouchers) ──
  /** Public rank ladder + per-source rules (so thresholds aren't FE-hardcoded). */
  getProgressionConfig(opts?: RequestOptions): Promise<ApiProgressConfig> {
    return http.get<ApiProgressConfig>('/progression/config', opts);
  },

  /** Record one progress event (server applies daily caps + advances quests). */
  recordProgress(event: string, opts?: RequestOptions): Promise<ApiProgressResult> {
    return http.post<ApiProgressResult>('/me/progress', { event }, opts);
  },

  /** The caller's quest progress joined with each active quest definition. */
  getMyQuests(opts?: RequestOptions): Promise<ApiQuestEntry[]> {
    return http.get<ApiQuestEntry[] | { data: ApiQuestEntry[] }>('/me/quests', opts).then(asArray<ApiQuestEntry>);
  },

  /** Claim a completed quest's reward (coins + renown + voucher), once. */
  claimMyQuest(questId: string, opts?: RequestOptions): Promise<ApiUserQuest> {
    return http.post<ApiUserQuest>(`/me/quests/${encodeURIComponent(questId)}/claim`, undefined, opts);
  },

  /** Vouchers the caller owns (earned via milestones / redeemed). */
  getMyVouchers(opts?: RequestOptions): Promise<ApiVoucher[]> {
    return http.get<ApiVoucher[] | { data: ApiVoucher[] }>('/me/vouchers', opts).then(asArray<ApiVoucher>);
  },

  /** Daily streak check-in (idempotent within a day). */
  checkin(opts?: RequestOptions): Promise<ApiCheckinResult> {
    return http.post<ApiCheckinResult>('/me/checkin', undefined, opts);
  },

  /** Tastemaker leaderboard: top players by renown + the caller's position. */
  getLeaderboard(limit = 20, opts?: RequestOptions): Promise<ApiLeaderboard> {
    return http.get<ApiLeaderboard>('/leaderboard', { ...opts, query: { limit, ...(opts?.query || {}) } });
  },

  /** The caller's own referral code + successful-invite count. */
  getReferral(opts?: RequestOptions): Promise<ApiReferral> {
    return http.get<ApiReferral>('/me/referral', opts);
  },

  /** Public share-card data for a referral code (no auth). */
  getPublicProfile(code: string, opts?: RequestOptions): Promise<ApiPublicProfile> {
    return http.get<ApiPublicProfile>(`/u/${encodeURIComponent(code)}`, opts);
  },
};

export { BASE_URL, TOKEN_KEY };
