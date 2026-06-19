import { Ic } from '../ui';
import { QuestsScreen } from '../../features/quests/QuestsScreen';
import { CartScreen } from '../../features/cart/CartScreen';
import type { Game, WorldPanel } from '../../lib/game/types';

/** Floating quests/cart panel layered over the live 3D world. */
export function DiegeticPanel({ g, type }: { g: Game; type: WorldPanel }) {
  const meta = type === 'quests'
    ? { icon: 'quest', title: g.t('rewards'), sub: g.t('questBoardLoc') }
    : { icon: 'cart', title: g.t('cart'), sub: g.t('tradeCounterLoc') };
  return (
    <div className="v-overlay v-overlay-dgt" onClick={g.closeWorldPanel}>
      <div className="v-dgt" onClick={(e) => e.stopPropagation()}>
        <div className="v-dgt-head">
          <div className="v-dgt-badge"><Ic name={meta.icon} size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="v-dgt-title">{meta.title}</div>
            <div className="v-mono v-dgt-sub">{meta.sub}</div>
          </div>
          <button className="v-iconbtn" onClick={g.closeWorldPanel} aria-label={g.t('aClose')}><Ic name="close" size={18} /></button>
        </div>
        <div className="v-dgt-body">
          {type === 'quests' ? <QuestsScreen g={g} embed /> : <CartScreen g={g} embed />}
        </div>
      </div>
    </div>
  );
}
