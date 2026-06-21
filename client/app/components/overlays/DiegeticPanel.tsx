import { Ic } from '../ui';
import { QuestsScreen } from '../../features/quests/QuestsScreen';
import { CartScreen } from '../../features/cart/CartScreen';
import { PassportScreen } from '../../features/passport/PassportScreen';
import type { Game, WorldPanel } from '../../lib/game/types';

const META: Record<WorldPanel, { icon: string; titleKey: string; subKey: string }> = {
  quests:   { icon: 'quest',  titleKey: 'rewards',  subKey: 'questBoardLoc' },
  cart:     { icon: 'cart',   titleKey: 'cart',     subKey: 'tradeCounterLoc' },
  passport: { icon: 'spark',  titleKey: 'passport', subKey: 'passportLoc' },
};

/** Floating glass card (quests / cart / passport) layered over the live 3D world. */
export function DiegeticPanel({ g, type }: { g: Game; type: WorldPanel }) {
  const meta = META[type];
  return (
    <div className="v-overlay v-overlay-dgt" onClick={g.closeWorldPanel}>
      <div className="v-dgt" onClick={(e) => e.stopPropagation()}>
        <div className="v-dgt-head">
          <div className="v-dgt-badge"><Ic name={meta.icon} size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="v-dgt-title">{g.t(meta.titleKey)}</div>
            <div className="v-mono v-dgt-sub">{g.t(meta.subKey)}</div>
          </div>
          <button className="v-iconbtn" onClick={g.closeWorldPanel} aria-label={g.t('aClose')}><Ic name="close" size={18} /></button>
        </div>
        <div className="v-dgt-body">
          {type === 'quests' ? <QuestsScreen g={g} embed />
            : type === 'cart' ? <CartScreen g={g} embed />
            : <PassportScreen g={g} embed />}
        </div>
      </div>
    </div>
  );
}
