import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Btn, ScenePlaceholder } from '../../components/ui';
import type { ScreenProps } from '../../lib/game/types';

export function CartScreen({ g, embed }: ScreenProps) {
  const lines = g.cart;
  const sub = g.cartTotal;
  const body = lines.length === 0 ? (
    <div className="v-empty">
      <div className="v-empty-ic"><Ic name="cart" size={34} /></div>
      <div className="v-empty-title">{g.t('emptyCart')}</div>
      <div className="v-muted">{g.t('emptyCartSub')}</div>
      <Btn variant="primary" size="lg" icon="map" onClick={() => (embed ? g.closeWorldPanel() : g.go('world'))}>{g.t('backToWorld')}</Btn>
    </div>
  ) : (
    <React.Fragment>
      <div className="v-cart-list">
        {lines.map((ln, i) => {
          const p = VEYRA.productById(ln.id)!;
          return (
            <div key={i} className="v-cart-item">
              <div className="v-cart-thumb"><ScenePlaceholder label="" hue={184} h={76} icon="hanger" style={{ borderRadius: 14 }} /></div>
              <div className="v-cart-mid">
                <div className="v-cart-name">{VEYRA.tx(p.name, g.lang)}</div>
                <div className="v-mono v-cart-opt">{ln.size} · <span className="v-cart-color" style={{ background: p.colors[ln.color] }} /></div>
                <b className="v-price">{VEYRA.money(p.price)}</b>
              </div>
              <div className="v-cart-right">
                <button className="v-cart-del" onClick={() => g.removeItem(i)}><Ic name="close" size={16} /></button>
                <div className="v-qty v-qty-sm">
                  <button onClick={() => g.setQty(i, ln.qty - 1)}><Ic name="minus" size={14} /></button>
                  <b>{ln.qty}</b>
                  <button onClick={() => g.setQty(i, ln.qty + 1)}><Ic name="plus" size={14} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="v-cart-foot">
        <div className="v-sumrow"><span>{g.t('subtotal')}</span><b>{VEYRA.money(sub)}</b></div>
        <div className="v-sumrow v-muted"><span>{g.t('shipping')}</span><span>{g.t('free')}</span></div>
        <Btn variant="primary" size="lg" full icon="chevR" onClick={() => g.go('checkout')}>
          {g.t('checkout')} · {VEYRA.money(sub)}
        </Btn>
      </div>
    </React.Fragment>
  );

  if (embed) return <div className="v-embed v-embed-cart">{body}</div>;
  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('cart')}</span>
        <span style={{ width: 40 }} />
      </div>
      {body}
    </div>
  );
}
