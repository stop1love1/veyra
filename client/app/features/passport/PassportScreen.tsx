import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Coin } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { voucherLabel } from '../../lib/voucher';
import type { ScreenProps } from '../../lib/game/types';
import type { Localized } from '../../data/types';

// The four identity pillars, each gated behind a rank. Surfacing the gate is
// the MVP; richer per-pillar mechanics land in a follow-up.
const PILLARS: { rank: number; icon: string; label: Localized }[] = [
  { rank: 2, icon: 'spark',  label: { vi: 'Gu thẩm mỹ', en: 'Tastemaker' } },
  { rank: 3, icon: 'map',    label: { vi: 'Công dân',   en: 'Citizen' } },
  { rank: 4, icon: 'quest',  label: { vi: 'Sưu tầm',    en: 'Collector' } },
  { rank: 5, icon: 'ticket', label: { vi: 'Nội bộ',     en: 'Insider' } },
];

const MEDALS = ['🥇', '🥈', '🥉'];

export function PassportScreen({ g, embed }: ScreenProps) {
  const { rank, renown } = g;
  const next = rank.nextThreshold;
  const [tab, setTab] = React.useState<'info' | 'board'>('info');

  // Rank/renown/streak come from the account; refresh vouchers on open.
  React.useEffect(() => { g.refreshProgress(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Lazy-load the leaderboard the first time its tab is opened.
  React.useEffect(() => { if (tab === 'board') g.refreshLeaderboard(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = (
    <React.Fragment>
      <div className="v-pp-card">
        <div className="v-pp-rank-row">
          <div className="v-pp-rank">{VEYRA.tx(rank.name, g.lang)}</div>
          <span className={'v-streakchip' + (g.streak > 0 ? ' is-on' : '')} title={g.t('streak')}>
            🔥 {g.streak}
          </span>
        </div>
        <div className="v-mono v-pp-sub">{renown} {g.t('renownUnit')}{next ? ` / ${next}` : ''}</div>
        <div className="v-quest-bar"><span style={{ width: (rank.progress * 100) + '%' }} /></div>
      </div>

      <div className="v-pp-section">{g.t('pillars')}</div>
      <div className="v-pp-pillars">
        {PILLARS.map((p) => {
          const open = rank.index >= p.rank;
          return (
            <div key={p.rank} className={'v-pp-pillar' + (open ? ' is-on' : '')}>
              <Ic name={open ? p.icon : 'lock'} size={20} />
              <span className="v-pp-pname">{VEYRA.tx(p.label, g.lang)}</span>
              <span className="v-mono v-pp-need">{open ? g.t('unlocked') : 'R' + p.rank}</span>
            </div>
          );
        })}
      </div>

      <div className="v-pp-section">{g.t('rewards')}</div>
      <div className="v-pp-rewards">
        {g.earnedVouchers.length === 0 && <div className="v-pp-empty">{g.t('noRewards')}</div>}
        {g.earnedVouchers.map((vc) => (
          <div key={vc.code} className="v-vcard is-on">
            <div className="v-vcard-left"><Ic name="ticket" size={22} /></div>
            <div className="v-vcard-mid">
              <div className="v-vcard-off">{voucherLabel(vc, g.lang)}</div>
              <div className="v-mono v-vcard-note">{vc.code}</div>
            </div>
          </div>
        ))}
      </div>
    </React.Fragment>
  );

  const lb = g.leaderboard;
  const board = (
    <div className="v-lb">
      {(!lb || lb.top.length === 0) && <div className="v-pp-empty">{g.t('noRewards')}</div>}
      {lb && lb.top.map((row) => {
        const isMe = lb.me?.position === row.position;
        return (
          <div key={row.position} className={'v-lb-row' + (isMe ? ' is-me' : '')}>
            <span className="v-lb-pos">{row.position <= 3 ? MEDALS[row.position - 1] : row.position}</span>
            <span className="v-lb-dot" style={{ background: `hsl(${row.avatarHue} 60% 55%)` }} />
            <span className="v-lb-name">{row.name}</span>
            <span className="v-mono v-lb-renown">{row.renown} {g.t('renownUnit')}</span>
          </div>
        );
      })}
      {lb?.me && lb.me.position > lb.top.length && (
        <div className="v-lb-row is-me v-lb-pinned">
          <span className="v-lb-pos">{lb.me.position}</span>
          <span className="v-lb-name">{g.t('you')}</span>
          <span className="v-mono v-lb-renown">{lb.me.renown} {g.t('renownUnit')}</span>
        </div>
      )}
    </div>
  );

  const body = (
    <div className="v-passport">
      <div className="v-tabs">
        {([['info', g.t('passport')], ['board', g.t('leaderboard')]] as const).map(([id, lbl]) => (
          <button key={id} className={'v-tab' + (tab === id ? ' is-on' : '')} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>
      {tab === 'info' ? info : board}
    </div>
  );

  if (embed) return <div className="v-embed">{body}</div>;
  return (
    <div className="v-screen v-light">
      <div className="v-topbar v-topbar-light">
        <button className="v-iconbtn" onClick={() => g.back()} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <span className="v-topbar-title-l">{g.t('passport')}</span>
        <Coin value={g.coins} size="sm" />
      </div>
      {body}
      <HudDock g={g} active="profile" />
    </div>
  );
}
