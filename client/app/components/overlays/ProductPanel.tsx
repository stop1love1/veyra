import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Btn, Stars, Eyebrow, ScenePlaceholder } from '../ui';
import { flyToBag } from '../../lib/fx/flyToBag';
import { isInspectActive, setInspectColor, endInspect } from '../../lib/three/inspectBridge';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';
import type { Product } from '../../data/types';

// ── Live product registry ──────────────────────────────────────────────────
// ProductPanel is rendered globally, so it only knows the static catalog via
// VEYRA.productById. StoreScreen populates this registry with the *live*
// (remote-or-static, plus seller-added) product list so that seller-added
// products — which are NOT in the static catalog — still resolve here.
let activeProducts: Product[] = [];
/** StoreScreen calls this with its current product list (and [] on unmount). */
export function setActiveProducts(list: Product[]): void {
  activeProducts = Array.isArray(list) ? list : [];
}
/** Registry first (covers seller-added), then the static catalog. */
function lookupProduct(id: string): Product | undefined {
  return activeProducts.find((x) => x.id === id) || VEYRA.productById(id);
}

/** Only http(s) URLs are safe to render as a clickable href / window.open
 *  target. Rejects `javascript:`/`data:` schemes (stored-XSS defense). */
function isSafeUrl(u: string | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

/** Hero image gallery: large first image + a thumbnail strip to switch.
 *  Broken/empty URLs fall back to the neutral ScenePlaceholder, never crash.
 *  `alt` describes the product so the hero is meaningful to screen readers;
 *  thumbnails are decorative (the switch buttons carry the label). */
function ImageGallery({ images, hue, label, alt, thumbLabel }: { images: string[]; hue: number; label: string; alt: string; thumbLabel: string }) {
  const [active, setActive] = React.useState(0);
  const [broken, setBroken] = React.useState<Record<number, boolean>>({});
  const idx = Math.min(Math.max(active, 0), images.length - 1);
  const url = images[idx];
  const showPlaceholder = !url || broken[idx];
  return (
    <>
      {showPlaceholder ? (
        <ScenePlaceholder label={label} hue={hue} h={260} icon="hanger" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setBroken((b) => ({ ...b, [idx]: true }))}
        />
      )}
      {images.length > 1 && (
        <div className="v-hero-thumbs" role="tablist" aria-label={thumbLabel}
             style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 8, zIndex: 2 }}>
          {images.map((im, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              onClick={(e) => { e.stopPropagation(); setActive(i); }}
              aria-label={`${thumbLabel} ${i + 1}`}
              aria-selected={i === idx}
              style={{
                width: 44, height: 44, borderRadius: 10, overflow: 'hidden', padding: 0,
                border: i === idx ? '2px solid #fff' : '2px solid rgba(255,255,255,.45)',
                background: 'rgba(0,0,0,.25)', cursor: 'pointer',
              }}
            >
              {broken[i] ? (
                <span style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Ic name="hanger" size={16} />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={im} alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                     onError={() => setBroken((b) => ({ ...b, [i]: true }))} />
              )}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Broken-url-safe thumbnail used in the 3D inspect tray strip: shows the
 *  image, or a neutral hanger icon when the URL is empty/fails to load. */
function TrayThumb({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = React.useState(false);
  if (!src || broken) {
    return (
      <span aria-hidden="true" style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)' }}>
        <Ic name="hanger" size={20} />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setBroken(true)} />;
}

export function ProductPanel({ g }: { g: Game }) {
  // Snapshot the looked-up product ONCE for this keyed instance. The panel is
  // keyed by g.productOpen (App shell), so the snapshot is stable for its
  // lifetime. Snapshotting (vs. re-running lookupProduct every render) means a
  // registry clear — e.g. navigating away from the store unmounts StoreScreen
  // and resets the module-global activeProducts to [] — can't yank a
  // seller-added product out from under an already-open panel and auto-close it.
  const [p] = React.useState(() => lookupProduct(g.productOpen!));
  // Hooks run unconditionally (the panel is keyed by g.productOpen, so a given
  // instance always sees the same snapshot and a stable hook order). When the id
  // resolves to nothing (deleted/stale id) we render nothing and close in an
  // effect rather than dereferencing p.sizes/p.colors and crashing the overlay.
  const missing = !p;
  const [color, setColor] = React.useState(0);
  const [size, setSize] = React.useState(() => (p ? p.sizes[Math.min(1, p.sizes.length - 1)] : ''));
  const [qty, setQty] = React.useState(1);
  // Prefer the live registry (covers seller-added shops) and fall back to the
  // static catalog when the registry is empty (e.g. cold global render).
  const pool = activeProducts.length ? activeProducts : VEYRA.PRODUCTS;
  const others = p ? pool.filter((x) => x.shop === p.shop && x.id !== p.id).slice(0, 4) : [];
  const images = p && p.images && p.images.length ? p.images : [];
  const fav = p ? g.isFavorite(p.id) : false;
  const addRef = React.useRef<HTMLDivElement | null>(null);
  // On the real 3D store path the live inspected garment IS the hero, so the
  // panel becomes a translucent bottom control tray (no 2D placeholder image).
  // Lite / reduced-motion users keep the original 2D hero. Captured once via
  // useState so the dev StrictMode double-mount can't flash the 2D hero.
  const [inspect3d] = React.useState(() => isInspectActive());

  // Unresolvable id (deleted/stale) → close once, render nothing. Effect runs
  // after hooks so hook order stays stable for this keyed instance.
  React.useEffect(() => {
    if (missing) g.closeProduct();
  }, [missing, g]);
  if (!p) return null;

  const pickColor = (i: number) => {
    setColor(i);
    if (inspect3d) setInspectColor(p.colors[i]); // retint the live 3D garment
  };

  const add = (buy: boolean) => {
    g.addToCart({ id: p.id, color, size, qty });
    if (!buy) flyToBag(addRef.current);
    g.closeProduct();
    if (buy) {
      // Start the engine's tween-out before the store unmounts, rather than
      // relying on the [g.productOpen] effect racing with route cleanup.
      if (inspect3d) endInspect();
      g.go('cart');
    }
  };

  return (
    <div className={'v-overlay' + (inspect3d ? ' v-overlay-inspect' : '')} onClick={g.closeProduct}>
      <div className={'v-sheet v-product' + (inspect3d ? ' v-product-tray' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="v-sheet-grab" />
        <button className="v-sheet-close v-iconbtn" onClick={g.closeProduct} aria-label={g.t('aClose')}><Ic name="close" size={18} /></button>

        <div className="v-product-scroll">
          {/* 2D placeholder hero only on the lite / fallback path — on the 3D
              store the inspected garment behind the tray is the hero. */}
          {!inspect3d && (
            <div className="v-product-hero" style={{ '--pod-hue': VEYRA.SHOPS.find((s) => s.id === p.shop)?.hue || 184 } as CSSVars}>
              {/* Seller image gallery when present; otherwise the 2D placeholder. */}
              {images.length ? (
                <ImageGallery images={images} hue={VEYRA.SHOPS.find((s) => s.id === p.shop)?.hue || 184} label={g.t('dropProduct')} alt={VEYRA.tx(p.name, g.lang)} thumbLabel={g.t('viewImage')} />
              ) : (
                <ScenePlaceholder label={g.t('dropProduct')} hue={184} h={260} icon="hanger" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
              )}
              {p.tag && <span className="v-pcard-tag v-hero-tag">{VEYRA.tx(p.tag, g.lang)}</span>}
              <button
                className={'v-hero-fav' + (fav ? ' is-on' : '')}
                onClick={() => g.toggleFavorite(p.id)}
                aria-label={g.t('aFav')}
                aria-pressed={fav}
              >
                <Ic name={fav ? 'heartFill' : 'heart'} size={20} />
              </button>
            </div>
          )}

          <div className="v-product-info">
            <div className="v-product-top">
              <div>
                <h2 className="v-product-name">{VEYRA.tx(p.name, g.lang)}</h2>
                <Stars value={p.rating} sold={p.sold} lang={g.lang} />
              </div>
              <div className="v-product-price">{VEYRA.money(p.price)}</div>
              {/* The hero (with its fav button) is hidden on the 3D path, so the
                  favorite control moves into the header tray here. */}
              {inspect3d && (
                <button
                  className={'v-tray-fav' + (fav ? ' is-on' : '')}
                  onClick={() => g.toggleFavorite(p.id)}
                  aria-label={g.t('aFav')}
                  aria-pressed={fav}
                >
                  <Ic name={fav ? 'heartFill' : 'heart'} size={20} />
                </button>
              )}
            </div>

            <p className="v-product-desc">{VEYRA.tx(p.desc, g.lang)}</p>

            {/* On the 3D inspect path the garment stays the hero, but a small
                image strip surfaces any seller-supplied photos in the tray. */}
            {inspect3d && images.length > 0 && (
              <div className="v-tray-imgstrip" role="list" aria-label={g.t('viewImage')}
                   style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
                {images.map((im, i) => {
                  const box: React.CSSProperties = { flex: '0 0 auto', width: 72, height: 72, borderRadius: 12, overflow: 'hidden', border: '1.5px solid var(--line)', background: 'var(--paper-2)' };
                  const label = `${g.t('viewImage')} ${i + 1}`;
                  const thumb = <TrayThumb src={im} alt={VEYRA.tx(p.name, g.lang)} />;
                  // Only http(s) URLs become a clickable href — a `javascript:`
                  // scheme would execute in the app origin on click (stored XSS).
                  return isSafeUrl(im) ? (
                    <a key={i} href={im} target="_blank" rel="noopener noreferrer" role="listitem" aria-label={label} style={box}>{thumb}</a>
                  ) : (
                    <div key={i} role="listitem" style={box}>{thumb}</div>
                  );
                })}
              </div>
            )}

            <div className="v-field">
              <span className="v-field-label">{g.t('color')}</span>
              <div className="v-swatches">
                {p.colors.map((c, i) => (
                  <button key={i} className={'v-swatch v-swatch-solid' + (i === color ? ' is-on' : '')}
                          style={{ background: c }} onClick={() => pickColor(i)} />
                ))}
              </div>
            </div>

            <div className="v-field">
              <span className="v-field-label">{g.t('size')}</span>
              <div className="v-seg v-seg-wrap">
                {p.sizes.map((s) => (
                  <button key={s} className={'v-seg-btn' + (s === size ? ' is-on' : '')} onClick={() => setSize(s)}>{s}</button>
                ))}
              </div>
            </div>

            <div className="v-mixmatch">
              <Eyebrow>{g.t('mixMatch')} · {g.t('recommended')}</Eyebrow>
              <div className="v-mix-row">
                {others.map((o) => (
                  <button key={o.id} className="v-mini" onClick={() => g.openProduct(o.id)}>
                    <ScenePlaceholder label="" hue={184} h={74} icon="hanger" style={{ borderRadius: 12 }} />
                    <span className="v-mini-name">{VEYRA.tx(o.name, g.lang)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="v-product-bar" ref={addRef}>
          <div className="v-qty">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))}><Ic name="minus" size={16} /></button>
            <b>{qty}</b>
            <button onClick={() => setQty((q) => q + 1)}><Ic name="plus" size={16} /></button>
          </div>
          <Btn variant="soft" size="lg" icon="cart" onClick={() => add(false)}>{g.t('addCart')}</Btn>
          {isSafeUrl(p.link) ? (
            // Only http(s) links open externally; an unsafe scheme (javascript:/
            // data:) would run in the app origin via window.open, so it falls
            // through to the in-app Buy now path below.
            <Btn variant="primary" size="lg" icon="globe"
                 onClick={() => window.open(p.link, '_blank', 'noopener,noreferrer')}>
              {g.t('buyExternal')}
            </Btn>
          ) : (
            <Btn variant="primary" size="lg" onClick={() => add(true)}>{g.t('buyNow')}</Btn>
          )}
        </div>
      </div>
    </div>
  );
}
