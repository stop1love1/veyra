// Remote-with-fallback data source for shops/products.
//
// Tries the live API (api.getShops / api.getProducts) and maps the server
// shapes onto the existing client VEYRA shapes (Shop / Product from
// data/types). If the server is offline or returns nothing usable, it falls
// back to the bundled static catalog — so screens keep working with no server.
//
// This module is additive: the static `data/catalog.ts` is NOT removed. Screens
// can opt in to `getShops()/getProducts()` here; by default they still import
// the static `VEYRA` aggregate. At minimum this is exported for future wiring.

import { api } from '../api/client';
import type { ApiShop, ApiProduct, I18nField } from '../api/client';
import { SHOPS as STATIC_SHOPS, PRODUCTS as STATIC_PRODUCTS } from '../../data/catalog';
import type { Shop, Product, Localized } from '../../data/types';

// ── mapping helpers ──────────────────────────────────────────────────────
// Coerce an API field (bilingual object OR a plain string) into a Localized.
function toLocalized(v: I18nField | string | undefined, fallback = ''): Localized {
  if (v && typeof v === 'object') return { vi: v.vi ?? fallback, en: v.en ?? v.vi ?? fallback };
  const s = typeof v === 'string' ? v : fallback;
  return { vi: s, en: s };
}

const idOf = (o: { _id?: string; id?: string; slug?: string }, i: number): string =>
  o.id || o.slug || o._id || `srv-${i}`;

// Map one API shop onto the client Shop shape. x/y are layout coords used only
// by the lite 2D map; the server doesn't own them, so we spread shops on a ring.
function mapShop(s: ApiShop, i: number, total: number): Shop {
  const ang = (i / Math.max(1, total)) * Math.PI * 2;
  return {
    id: idOf(s, i),
    hue: typeof s.hue === 'number' ? s.hue : 184,
    x: Math.round(50 + Math.cos(ang) * 28),
    y: Math.round(50 + Math.sin(ang) * 24),
    featured: !!s.featured,
    name: toLocalized(s.name, 'Shop'),
    cat: toLocalized(s.category, ''),
    blurb: toLocalized(s.blurb, ''),
    npc: s.advisorNpcId || '',
  };
}

function mapProduct(p: ApiProduct, i: number): Product {
  const colors = (p.colors || []).map((c) =>
    typeof c === 'number' ? '#' + (c >>> 0).toString(16).padStart(6, '0') : String(c),
  );
  return {
    id: idOf(p, i),
    shop: p.shopId || p.shop || '',
    price: typeof p.price === 'number' ? p.price : 0,
    rating: typeof p.rating === 'number' ? p.rating : 0,
    sold: typeof p.sold === 'number' ? p.sold : 0,
    name: toLocalized(p.name, 'Product'),
    tag: p.tag != null ? toLocalized(p.tag) : undefined,
    desc: toLocalized(p.blurb, ''),
    colors,
    sizes: p.sizes && p.sizes.length ? p.sizes : ['One'],
  };
}

// ── public API (remote, with static fallback) ───────────────────────────

/** Shops from the server, mapped to client shape; static catalog on failure. */
export async function getShops(): Promise<Shop[]> {
  try {
    const remote = await api.getShops();
    if (remote && remote.length) return remote.map((s, i) => mapShop(s, i, remote.length));
  } catch {
    /* offline → fall through */
  }
  return STATIC_SHOPS;
}

/** Products (optionally for one shop); static catalog on failure. */
export async function getProducts(shop?: string): Promise<Product[]> {
  try {
    const remote = await api.getProducts(shop);
    if (remote && remote.length) return remote.map(mapProduct);
  } catch {
    /* offline → fall through */
  }
  return shop ? STATIC_PRODUCTS.filter((p) => p.shop === shop) : STATIC_PRODUCTS;
}

/** Both lists in one round-trip-ish call, each independently falling back. */
export async function getCatalog(): Promise<{ shops: Shop[]; products: Product[] }> {
  const [shops, products] = await Promise.all([getShops(), getProducts()]);
  return { shops, products };
}
