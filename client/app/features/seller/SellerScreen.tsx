// 2D Seller Dashboard. Offline-safe:
//   • Guests / non-sellers see a sign-in prompt (never crashes).
//   • Sellers list the shop(s) they own (api.myShops), can create a shop when
//     they have none, and add / edit / delete products via the shared
//     <ProductForm/> (→ api.createProduct/updateProduct/deleteProduct).
//   • Every api.* call is wrapped in try/catch; on failure we keep the static
//     catalog and surface a retry, so the app never blocks.
import React from 'react';
import { VEYRA } from '../../data';
import { Glass, Btn, Ic, ScenePlaceholder } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { ProductForm } from '../../components/forms/ProductForm';
import { api } from '../../lib/api/client';
import type { ApiShop, ProductDto, ShopDto, ApiOrder, ApiOrderLine, OrderStatus } from '../../lib/api/client';
import { getProducts as fetchProducts } from '../../lib/data/remote';
import type { ScreenProps } from '../../lib/game/types';
import type { Product, Shop, Localized } from '../../data/types';

const { money, tx } = VEYRA;

// ── helpers ────────────────────────────────────────────────────────────────
function shopId(s: ApiShop, i: number): string {
  return s.id || s.slug || s._id || `srv-${i}`;
}
function loc(v: ApiShop['name']): Localized {
  if (v && typeof v === 'object') return { vi: v.vi || '', en: v.en || v.vi || '' };
  const s = typeof v === 'string' ? v : '';
  return { vi: s, en: s };
}
function shopTitle(s: ApiShop, lang: 'vi' | 'en'): string {
  const n = loc(s.name);
  return n[lang] || n.vi || s.slug || '';
}

// Turn an API DTO back into a client Product shape for optimistic local insert.
function dtoToProduct(dto: ProductDto, id: string): Product {
  return {
    id,
    shop: dto.shopId,
    price: dto.price,
    rating: 0,
    sold: 0,
    name: { vi: dto.name.vi, en: dto.name.en || dto.name.vi },
    tag: dto.tags && dto.tags[0] ? { vi: dto.tags[0].vi, en: dto.tags[0].en || dto.tags[0].vi } : undefined,
    desc: dto.blurb ? { vi: dto.blurb.vi, en: dto.blurb.en || dto.blurb.vi } : { vi: '', en: '' },
    colors: (dto.colors || []).map((c) => '#' + (c >>> 0).toString(16).padStart(6, '0')),
    sizes: dto.sizes && dto.sizes.length ? dto.sizes : ['One'],
    images: (dto.images || []).map((im) => im.url).filter(Boolean),
    link: dto.link,
    stock: dto.stock,
  };
}

// Pre-fill the form from an existing Product (edit mode).
function productToForm(p: Product) {
  return {
    name: { vi: p.name.vi, en: p.name.en },
    description: { vi: p.desc?.vi || '', en: p.desc?.en || '' },
    imageUrls: p.images && p.images.length ? p.images : [''],
    link: p.link || '',
    price: p.price,
    stock: typeof p.stock === 'number' ? p.stock : undefined,
    colors: p.colors || [],
    sizes: p.sizes && p.sizes.length ? p.sizes : ['One'],
    tags: p.tag ? [{ vi: p.tag.vi, en: p.tag.en }] : [],
  };
}

// ── order helpers ───────────────────────────────────────────────────────────
const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'done', 'cancelled'];
// Linear advance flow (cancelled is reached only via the explicit Cancel action).
const ADVANCE: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'paid',
  paid: 'shipped',
  shipped: 'done',
};
function orderId(o: ApiOrder): string {
  return o.id || o._id || '';
}
function statusKey(s: OrderStatus | string | undefined): string {
  const v = (s || 'pending') as string;
  return 'status' + v.charAt(0).toUpperCase() + v.slice(1);
}
// Order line name can be a {vi,en} field OR a plain string → coerce to Localized.
function lineName(n: ApiOrderLine['name'], lang: 'vi' | 'en'): string {
  if (n && typeof n === 'object') return n[lang] || n.vi || '';
  return typeof n === 'string' ? n : '';
}

