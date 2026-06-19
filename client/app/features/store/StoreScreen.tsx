import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Glass, Btn, Avatar, Stars, Eyebrow, ScenePlaceholder, Loader } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { createVeyraStore } from '../../lib/three/store';
import { registerInspect } from '../../lib/three/inspectBridge';
import { ManagePanel } from '../../components/overlays/ManagePanel';
import { setActiveProducts } from '../../components/overlays/ProductPanel';
import { api } from '../../lib/api/client';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';
import type { Product } from '../../data/types';

interface StoreApi {
  dispose: () => void;
  inspect: (id: string) => void;
  endInspect: () => void;
  setInspectColor: (hex: string) => void;
  addProduct: (p: { id: string; name: string; price: string; color: string }) => boolean;
}

interface StoreProximity {
  id?: string;
  type?: string;
}

interface EnterPrompt {
  sub: string;
  title: string;
  cta: string;
  act: () => void;
}

/** Shared seller-ownership + live-product hook for both the 3D and lite stores.
 *  - Seeds the product list from the static catalog (offline-safe).
 *  - Resolves whether the logged-in seller OWNS this shop (api.myShops), so the
 *    "Manage shop" affordance only appears for owners. On API failure → not an
 *    owner → button hidden; guest browsing is never blocked.
 *  - Publishes the live list to ProductPanel's registry so seller-added
 *    products (absent from the static catalog) still resolve in the detail panel. */
