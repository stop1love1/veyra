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
}

export interface AuthResult {
  accessToken?: string;
  token?: string;
  user?: { id: string; email: string; name: string; role: string };
}

export interface Credentials {
  email: string;
  password: string;
  name?: string;
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

  /** Register a new account. Persists the returned token if one is issued. */
  register(creds: Credentials, opts?: RequestOptions): Promise<AuthResult> {
    return http.post<AuthResult>('/auth/register', creds, opts).then((res) => {
      const tok = res.accessToken || res.token;
      if (tok) setToken(tok);
      return res;
    });
  },
};

export { BASE_URL, TOKEN_KEY };
