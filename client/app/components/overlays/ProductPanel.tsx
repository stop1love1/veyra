import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Btn, Stars, Eyebrow, ScenePlaceholder } from '../ui';
import { flyToBag } from '../../lib/fx/flyToBag';
import { isInspectActive, setInspectColor, endInspect } from '../../lib/three/inspectBridge';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

export function ProductPanel({ g }: { g: Game }) {
  const p = VEYRA.productById(g.productOpen!)!;
  const [color, setColor] = React.useState(0);
  const [size, setSize] = React.useState(p.sizes[Math.min(1, p.sizes.length - 1)]);
  const [qty, setQty] = React.useState(1);
  const others = VEYRA.PRODUCTS.filter((x) => x.shop === p.shop && x.id !== p.id).slice(0, 4);
  const fav = g.isFavorite(p.id);
  const addRef = React.useRef<HTMLDivElement | null>(null);
  // On the real 3D store path the live inspected garment IS the hero, so the
  // panel becomes a translucent bottom control tray (no 2D placeholder image).
  // Lite / reduced-motion users keep the original 2D hero. Captured once via
  // useState so the dev StrictMode double-mount can't flash the 2D hero.
  const [inspect3d] = React.useState(() => isInspectActive());

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
              <ScenePlaceholder label={g.t('dropProduct')} hue={184} h={260} icon="hanger" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
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
          <Btn variant="primary" size="lg" onClick={() => add(true)}>{g.t('buyNow')}</Btn>
        </div>
      </div>
    </div>
  );
}
