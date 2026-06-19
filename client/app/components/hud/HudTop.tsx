import { Avatar, Coin } from '../ui';
import { LangChip } from './LangChip';
import type { Game } from '../../lib/game/types';

export function HudTop({ g }: { g: Game }) {
  // When signed in, the HUD reflects the real account (name + role); guests keep
  // the cosmetic character name. Level/XP is local game progress either way.
  const u = g.auth.user;
  const name = u ? (u.name || u.email) : g.player.name;
  const roleLabel = g.auth.isAdmin ? g.t('roleAdmin') : g.auth.isSeller ? g.t('seller') : null;

  return (
    <div className="v-hudtop">
      <button className="v-hud-profile" onClick={() => g.go('create')} aria-label={g.t('aProfile')}>
        <Avatar hue={g.player.hue} size={38} />
        <div className="v-hud-pinfo">
          <span className="v-hud-pname">{name}</span>
          <span className="v-mono v-hud-plvl">
            {roleLabel ? roleLabel + ' · ' : ''}{g.t('level')} {g.level}
          </span>
          <span className="v-hud-xp" aria-hidden="true">
            <span style={{ width: Math.round(g.levelProgress * 100) + '%' }} />
          </span>
        </div>
      </button>
      <div className="v-hudtop-right">
        <Coin value={g.coins} />
        <LangChip g={g} dark inline />
      </div>
    </div>
  );
}
