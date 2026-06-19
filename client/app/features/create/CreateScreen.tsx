import React from 'react';
import { Ic, Btn, Avatar } from '../../components/ui';
import { GATE_HUES, GATE_STYLES } from '../gate/GuardDialogue';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

const HUES = GATE_HUES;

export function CreateScreen({ g }: { g: Game }) {
  const [name, setName] = React.useState(g.player.name);
  const [hue, setHue] = React.useState(g.player.hue);
  const [style, setStyle] = React.useState('minimal');

  return (
    <div className="v-screen v-create">
      <div className="v-splash-sky" />
      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('splash')}><Ic name="chevL" /></button>
        <span className="v-topbar-title">{g.t('createChar')}</span>
        <span style={{ width: 40 }} />
      </div>

      <div className="v-create-stage">
        <div className="v-avatar-pedestal">
          <Avatar hue={hue} size={150} ring />
        </div>
        <div className="v-mono v-create-hint">{g.t('dropScene')}</div>
      </div>

      <div className="v-create-sheet">
        <label className="v-field">
          <span className="v-field-label">{g.t('yourName')}</span>
          <input className="v-input" value={name} maxLength={16}
                 onChange={(e) => setName(e.target.value)} placeholder="Mira, Khue, ..." />
        </label>

        <div className="v-field">
          <span className="v-field-label">{g.t('vibe')}</span>
          <div className="v-swatches">
            {HUES.map((h) => (
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

        <Btn variant="primary" size="lg" full icon="spark"
             onClick={() => { g.setPlayer({ name: name.trim() || 'Veyra', hue }); g.go('world'); }}>
          {g.t('start')}
        </Btn>
      </div>
    </div>
  );
}
