// Account / profile dialog — a centered card opened from the HUD profile chip
// (replaces navigating to the full-screen character screen). Shows the signed-in
// account, lets the player tweak their look, and sign out. Closes on backdrop
// click / Escape / ✕.
import React from 'react';
import { Ic, Btn, Avatar } from '../ui';
import { GATE_HUES, GATE_STYLES } from '../../features/gate/GuardDialogue';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

export function AccountModal({ g, onClose, onUseLocation }: { g: Game; onClose: () => void; onUseLocation?: () => void }) {
  const u = g.auth.user;
  const [name, setName] = React.useState(g.player.name);
  const [hue, setHue] = React.useState(g.player.hue);
  const [style, setStyle] = React.useState(g.player.style || 'minimal');
  const roleLabel = g.auth.isAdmin ? g.t('roleAdmin') : g.auth.isSeller ? g.t('seller') : null;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    g.setPlayer({ ...g.player, name: name.trim() || 'Veyra', hue, style });
    onClose();
  };

  return (
    <div className="v-acctm-backdrop" onClick={onClose}>
      <div className="v-acctm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={g.t('account')}>
        <button className="v-acctm-x v-iconbtn" onClick={onClose} aria-label={g.t('aClose')}>
          <Ic name="close" size={18} />
        </button>

        <div className="v-acctm-head">
          <Avatar hue={hue} size={54} ring />
          <div className="v-acctm-id">
            <span className="v-acctm-name">{u ? (u.name || u.email) : g.t('notSignedIn')}</span>
            {u && <span className="v-acctm-mail">{u.email}</span>}
            {roleLabel && <span className="v-acctm-role v-mono">{roleLabel}</span>}
          </div>
        </div>

        <div className="v-acctm-body">
          <label className="v-field">
            <span className="v-field-label">{g.t('yourName')}</span>
            <input className="v-input" value={name} maxLength={16}
                   onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="v-field">
            <span className="v-field-label">{g.t('vibe')}</span>
            <div className="v-swatches">
              {GATE_HUES.map((h) => (
                <button key={h} className={'v-swatch' + (h === hue ? ' is-on' : '')}
                        style={{ '--sw-hue': h } as CSSVars} onClick={() => setHue(h)} />
              ))}
            </div>
          </div>

          <div className="v-field">
            <span className="v-field-label">{g.t('style')}</span>
            <div className="v-seg">
              {GATE_STYLES.map((s) => (
                <button key={s.id} className={'v-seg-btn' + (s.id === style ? ' is-on' : '')}
                        onClick={() => setStyle(s.id)}>{g.t(s.key)}</button>
              ))}
            </div>
          </div>

          {/* Place the character at the device's real GPS location (one-shot). The
              browser prompts for permission on tap; close the modal so the move shows. */}
          {onUseLocation && (
            <Btn variant="soft" size="md" icon="pin" onClick={() => { onUseLocation(); onClose(); }}>
              {g.t('useMyLocation')}
            </Btn>
          )}
        </div>

        <div className="v-acctm-foot">
          {u && (
            <Btn variant="soft" size="md" icon="power"
                 onClick={() => { g.auth.logout(); g.flash(g.t('loggedOut')); onClose(); }}>
              {g.t('signOut')}
            </Btn>
          )}
          <Btn variant="primary" size="md" icon="check" onClick={save}>{g.t('save')}</Btn>
        </div>
      </div>
    </div>
  );
}
