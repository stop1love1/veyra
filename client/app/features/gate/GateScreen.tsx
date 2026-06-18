import React from 'react';
import { Ic, Btn } from '../../components/ui';
import { LangChip } from '../../components/hud';
import { createVeyraGate } from '../../lib/three/gate';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

const GATE_HUES = [184, 150, 210, 250, 95, 30];
const SKIN_COLORS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];
const GATE_STYLES = [
  { id: 'minimal', vi: 'Tối giản', en: 'Minimal' },
  { id: 'street', vi: 'Đường phố', en: 'Street' },
  { id: 'soft', vi: 'Dịu dàng', en: 'Soft' },
];

interface GateApi {
  dispose: () => void;
  setLook: (look: { hue: number; skin: number; style: string }) => void;
  enter: () => void;
}

interface Look {
  name: string;
  hue: number;
  skin: number;
  style: string;
}

export function GateScreen({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const api = React.useRef<GateApi | null>(null);
  const [name, setName] = React.useState(g.player.name || 'Veyra');
  const [hue, setHue] = React.useState(g.player.hue != null ? g.player.hue : 184);
  const [skin, setSkin] = React.useState(g.player.skin != null ? g.player.skin : 1);
  const [style, setStyle] = React.useState(g.player.style || 'minimal');
  const [entering, setEntering] = React.useState(false);
  const [fade, setFade] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const lookRef = React.useRef<Look>({ name, hue, skin, style });
  lookRef.current = { name, hue, skin, style };

  React.useEffect(() => {
    let cancelled = false;
    function start() {
      if (cancelled || !ref.current || api.current) return;
      setReady(true);
      api.current = createVeyraGate(ref.current, {
        look: { hue, skin, style, name },
        onEnter: () => {
          const L = lookRef.current;
          g.setPlayer({ name: (L.name || '').trim() || 'Veyra', hue: L.hue, skin: L.skin, style: L.style });
          g.go('world');
        },
      });
    }
    start();
    return () => { cancelled = true; if (api.current) { api.current.dispose(); api.current = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (api.current) api.current.setLook({ hue, skin, style }); }, [hue, skin, style]);

  const register = () => {
    if (entering) return;
    setEntering(true);
    if (api.current) api.current.enter();
    setTimeout(() => setFade(true), 3600);
  };

  const vi = g.lang === 'vi';
  const login = () => { g.setPlayer({ name: (name || '').trim() || 'Veyra', hue, skin, style }); g.go('world'); };

  return (
    <div className="v-screen v-gate">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading v-mono">loading…</div>}

      <div className="v-gate-top">
        <span />
        <LangChip g={g} dark inline />
      </div>

      {entering && (
        <div className="v-gate-status">
          <span className="v-mono">{vi ? 'Bảo vệ đang mở cổng…' : 'The guard opens the gate…'}</span>
        </div>
      )}

      {!entering && panelOpen && (
        <div className="v-gate-panel">
          <button className="v-gate-close" onClick={() => setPanelOpen(false)} aria-label="close"><Ic name="close" size={18} /></button>
          <div>
            <div className="v-gate-title">{vi ? 'Tạo nhân vật' : 'Create your character'}</div>
            <div className="v-mono v-gate-sub">{vi ? 'Xong xuôi, bảo vệ sẽ mở cổng cho bạn' : 'When ready, the guard lets you in'}</div>
          </div>

          <label className="v-field">
            <span className="v-field-label">{g.t('yourName')}</span>
            <input className="v-input" value={name} maxLength={16}
                   onChange={(e) => setName(e.target.value)} placeholder="Mira, Khue, ..." />
          </label>

          <div className="v-gate-grid">
            <div className="v-field">
              <span className="v-field-label">{g.t('skin')}</span>
              <div className="v-swatches">
                {SKIN_COLORS.map((c, i) => (
                  <button key={i} className={'v-swatch v-swatch-solid' + (i === skin ? ' is-on' : '')}
                          style={{ background: c }} onClick={() => setSkin(i)} />
                ))}
              </div>
            </div>
            <div className="v-field">
              <span className="v-field-label">{g.t('color')}</span>
              <div className="v-swatches">
                {GATE_HUES.map((h) => (
                  <button key={h} className={'v-swatch' + (h === hue ? ' is-on' : '')}
                          style={{ '--sw-hue': h } as CSSVars} onClick={() => setHue(h)} />
                ))}
              </div>
            </div>
          </div>

          <div className="v-field">
            <span className="v-field-label">{g.t('style')}</span>
            <div className="v-seg">
              {GATE_STYLES.map((s) => (
                <button key={s.id} className={'v-seg-btn' + (s.id === style ? ' is-on' : '')}
                        onClick={() => setStyle(s.id)}>{vi ? s.vi : s.en}</button>
              ))}
            </div>
          </div>

          <Btn variant="primary" size="lg" full icon="spark" onClick={register}>
            {vi ? 'Đăng ký & vào cổng' : 'Register & enter'}
          </Btn>
          <button className="v-gate-login" onClick={login}>{vi ? 'Đã có tài khoản? Đăng nhập' : 'Have an account? Log in'}</button>
        </div>
      )}

      {!entering && !panelOpen && (
        <div className="v-gate-reopen-wrap">
          <button className="v-gate-reopen" onClick={() => setPanelOpen(true)}><Ic name="user" size={17} /> {vi ? 'Tạo nhân vật' : 'Create character'}</button>
          <button className="v-gate-reopen v-gate-reopen-2" onClick={login}><Ic name="chevR" size={17} /> {vi ? 'Đăng nhập nhanh' : 'Quick log in'}</button>
        </div>
      )}

      <div className={'v-gate-fade' + (fade ? ' is-on' : '')} />
    </div>
  );
}
