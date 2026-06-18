import React from 'react';
import { Ic, Coin, Btn } from '../../components/ui';
import type { Game } from '../../lib/game/types';

export function SuccessScreen({ g }: { g: Game }) {
  React.useEffect(() => { g.clearCart(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="v-screen v-success">
      <div className="v-splash-sky" />
      <div className="v-splash-glow" />
      <div className="v-success-body">
        <div className="v-success-burst"><Ic name="check" size={46} /></div>
        <h2 className="v-success-title">{g.t('orderDone')}</h2>
        <p className="v-success-sub">{g.t('orderDoneSub')}</p>
        <div className="v-success-reward">
          <Coin value={120} size="sm" />
          <span className="v-reward-badge"><Ic name="shield" size={16} /> {g.lang === 'vi' ? 'Người mua mới' : 'First buyer'}</span>
        </div>
      </div>
      <div className="v-splash-actions">
        <Btn variant="primary" size="lg" full icon="map" onClick={() => g.go('world')}>{g.t('backToWorld')}</Btn>
        <Btn variant="ghost-d" size="lg" full icon="quest" onClick={() => g.go('quests')}>{g.t('quests')}</Btn>
      </div>
    </div>
  );
}