function useShopManage(g: Game, shopId: string, seed: Product[]) {
  const [products, setProducts] = React.useState<Product[]>(seed);
  const [ownsShop, setOwnsShop] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);

  // Reseed when the shop changes.
  React.useEffect(() => { setProducts(seed); }, [shopId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish to the global ProductPanel registry; clear on unmount.
  React.useEffect(() => {
    setActiveProducts(products);
    return () => setActiveProducts([]);
  }, [products]);

  // Resolve ownership once (offline-safe).
  React.useEffect(() => {
    let cancelled = false;
    if (!g.auth.isSeller) { setOwnsShop(false); return; }
    (async () => {
      try {
        const mine = await api.myShops();
        if (cancelled) return;
        const ids = mine.map((s) => s.id || s.slug || s._id).filter(Boolean) as string[];
        setOwnsShop(ids.includes(shopId));
      } catch {
        if (!cancelled) setOwnsShop(false); // offline → hide manage UI
      }
    })();
    return () => { cancelled = true; };
  }, [g.auth.isSeller, shopId]);

  const addProduct = React.useCallback((p: Product) => {
    setProducts((list) => (list.some((x) => x.id === p.id) ? list : [...list, p]));
  }, []);

  return { products, ownsShop, manageOpen, setManageOpen, addProduct };
}

export function StoreScreen({ g }: { g: Game }) {
  return g.lite ? <StoreLite g={g} /> : <Store3D g={g} />;
}

function Store3D({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const api3d = React.useRef<StoreApi | null>(null);
  const [near, setNear] = React.useState<StoreProximity | null>(null);
  const [ready, setReady] = React.useState(false);
  const shop = VEYRA.SHOPS.find((s) => s.id === (g.params.shop || 'aria'))!;
  const npc = VEYRA.NPCS[shop.npc];
  const productList = VEYRA.PRODUCTS.filter((p) => p.shop === shop.id);
  const seed = productList.length ? productList : VEYRA.PRODUCTS.slice(0, 6);

  const mng = useShopManage(g, shop.id, seed);

  React.useEffect(() => {
    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    function start() {
      if (cancelled || !ref.current || api3d.current) return;
      api3d.current = createVeyraStore(ref.current, {
        shopHue: shop.hue, lang: g.lang,
        labels: { advisor: g.t('staff') },
        look: { hue: g.player.hue, skin: g.player.skin != null ? g.player.skin : 1, style: g.player.style || 'minimal' },
        npc: { name: npc.name, hue: npc.hue },
        products: seed.map((p) => ({ id: p.id, name: VEYRA.tx(p.name, g.lang), price: VEYRA.money(p.price), color: p.colors[0] })),
        onProximity: (s: StoreProximity | null) => setNear(s),
      }) as StoreApi;
      // Register the inspect bridge for the whole 3D-store lifetime so the
      // globally-rendered ProductPanel knows (on its very first render) that it
      // is on the 3D path, and so colour swatches can retint the live garment.
      const a = api3d.current;
      registerInspect({
        setInspectColor: (hex: string) => a.setInspectColor(hex),
        endInspect: () => api3d.current?.endInspect(),
      });
      // Defer so the branded loader actually paints during shader compile.
      readyTimer = setTimeout(() => { if (!cancelled) setReady(true); }, 0);
    }
    start();
    return () => {
      cancelled = true; clearTimeout(readyTimer);
      registerInspect(null);
      if (api3d.current) { api3d.current.dispose(); api3d.current = null; }
    };
  }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the tactile inspector from product open/close. Opening a product
  // dollies the store camera to its pedestal and lifts the garment onto a
  // turntable; closing tweens back to the follow camera. The colour-swatch
  // retint flows through the inspect bridge (registered here for ProductPanel).
  React.useEffect(() => {
    const a = api3d.current;
    if (!a) return;
    if (g.productOpen) a.inspect(g.productOpen);
    else a.endInspect();
  }, [g.productOpen]);

  // Optimistic shelf insert: when ManagePanel reports a created product, push a
  // pedestal live (diegetic "I just stocked my shelf"). The 3D shelf caps at 6
  // slots: if they are full, api3d.addProduct() returns false and no-ops. The
  // product still lives in the React list (lite/detail panels and proximity-by-
  // list reflect it), so overflow products are list-only for the session — there
  // is no mid-session store re-init (a full dispose+recreate would be jarring).
  const onAdded = React.useCallback((p: Product) => {
    mng.addProduct(p);
    api3d.current?.addProduct({
      id: p.id,
      name: VEYRA.tx(p.name, g.lang),
      price: VEYRA.money(p.price),
      color: p.colors[0] || '#cfd8d2',
    });
  }, [mng, g.lang]);

  let prompt: EnterPrompt | null = null;
  if (near) {
    if (near.type === 'exit') prompt = { sub: g.t('exit'), title: g.t('backToPlaza'), cta: g.t('leave'), act: () => g.go('world') };
    else if (near.type === 'npc') prompt = { sub: VEYRA.tx(npc.role, g.lang), title: npc.name, cta: g.t('talkTo'), act: () => g.openNPC(shop.npc) };
    else { const p = near.id ? findProduct(mng.products, near.id) : undefined; prompt = { sub: g.t('shelf'), title: p ? VEYRA.tx(p.name, g.lang) : '', cta: g.t('view'), act: () => near.id && g.openProduct(near.id) }; }
  }

  return (
    <div className="v-screen v-world3d">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading"><Loader label={g.t('loadingStore')} /></div>}
      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('world')} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        {mng.ownsShop && (
          <button className="v-iconbtn-d" onClick={() => mng.setManageOpen(true)} aria-label={g.t('manageShop')} title={g.t('manageShop')}>
            <Ic name="bag" />
          </button>
        )}
        <button className="v-iconbtn-d" onClick={() => g.openWorldPanel('cart')} aria-label={g.t('aCart')}>
          <Ic name="cart" />{g.cartCount > 0 && <span className="v-dot">{g.cartCount}</span>}
        </button>
      </div>
      {prompt && (
        <div className="v-enter-prompt" key={near?.id}>
          <Glass dark className="v-enter-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="v-mono v-enter-sub">{prompt.sub}</div>
              <div className="v-enter-name">{prompt.title}</div>
            </div>
            <Btn variant="primary" size="md" icon="chevR" onClick={prompt.act}>{prompt.cta}</Btn>
          </Glass>
        </div>
      )}
      {mng.manageOpen && (
        <ManagePanel g={g} shopId={shop.id} onAdded={onAdded} onClose={() => mng.setManageOpen(false)} />
      )}
      <HudDock g={g} active="map" onMap={() => g.go('world')} onQuest={() => g.openWorldPanel('quests')} onCart={() => g.openWorldPanel('cart')} />
    </div>
  );
}

function StoreLite({ g }: { g: Game }) {
  const shop = VEYRA.SHOPS.find((s) => s.id === (g.params.shop || 'aria'))!;
  const npc = VEYRA.NPCS[shop.npc];
  const products = VEYRA.PRODUCTS.filter((p) => p.shop === shop.id);
  const seed = products.length ? products : VEYRA.PRODUCTS.slice(0, 4);

  const mng = useShopManage(g, shop.id, seed);
  const items = mng.products;

  return (
    <div className="v-screen v-store">
      <div className="v-store-bg" style={{ '--pod-hue': shop.hue } as CSSVars} />
      <div className="v-store-floor" />

      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('world')} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        {mng.ownsShop && (
          <button className="v-iconbtn-d" onClick={() => mng.setManageOpen(true)} aria-label={g.t('manageShop')} title={g.t('manageShop')}>
            <Ic name="bag" />
          </button>
        )}
        <button className="v-iconbtn-d" onClick={() => g.go('cart')} aria-label={g.t('aCart')}>
          <Ic name="cart" />{g.cartCount > 0 && <span className="v-dot">{g.cartCount}</span>}
        </button>
      </div>

      <div className="v-store-stage">
        <ScenePlaceholder label={g.t('dropScene')} hue={shop.hue} h={150} icon="bag" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
        <div className="v-npc">
          <Avatar hue={npc.hue} size={92} ring />
          <Glass dark className="v-npc-bubble">
            <div className="v-npc-name">{npc.name} <span className="v-mono v-npc-role">{VEYRA.tx(npc.role, g.lang)}</span></div>
            <div className="v-npc-hello">{VEYRA.tx(npc.hello, g.lang)}</div>
            <Btn variant="primary" size="sm" icon="chat" onClick={() => g.openNPC(shop.npc)}>{g.t('talkTo')} {npc.name}</Btn>
          </Glass>
        </div>
      </div>

      <div className="v-shelf">
        <div className="v-shelf-head">
          <Eyebrow>{g.t('shelf')}</Eyebrow>
          <span className="v-muted v-sm">{items.length} {g.t('items')}</span>
        </div>
        <div className="v-shelf-row">
          {items.map((pp) => (
            <button key={pp.id} className="v-pcard" onClick={() => g.openProduct(pp.id)}>
              <div className="v-pcard-img">
                {pp.images && pp.images.length ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pp.images[0]} alt="" style={{ display: 'block', width: '100%', height: 138, objectFit: 'cover', borderRadius: 'calc(var(--radius) - 8px)' }} />
                ) : (
                  <ScenePlaceholder label={g.t('dropProduct')} hue={shop.hue} h={138} icon="hanger" style={{ borderRadius: 'calc(var(--radius) - 8px)' }} />
                )}
                {pp.tag && <span className="v-pcard-tag">{VEYRA.tx(pp.tag, g.lang)}</span>}
              </div>
              <div className="v-pcard-name">{VEYRA.tx(pp.name, g.lang)}</div>
              <div className="v-pcard-foot">
                <b className="v-price">{VEYRA.money(pp.price)}</b>
                <Stars value={pp.rating} lang={g.lang} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {mng.manageOpen && (
        <ManagePanel g={g} shopId={shop.id} onAdded={mng.addProduct} onClose={() => mng.setManageOpen(false)} />
      )}

      <HudDock g={g} active="map" onMap={() => g.go('world')} />
    </div>
  );
}

/** Resolve a product from the live list, falling back to the static catalog. */
function findProduct(list: Product[], id: string): Product | undefined {
  return list.find((x) => x.id === id) || VEYRA.productById(id);
}
