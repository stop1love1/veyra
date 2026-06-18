import { Btn, Avatar } from '../../components/ui';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

export const SKIN_COLORS = ['#f1c9a5', '#e0a878', '#c9854f', '#8d5a36'];
export const GATE_HUES = [184, 150, 210, 250, 95, 30];
export const GATE_STYLES = [
  { id: 'minimal', vi: 'Tối giản', en: 'Minimal' },
  { id: 'street', vi: 'Đường phố', en: 'Street' },
  { id: 'soft', vi: 'Dịu dàng', en: 'Soft' },
];

export interface GuardDialogueProps {
  g: Game;
  step: 'name' | 'look';
  name: string;
  setName: (v: string) => void;
  skin: number;
  setSkin: (v: number) => void;
  hue: number;
  setHue: (v: number) => void;
  style: string;
  setStyle: (v: string) => void;
  onNext: () => void;
  onConfirm: () => void;
}

/** Diegetic gatekeeper conversation — replaces the old character-creation popup. */
export function GuardDialogue(p: GuardDialogueProps) {
  const vi = p.g.lang === 'vi';
  const say = p.step === 'name'
    ? (vi ? `Dừng lại, lữ khách! Trước khi vào Veyra, cho ta biết tên ngươi.` : `Halt, traveler! Before you enter Veyra, tell me your name.`)
    : (vi ? `${p.name.trim() || 'Lữ khách'}, chỉnh lại diện mạo cho tươm tất rồi ta mở cổng.` : `${p.name.trim() || 'Traveler'}, fix up your look and I'll open the gate.`);

  return (
    <div className="v-guard">
      <div className="v-guard-head">
        <Avatar hue={200} size={42} />
        <div className="v-guard-id">
          <div className="v-guard-name">{vi ? 'Bảo vệ cổng' : 'Gatekeeper'}</div>
          <div className="v-mono v-guard-role">{vi ? 'Canh cổng Veyra' : 'Veyra gate'}</div>
        </div>
        <span className="v-mono v-guard-step">{p.step === 'name' ? '1/2' : '2/2'}</span>
      </div>

      <div className="v-guard-say">{say}</div>

      {p.step === 'name' ? (
        <>
          <input className="v-input" value={p.name} maxLength={16} autoFocus
                 placeholder={vi ? 'Tên nhân vật…' : 'Your name…'}
                 onChange={(e) => p.setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') p.onNext(); }} />
          <div className="v-guard-actions">
            <Btn variant="primary" size="lg" full icon="chevR" onClick={p.onNext}>{vi ? 'Tiếp tục' : 'Continue'}</Btn>
          </div>
        </>
      ) : (
        <>
          <div className="v-guard-grid">
            <div className="v-field">
              <span className="v-field-label">{p.g.t('skin')}</span>
              <div className="v-swatches">
                {SKIN_COLORS.map((c, i) => (
                  <button key={i} className={'v-swatch v-swatch-solid' + (i === p.skin ? ' is-on' : '')}
                          style={{ background: c }} onClick={() => p.setSkin(i)} />
                ))}
              </div>
            </div>
            <div className="v-field">
              <span className="v-field-label">{p.g.t('color')}</span>
              <div className="v-swatches">
                {GATE_HUES.map((h) => (
                  <button key={h} className={'v-swatch' + (h === p.hue ? ' is-on' : '')}
                          style={{ '--sw-hue': h } as CSSVars} onClick={() => p.setHue(h)} />
                ))}
              </div>
            </div>
          </div>
          <div className="v-field">
            <span className="v-field-label">{p.g.t('style')}</span>
            <div className="v-seg">
              {GATE_STYLES.map((s) => (
                <button key={s.id} className={'v-seg-btn' + (s.id === p.style ? ' is-on' : '')}
                        onClick={() => p.setStyle(s.id)}>{vi ? s.vi : s.en}</button>
              ))}
            </div>
          </div>
          <div className="v-guard-actions">
            <Btn variant="primary" size="lg" full icon="spark" onClick={p.onConfirm}>{vi ? 'Xong — mở cổng' : 'Done — open gate'}</Btn>
          </div>
        </>
      )}
    </div>
  );
}
