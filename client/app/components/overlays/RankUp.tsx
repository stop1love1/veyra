import { VEYRA } from '../../data';
import { RANKS } from '../../lib/game/renown';
import { RANK_BEATS } from '../../data/story';
import { Ic } from '../ui';
import type { Game } from '../../lib/game/types';

// One-shot celebration when the player climbs to a new rank.
export function RankUp({ g }: { g: Game }) {
  const idx = g.rankUp;
  if (idx == null) return null;
  const rank = RANKS.find((r) => r.index === idx);
  const beat = RANK_BEATS[idx];
  return (
    <div className="v-rankup" role="dialog" aria-modal="true" onClick={g.dismissRankUp}>
      <div className="v-rankup-card" onClick={(e) => e.stopPropagation()}>
        <Ic name="spark" size={32} />
        <div className="v-rankup-rank">{rank ? VEYRA.tx(rank.name, g.lang) : ''}</div>
        {beat && <div className="v-rankup-beat">{VEYRA.tx(beat, g.lang)}</div>}
        <button className="v-quest-claim is-on" onClick={g.dismissRankUp}>{g.t('continue')}</button>
      </div>
    </div>
  );
}