// ── product thumbnail ───────────────────────────────────────────────────────
function Thumb({ p, hue }: { p: Product; hue: number }) {
  const [broken, setBroken] = React.useState(false);
  const url = p.images && p.images[0];
  const box: React.CSSProperties = {
    width: 60, height: 60, borderRadius: 12, flex: '0 0 auto', overflow: 'hidden',
    border: '1.5px solid var(--line)', background: 'var(--paper-2)',
  };
  if (url && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <div style={box}>
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
             onError={() => setBroken(true)} />
      </div>
    );
  }
  return <div style={box}><ScenePlaceholder label="" hue={hue} h={60} icon="hanger" /></div>;
}

// ── create-shop inline form (NOT ProductForm) ───────────────────────────────
function CreateShopForm({ t, onCreate, onCancel, busy }: {
  t: (k: string) => string;
  onCreate: (dto: ShopDto) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [nameVi, setNameVi] = React.useState('');
  const [nameEn, setNameEn] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [catVi, setCatVi] = React.useState('');
  const [hue, setHue] = React.useState(184);

  const autoSlug = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const effSlug = slug.trim() || autoSlug(nameEn || nameVi);
  const valid = nameVi.trim().length > 0 && effSlug.length > 0 && !busy;

  const two: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
  const half: React.CSSProperties = { flex: 1, minWidth: 140 };

  return (
    <div className="v-form" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="v-field">
        <span className="v-field-label">{t('createShop')}</span>
        <div style={two}>
          <input className="v-input" style={half} placeholder="VI" aria-label={`${t('createShop')} (VI)`} value={nameVi}
                 onChange={(e) => setNameVi(e.target.value)} />
          <input className="v-input" style={half} placeholder="EN" aria-label={`${t('createShop')} (EN)`} value={nameEn}
                 onChange={(e) => setNameEn(e.target.value)} />
        </div>
      </div>
      <div className="v-field">
        <span className="v-field-label">{t('shopSlug')}</span>
        <input className="v-input" placeholder={effSlug || 'my-shop'} value={slug}
               onChange={(e) => setSlug(e.target.value)} />
      </div>
      <div className="v-field">
        <span className="v-field-label">{t('category')}</span>
        <input className="v-input" placeholder="VI" aria-label={t('category')} value={catVi}
               onChange={(e) => setCatVi(e.target.value)} />
      </div>
      <div className="v-field">
        <span className="v-field-label">{t('color')}</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="range" min={0} max={360} value={hue}
                 onChange={(e) => setHue(Number(e.target.value))} style={{ flex: 1 }} />
          <span className="v-swatch v-swatch-solid is-on"
                style={{ background: `hsl(${hue} 70% 60%)`, width: 28, height: 28 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <Btn variant="ghost-d" size="lg" onClick={onCancel}>{t('cancel')}</Btn>
        <Btn variant="primary" size="lg" icon="check"
             disabled={!valid}
             onClick={() => onCreate({
               name: { vi: nameVi.trim(), en: (nameEn || nameVi).trim() },
               slug: effSlug,
               category: catVi.trim() ? { vi: catVi.trim(), en: catVi.trim() } : undefined,
               hue,
             })}>
          {t('save')}
        </Btn>
      </div>
    </div>
  );
}

// ── order status pill ───────────────────────────────────────────────────────
function StatusPill({ status, t }: { status: OrderStatus | string | undefined; t: (k: string) => string }) {
  const hueByStatus: Record<string, number> = {
    pending: 42, paid: 200, shipped: 264, done: 152, cancelled: 0,
  };
  const v = (status || 'pending') as string;
  const hue = hueByStatus[v] ?? 210;
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
        color: `hsl(${hue} 60% 32%)`, background: `hsl(${hue} 70% 92%)`,
        border: `1px solid hsl(${hue} 60% 80%)`, whiteSpace: 'nowrap',
      }}
    >
      {t(statusKey(status))}
    </span>
  );
}

