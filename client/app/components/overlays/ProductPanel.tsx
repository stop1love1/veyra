import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Btn, Stars, Eyebrow, ScenePlaceholder } from '../ui';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

export function ProductPanel({ g }: { g: Game }) {
  const p = VEYRA.productById(g.productOpen!)!;
  const [color, setColor] = React.useState(0);
  const [size, setSize] = React.useState(p.sizes[Math.min(1, p.sizes.length - 1)]);
  const [qty, setQty] = React.useState(1);
  const others = VEYRA.PRODUCTS.filter((x) => x.shop === p.shop && x.id !== p.id).slice(0, 4);

  const add = (buy: boolean) => {
    g.addToCart({ id: p.id, color, size, qty });
    g.closeProduct();
    if (buy) g.go('cart');
  };

  return (
    <div className="v-overlay" onClick={g.closeProduct}>
      <div className="v-sheet v-product" onClick={(e) => e.stopPropagation()}>
        <div className="v-sheet-grab" />
        <button className="v-sheet-close v-iconbtn" onClick={g.closeProduct}><Ic name="close" size={18} /></button>

        <div className="v-product-scroll">
          <div className="v-product-hero" style={{ '--pod-hue': VEYRA.SHOPS.find((s) => s.id === p.shop)?.hue || 184 } as CSSVars}>
            <ScenePlaceholder label={g.t('dropProduct')} hue={184} h={260} icon="hanger" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
            {p.tag && <span className="v-pcard-tag v-hero-tag">{VEYRA.tx(p.tag, g.lang)}</span>}
            <button className="v-hero-fav"><Ic name="heart" size={20} /></button>
          </div>

          <div className="v-product-info">
            <div className="v-product-top">
              <div>
                <h2 className="v-product-name">{VEYRA.tx(p.name, g.lang)}</h2>
                <Stars value={p.rating} sold={p.sold} lang={g.lang} />
              </div>
              <div className="v-product-price">{VEYRA.money(p.price)}</div>
            </div>

            <p className="v-product-desc">{VEYRA.tx(p.desc, g.lang)}</p>

            <div className="v-field">
              <span className="v-field-label">{g.t('color')}</span>
              <div className="v-swatches">
                {p.colors.map((c, i) => (
                  <button key={i} className={'v-swatch v-swatch-solid' + (i === color ? ' is-on' : '')}
                          style={{ background: c }} onClick={() => setColor(i)} />
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

        <div className="v-product-bar">
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
