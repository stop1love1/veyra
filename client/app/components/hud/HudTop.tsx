import { useState } from 'react';
import { VEYRA } from '../../data';
import { Avatar, Coin, Ic } from '../ui';
import { LangChip } from './LangChip';
import { AccountModal } from '../auth/AccountModal';
import type { Game } from '../../lib/game/types';

// Optional dev/admin teleport-map trigger, rendered to the right of the avatar.
function MapBtn({ onMap, label }: { onMap: () => void; label: string }) {
  return (
    <button type="button" className="v-hud-mapbtn" onClick={onMap} aria-label={label} title={label}>
      <Ic name="map" size={18} />
    </button>
  );
}

export function HudTop({ g, onMap, onUseLocation }: { g: Game; onMap?: () => void; onUseLocation?: () => void }) {
  const [acct, setAcct] = useState(false);
  const u = g.auth.user;
  const mapLabel = g.lang === 'en' ? 'Teleport map' : 'Bản đồ dịch chuyển';

  // Guests (not signed in) see NO account info: name / level / coins are local,
  // default values and would read as a fake account. Only the language toggle
  // shows until they pass a gate. Once signed in, the HUD reflects the real
  // account (name + role) alongside their game progress.
  if (!u) {
    return (
      <div className="v-hudtop">
        <div className="v-hudtop-left">
          {onMap ? <MapBtn onMap={onMap} label={mapLabel} /> : <span />}
        </div>
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
      <div className="v-hudtop-left">
        {/* Tapping the profile opens a compact account dialog (not a full screen). */}
        <button className="v-hud-profile" onClick={() => setAcct(true)}
                aria-label={g.t('account')} aria-haspopup="dialog">
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
        {onMap && <MapBtn onMap={onMap} label={mapLabel} />}
      </div>
      <div className="v-hudtop-right">
        <button className="v-rankchip" onClick={() => g.openWorldPanel('passport')} title={g.t('passport')}>
          <Ic name="spark" size={13} />
          <span>{VEYRA.tx(g.rank.name, g.lang)}</span>
        </button>
        <Coin value={g.coins} />
        <LangChip g={g} dark inline />
      </div>
      {acct && <AccountModal g={g} onClose={() => setAcct(false)} onUseLocation={onUseLocation} />}
    </div>
  );
}