// ── one order card ───────────────────────────────────────────────────────────
function OrderCard({ o, t, lang, onStatus }: {
  o: ApiOrder;
  t: (k: string) => string;
  lang: 'vi' | 'en';
  onStatus: (o: ApiOrder, next: OrderStatus) => void;
}) {
  const status = (o.status || 'pending') as OrderStatus | string;
  const next = ADVANCE[status as OrderStatus];
  const closed = status === 'done' || status === 'cancelled';
  const id = orderId(o);
  const lines = o.lines || [];

  return (
    <Glass className="v-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('orderBuyer')}</div>
          <div className="v-mono" style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {o.userId ? o.userId.slice(-8) : (id ? id.slice(-8) : '—')}
          </div>
        </div>
        <StatusPill status={status} t={t} />
      </div>

      {lines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lines.map((ln, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lineName(ln.name, lang) || '—'}
              </span>
              <span className="v-mono" style={{ color: 'var(--muted)' }}>×{ln.qty ?? 1}</span>
              <span className="v-mono" style={{ color: 'var(--muted)', minWidth: 64, textAlign: 'right' }}>
                {money(typeof ln.price === 'number' ? ln.price : 0)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('orderTotal')}</span>{' '}
          <span className="v-mono" style={{ fontWeight: 700, color: 'var(--text)' }}>{money(typeof o.total === 'number' ? o.total : 0)}</span>
        </div>
        {!closed && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {next && (
              <Btn variant="primary" size="sm" icon="check" onClick={() => onStatus(o, next)}>
                {t('advanceStatus')}
              </Btn>
            )}
            <Btn variant="ghost-d" size="sm" icon="close" onClick={() => onStatus(o, 'cancelled')}>
              {t('cancelOrder')}
            </Btn>
          </div>
        )}
      </div>
    </Glass>
  );
}

// ── orders panel (tab body) ──────────────────────────────────────────────────
function OrdersPanel({ t, lang, orders, loading, offline, onRetry, onStatus }: {
  t: (k: string) => string;
  lang: 'vi' | 'en';
  orders: ApiOrder[];
  loading: boolean;
  offline: boolean;
  onRetry: () => void;
  onStatus: (o: ApiOrder, next: OrderStatus) => void;
}) {
  return (
    <div className="v-quest-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      {loading && (
        <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{t('loadingOrders')}</Glass>
      )}

      {!loading && offline && (
        <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
          <Ic name="globe" size={28} />
          <p style={{ margin: 0, color: 'var(--muted)' }}>{t('loadFailed')}</p>
          <Btn variant="soft" size="sm" icon="globe" onClick={onRetry}>{t('orders')}</Btn>
        </Glass>
      )}

      {!loading && !offline && orders.length === 0 && (
        <Glass className="v-card" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{t('noOrders')}</Glass>
      )}

      {!loading && !offline && orders.map((o, i) => (
        <OrderCard key={orderId(o) || `order-${i}`} o={o} t={t} lang={lang} onStatus={onStatus} />
      ))}
    </div>
  );
}

// ── main screen ──────────────────────────────────────────────────────────────
type Editing = { shop: string; product?: Product } | null;

