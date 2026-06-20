import { Ic } from '../ui';
import type { Game } from '../../lib/game/types';

// Celebrates a daily check-in: shows the new streak length + the reward earned.
export function StreakReward({ g }: { g: Game }) {
  const r = g.streakReward;
  if (r == null) return null;
  const { coins, renown, voucherCode } = r.reward;
  return (
    <div className="v-rankup" role="dialog" aria-modal="true" onClick={g.dismissStreakReward}>
      <div className="v-rankup-card" onClick={(e) => e.stopPropagation()}>
        <div className="v-streak-flame">🔥</div>
        <div className="v-rankup-rank">{r.streak} {g.lang === 'en' ? 'day streak' : 'ngày liên tiếp'}</div>
        <div className="v-streak-rewards">
          {coins > 0 && <span><Ic name="spark" size={14} /> +{coins} {g.t('coinUnit')}</span>}
          {renown > 0 && <span><Ic name="spark" size={14} /> +{renown} {g.t('renownUnit')}</span>}
          {voucherCode && <span><Ic name="ticket" size={14} /> {voucherCode}</span>}
        </div>
        <button className="v-quest-claim is-on" onClick={g.dismissStreakReward}>{g.t('continue')}</button>
      </div>
    </div>
  );
}
