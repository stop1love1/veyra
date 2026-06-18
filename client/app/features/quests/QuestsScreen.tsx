import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Coin } from '../../components/ui';
import { HudDock } from '../../components/hud';
import type { ScreenProps } from '../../lib/game/types';

export function QuestsScreen({ g, embed }: ScreenProps) {
  const [tab, setTab] = React.useState<'quests' | 'vouchers'>('quests');
  const body = (
    <React.Fragment>
      <div className="v-tabs">
        {([['quests', g.t('quests')], ['vouchers', g.t('vouchers')]] as const).map(([id, lbl]) => (
          <button key={id} className={'v-tab' + (tab === id ? ' is-on' : '')} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>

      <div className="v-quest-scroll">
        {tab === 'quests' && VEYRA.QUESTS.map((q) => {
          const full = q.prog >= q.goal;
          return (
            <div key={q.id} className="v-quest">
              <div className={'v-quest-ic' + (full ? ' is-done' : '')}><Ic name={q.daily ? 'spark' : 'quest'} size={20} /></div>
              <div className="v-quest-mid">
                <div className="v-quest-title">{VEYRA.tx(q.title, g.lang)}</div>
                <div className="v-quest-bar"><span style={{ width: (q.prog / q.goal * 100) + '%' }} /></div>
                <div className="v-mono v-quest-prog">{q.prog}/{q.goal} · {VEYRA.tx(q.reward, g.lang)}</div>
              </div>
              <button className={'v-quest-claim' + (full ? ' is-on' : '')} disabled={!full}>
                {full ? g.t('claim') : ''}
              </button>
            </div>
          );
        })}

        {tab === 'vouchers' && (
          <div className="v-vlist">
            {VEYRA.VOUCHERS.map((vc) => (
              <div key={vc.id} className="v-vcard">
                <div className="v-vcard-left"><Ic name={vc.ship ? 'truck' : 'ticket'} size={26} /></div>
                <div className="v-vcard-mid">
                  <div className="v-vcard-off">{VEYRA.tx(vc.label, g.lang)}</div>
                  <div className="v-mono v-vcard-note">{vc.id} · {VEYRA.tx(vc.note, g.lang)}</div>
                </div>
                <button className="v-vcard-use" onClick={() => (embed ? g.closeWorldPanel() : g.go('world'))}>{g.t('use')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </React.Fragment>
  );

  if (embed) return <div className="v-embed">{body}</div>;
  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('rewards')}</span>
        <Coin value={g.coins} size="sm" />
      </div>
      {body}
      <HudDock g={g} active="quest" />
    </div>
  );
}