export function SellerScreen({ g }: ScreenProps) {
  const t = g.t;
  const lang = g.lang;

  const [shops, setShops] = React.useState<ApiShop[]>([]);
  const [products, setProducts] = React.useState<Record<string, Product[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const [creatingShop, setCreatingShop] = React.useState(false);
  const [shopBusy, setShopBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<Editing>(null);

  // ── tabs + orders ──
  const [tab, setTab] = React.useState<'shops' | 'orders'>('shops');
  const [orders, setOrders] = React.useState<ApiOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = React.useState(false);
  const [ordersOffline, setOrdersOffline] = React.useState(false);
  const [ordersLoaded, setOrdersLoaded] = React.useState(false);

  const isSeller = g.auth.isSeller;

  const loadProductsFor = React.useCallback(async (sid: string) => {
    try {
      const list = await fetchProducts(sid); // remote → static fallback, mapped
      setProducts((prev) => ({ ...prev, [sid]: list.filter((p) => !p.shop || p.shop === sid) }));
    } catch {
      setProducts((prev) => ({ ...prev, [sid]: prev[sid] || [] }));
    }
  }, []);

  const load = React.useCallback(async () => {
    if (!isSeller) { setLoading(false); return; }
    setLoading(true);
    setOffline(false);
    try {
      const mine = await api.myShops();
      setShops(mine);
      await Promise.all(mine.map((s, i) => loadProductsFor(shopId(s, i))));
    } catch {
      setOffline(true);
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, [isSeller, loadProductsFor]);

  React.useEffect(() => { void load(); }, [load]);

  // ── create shop ──
  const createShop = async (dto: ShopDto) => {
    setShopBusy(true);
    try {
      const created = await api.createShop(dto);
      // The freshly-created shop becomes index 0 of the list below, so derive
      // its key with the SAME positional index used when rendering (shopId(s, 0))
      // — otherwise products would load into an orphan bucket if the server ever
      // omits id/slug/_id.
      setShops((prev) => [created, ...prev]);
      setCreatingShop(false);
      g.flash(t('createShop'));
      await loadProductsFor(shopId(created, 0));
    } catch {
      g.flash(t('saveFailed'));
    } finally {
      setShopBusy(false);
    }
  };

  // ── product create / edit ──
  const submitProduct = async (dto: ProductDto) => {
    const sid = dto.shopId;
    const existing = editing && editing.product;
    try {
      if (existing) {
        const updated = await api.updateProduct(existing.id, dto);
        const id = updated.id || updated._id || existing.id;
        const next = dtoToProduct(dto, id);
        setProducts((prev) => ({
          ...prev,
          [sid]: (prev[sid] || []).map((p) => (p.id === existing.id ? next : p)),
        }));
        g.flash(t('productSaved'));
      } else {
        const created = await api.createProduct(dto);
        const serverId = created.id || created._id;
        const id = serverId || `local-${Date.now()}`;
        const next = dtoToProduct(dto, id);
        setProducts((prev) => ({ ...prev, [sid]: [next, ...(prev[sid] || [])] }));
        g.flash(t('productAdded'));
        // If the server didn't echo a real id, the optimistic row carries a
        // synthetic `local-` id that a later edit/delete would 404 on. Reconcile
        // against the source of truth so subsequent mutations use the real id.
        if (!serverId) void loadProductsFor(sid);
      }
      setEditing(null);
    } catch {
      g.flash(t('saveFailed'));
    }
  };

  // ── delete ──
  const deleteProduct = async (sid: string, p: Product) => {
    if (typeof window !== 'undefined' && !window.confirm(t('confirmDelete'))) return;
    const prev = products[sid] || [];
    setProducts((s) => ({ ...s, [sid]: prev.filter((x) => x.id !== p.id) })); // optimistic
    try {
      await api.deleteProduct(p.id);
      g.flash(t('productDeleted'));
    } catch {
      setProducts((s) => ({ ...s, [sid]: prev })); // roll back
      g.flash(t('saveFailed'));
    }
  };

  // ── orders ──
  const loadOrders = React.useCallback(async () => {
    if (!isSeller) { setOrdersLoading(false); return; }
    setOrdersLoading(true);
    setOrdersOffline(false);
    try {
      const list = await api.getOrders();
      setOrders(list);
      setOrdersLoaded(true);
    } catch {
      setOrdersOffline(true);
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [isSeller]);

  // Lazy-load orders the first time the Orders tab opens.
  React.useEffect(() => {
    if (tab === 'orders' && !ordersLoaded && !ordersLoading && !ordersOffline) void loadOrders();
  }, [tab, ordersLoaded, ordersLoading, ordersOffline, loadOrders]);

  const setOrderStatus = async (o: ApiOrder, next: OrderStatus) => {
    const id = orderId(o);
    if (!id) return;
    const prev = orders;
    // optimistic
    setOrders((s) => s.map((x) => (orderId(x) === id ? { ...x, status: next } : x)));
    try {
      await api.updateOrderStatus(id, next);
      g.flash(t('orderUpdated'));
    } catch {
      setOrders(prev); // roll back
      g.flash(t('saveFailed'));
    }
  };

  // ── guard: not a seller ──
  if (!isSeller) {
    return (
      <div className="v-screen v-light">
        <div className="v-topbar v-topbar-light">
          <button className="v-iconbtn" onClick={() => g.go('world')} aria-label={t('aBack')}><Ic name="chevL" /></button>
          <span className="v-topbar-title-l">{t('sellerDash')}</span>
          <span style={{ width: 38 }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Glass className="v-card" style={{ maxWidth: 360, textAlign: 'center', padding: 28, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <Ic name="shield" size={36} />
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>{t('seller')}</p>
            <Btn variant="primary" size="lg" icon="user" onClick={() => g.openAuth()}>{t('signIn')}</Btn>
          </Glass>
        </div>
        <HudDock g={g} active="seller" />
      </div>
    );
  }

  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.go('world')} aria-label={t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{t('sellerDash')}</span>
        <button
          className="v-iconbtn"
          onClick={() => (tab === 'orders' ? void loadOrders() : void load())}
          aria-label={tab === 'orders' ? t('orders') : t('myShops')}
        ><Ic name="globe" /></button>
      </div>

      {/* Tab switcher: Shops ⇄ Orders */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}>
        <Btn
          variant={tab === 'shops' ? 'primary' : 'ghost-d'}
          size="sm"
          icon="hanger"
          onClick={() => setTab('shops')}
        >{t('shopTab')}</Btn>
        <Btn
          variant={tab === 'orders' ? 'primary' : 'ghost-d'}
          size="sm"
          icon="globe"
          onClick={() => setTab('orders')}
        >{t('ordersTab')}</Btn>
      </div>

      {tab === 'orders' ? (
        <OrdersPanel
          t={t}
          lang={lang}
          orders={orders}
          loading={ordersLoading}
          offline={ordersOffline}
          onRetry={() => void loadOrders()}
          onStatus={setOrderStatus}
        />
      ) : (
      <div className="v-quest-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
        {loading && (
          <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{t('loadingShops')}</Glass>
        )}

        {!loading && offline && (
          <Glass className="v-card" role="status" aria-live="polite" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', textAlign: 'center' }}>
            <Ic name="globe" size={28} />
            <p style={{ margin: 0, color: 'var(--muted)' }}>{t('loadFailed')}</p>
            <Btn variant="soft" size="sm" icon="globe" onClick={() => void load()}>{t('myShops')}</Btn>
          </Glass>
        )}

        {/* No shops → create-shop CTA */}
        {!loading && !offline && shops.length === 0 && (
          <Glass className="v-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)', textAlign: 'center' }}>{t('noShopsYet')}</p>
            {creatingShop ? (
              <CreateShopForm t={t} busy={shopBusy} onCreate={createShop} onCancel={() => setCreatingShop(false)} />
            ) : (
              <Btn variant="primary" size="lg" icon="plus" full onClick={() => setCreatingShop(true)}>{t('createShop')}</Btn>
            )}
          </Glass>
        )}

        {/* Has shops */}
        {!loading && !offline && shops.length > 0 && shops.map((s, i) => {
          const sid = shopId(s, i);
          const hue = typeof s.hue === 'number' ? s.hue : 184;
          const list = products[sid] || [];
          return (
            <Glass key={sid} className="v-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="v-swatch v-swatch-solid is-on" style={{ background: `hsl(${hue} 70% 60%)`, width: 30, height: 30 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text)' }}>{shopTitle(s, lang)}</div>
                  <div className="v-mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{s.slug || sid}</div>
                </div>
                <Btn variant="primary" size="sm" icon="plus" onClick={() => setEditing({ shop: sid })}>{t('addProduct')}</Btn>
              </div>

              {list.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, padding: '4px 2px' }}>{t('emptyShop')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {list.map((p) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Thumb p={p} hue={hue} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx(p.name, lang)}</div>
                        <div className="v-mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{money(p.price)}</div>
                      </div>
                      <button className="v-iconbtn" aria-label={t('editProduct')} onClick={() => setEditing({ shop: sid, product: p })}><Ic name="hanger" size={16} /></button>
                      <button className="v-iconbtn" aria-label={t('deleteProduct')} onClick={() => void deleteProduct(sid, p)}><Ic name="close" size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Glass>
          );
        })}
      </div>
      )}

      {/* Add / Edit product modal (shared ProductForm) */}
      {editing && (
        <div className="v-overlay" onClick={() => setEditing(null)}>
          <div className="v-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '92%', overflowY: 'auto' }}>
            <div className="v-sheet-grab" />
            <button className="v-sheet-close v-iconbtn" onClick={() => setEditing(null)} aria-label={t('aClose')}><Ic name="close" size={18} /></button>
            <div style={{ padding: '8px 20px 24px' }}>
              <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text)', marginBottom: 14 }}>
                {editing.product ? t('editProduct') : t('addProduct')}
              </div>
              <ProductForm
                shopId={editing.shop}
                value={editing.product ? productToForm(editing.product) : undefined}
                onSubmit={submitProduct}
                onCancel={() => setEditing(null)}
                t={t}
                lang={lang}
              />
            </div>
          </div>
        </div>
      )}

      <HudDock g={g} active="seller" />
    </div>
  );
}
