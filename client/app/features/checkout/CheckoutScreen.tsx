import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Btn } from '../../components/ui';
import { voucherLabel, voucherDiscount } from '../../lib/voucher';
import type { Game } from '../../lib/game/types';

function PayRow({ label, sub, on }: { label: string; sub?: string; on?: boolean }) {
  return (
    <div className="v-pay">
      <span className={'v-radio' + (on ? ' is-on' : '')} />
      <span className="v-pay-label">{label}</span>
      {sub && <span className="v-mono v-pay-sub">{sub}</span>}
    </div>
  );
}

export function CheckoutScreen({ g }: { g: Game }) {
  // Only vouchers the account actually OWNS (from the API) are selectable.
  React.useEffect(() => { g.refreshProgress(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const voucher = g.usedVoucher;
  const sub = g.cartTotal;
  // The applied voucher only counts if it's one the user owns.
  const v = g.earnedVouchers.find((x) => x.code === voucher) ?? null;
  const disc = v ? voucherDiscount(v, sub) : 0;
  const total = Math.max(0, sub - disc);

  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('checkout')}</span>
        <span style={{ width: 40 }} />
      </div>

      <div className="v-checkout-scroll">
        <div className="v-co-card">
          <div className="v-co-head"><Ic name="pin" size={18} /><span>{g.t('address')}</span></div>
          <div className="v-co-line"><b>{g.player.name}</b> · 0901 234 567</div>
          <div className="v-muted v-sm">142 Lê Lợi, Quận 1, TP. Hồ Chí Minh</div>
        </div>

        <div className="v-co-card">
          <div className="v-co-head"><Ic name="ticket" size={18} /><span>{g.t('vouchers')}</span></div>
          <div className="v-vouch-row">
            {g.earnedVouchers.length === 0 && (
              <div className="v-mono v-vouch-note">{g.t('noRewards')}</div>
            )}
            {g.earnedVouchers.map((vc) => (
              <button key={vc.code}
                      className={'v-vouch' + (voucher === vc.code ? ' is-on' : '')}
                      onClick={() => g.useVoucher(vc.code)}>
                <div className="v-vouch-off">{voucherLabel(vc, g.lang)}</div>
                <div className="v-mono v-vouch-note">{vc.code}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="v-co-card">
          <div className="v-co-head"><Ic name="bolt" size={18} /><span>{g.t('payment')}</span></div>
          <PayRow label="Veyra Pay" sub="+2% xu" on />
          <PayRow label="Momo / ZaloPay" sub="" />
          <PayRow label="COD" sub={g.t('codNote')} />
        </div>

        <div className="v-co-summary">
          <div className="v-sumrow"><span>{g.t('subtotal')}</span><b>{VEYRA.money(sub)}</b></div>
          {disc > 0 && <div className="v-sumrow v-disc"><span>{g.t('discount')}</span><b>- {VEYRA.money(disc)}</b></div>}
          <div className="v-sumrow v-muted"><span>{g.t('shipping')}</span><span>{g.t('free')}</span></div>
          <div className="v-sumrow v-total"><span>{g.t('total')}</span><b>{VEYRA.money(total)}</b></div>
        </div>
      </div>

      <div className="v-cart-foot">
        <Btn variant="primary" size="lg" full icon="shield" onClick={() => g.go('success')}>
          {g.t('payNow')} · {VEYRA.money(total)}
        </Btn>
      </div>
    </div>
  );
}
