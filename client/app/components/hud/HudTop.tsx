import { Avatar, Coin } from '../ui';
import { LangChip } from './LangChip';
import type { Game } from '../../lib/game/types';

export function HudTop({ g }: { g: Game }) {
  const u = g.auth.user;

  // Guests (not signed in) see NO account info: name / level / coins are local,
  // default values and would read as a fake account. Only the language toggle
  // shows until they pass a gate. Once signed in, the HUD reflects the real
  // account (name + role) alongside their game progress.
  if (!u) {
    return (
      <div className="v-hudtop">
        <span />
        <div className="v-hudtop-right">
          <LangChip g={g} dark inline />
        </div>
      </div>
    );
  }

  const name = u.name || u.email;
  const roleLabel = g.auth.isAdmin ? g.t('roleAdmin') : g.auth.isSeller ? g.t('seller') : null;

  return (
    <div className="v-hudtop">
      <button className="v-hud-profile" onClick={() => g.go('create')} aria-label={g.t('account')}>
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
