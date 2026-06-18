import { Avatar, Coin } from '../ui';
import { LangChip } from './LangChip';
import type { Game } from '../../lib/game/types';

export function HudTop({ g }: { g: Game }) {
  return (
    <div className="v-hudtop">
      <button className="v-hud-profile" onClick={() => g.go('create')}>
        <Avatar hue={g.player.hue} size={38} />
        <div className="v-hud-pinfo">
          <span className="v-hud-pname">{g.player.name}</span>
          <span className="v-mono v-hud-plvl">{g.t('level')} 7</span>
        </div>
      </button>
      <div className="v-hudtop-right">
        <Coin value={g.coins} />
        <LangChip g={g} dark inline />
      </div>
    </div>
  );
}
