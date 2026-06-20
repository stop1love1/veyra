import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Coin } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { voucherLabel, isFreeShip } from '../../lib/voucher';
import type { ScreenProps } from '../../lib/game/types';
import type { ApiQuest } from '../../lib/api/client';
import type { Lang } from '../../data/types';

/** Short reward label for a quest, derived from its API reward object. */
function rewardLabel(q: ApiQuest, lang: Lang, coinUnit: string): string {
  const r = q.reward;
  if (r?.coins) return `+${r.coins} ${coinUnit}`;
  if (r?.voucherId) return 'Voucher';
  return lang === 'en' ? 'Badge' : 'Huy hiệu';
}

export function QuestsScreen({ g, embed }: ScreenProps) {
  const [tab, setTab] = React.useState<'quests' | 'vouchers'>('quests');

  // Quests + earned vouchers are server-owned — refresh on open.
  React.useEffect(() => { g.refreshProgress(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const body = (
    <React.Fragment>
      <div className="v-tabs">
        {([['quests', g.t('quests')], ['vouchers', g.t('vouchers')]] as const).map(([id, lbl]) => (
          <button key={id} className={'v-tab' + (tab === id ? ' is-on' : '')} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>

      <div className="v-quest-scroll">
        {tab === 'quests' && g.quests.length === 0 && (
          <div className="v-pp-empty">{g.t('emptyCartSub')}</div>
        )}
        {tab === 'quests' && g.quests.map(({ quest: q, userQuest }) => {
          const goal = q.goal.count;
          const prog = Math.min(userQuest?.progress ?? 0, goal);
          const full = prog >= goal;
          const claimed = !!userQuest?.claimed;
          const canClaim = full && !claimed && !q.locked;
          const renown = q.reward?.renown ?? 0;
          return (
            <div key={q._id} className={'v-quest' + (q.locked ? ' is-locked' : '')}>
              <div className={'v-quest-ic' + (full && !q.locked ? ' is-done' : '')}>
                <Ic name={q.locked ? 'lock' : q.daily ? 'spark' : 'quest'} size={20} />
              </div>
              <div className="v-quest-mid">
                <div className="v-quest-title">{VEYRA.tx(q.title, g.lang)}</div>
                <div className="v-quest-bar"><span style={{ width: Math.min(100, prog / goal * 100) + '%' }} /></div>
                <div className="v-mono v-quest-prog">
                  {prog}/{goal} · +{renown} {g.t('renownUnit')} · {rewardLabel(q, g.lang, g.t('coinUnit'))}
                </div>
              </div>
              <button
                className={'v-quest-claim' + (canClaim ? ' is-on' : '')}
                disabled={!canClaim}
                onClick={() => g.claimQuest(q._id)}
              >
                {q.locked ? g.t('comingSoon') : claimed ? g.t('claimed') : full ? g.t('claim') : ''}
              </button>
            </div>
          );
        })}

        {tab === 'vouchers' && (
          <div className="v-vlist">
            {g.earnedVouchers.length === 0 && <div className="v-pp-empty">{g.t('noRewards')}</div>}
            {g.earnedVouchers.map((vc) => {
              const applied = g.usedVoucher === vc.code;
              return (
                <div key={vc.code} className={'v-vcard' + (applied ? ' is-on' : '')}>
                  <div className="v-vcard-left"><Ic name={isFreeShip(vc) ? 'truck' : 'ticket'} size={26} /></div>
                  <div className="v-vcard-mid">
                    <div className="v-vcard-off">{voucherLabel(vc, g.lang)}</div>
                    <div className="v-mono v-vcard-note">{vc.code}</div>
                  </div>
                  <button
                    className={'v-vcard-use' + (applied ? ' is-on' : '')}
                    onClick={() => g.useVoucher(vc.code)}
                    aria-pressed={applied}
                  >
                    {applied ? g.t('voucherOn') : g.t('use')}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </React.Fragment>
  );

  if (embed) return <div className="v-embed">{body}</div>;
  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('rewards')}</span>
        <Coin value={g.coins} size="sm" />
      </div>
      {body}
      <HudDock g={g} active="quest" />
    </div>
  );
}
