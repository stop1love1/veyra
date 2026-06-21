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

  // Rank/renown/streak come from the account; refresh vouchers + referral +
  // collections on open.
  React.useEffect(() => { g.refreshProgress(); g.refreshReferral(); g.refreshCollections(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [copied, setCopied] = React.useState(false);
  const refCode = g.referral?.code || '';
  const refLink = refCode && typeof window !== 'undefined' ? `${window.location.origin}/u/${refCode}` : '';
  const shareInvite = async () => {
    if (!refLink) return;
    const text = g.lang === 'en' ? 'Join me in Veyra!' : 'Vào Veyra cùng mình nhé!';
    try {
      if (navigator.share) { await navigator.share({ title: 'Veyra', text, url: refLink }); return; }
    } catch { /* user cancelled */ }
    try { await navigator.clipboard.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
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

      {g.collections.length > 0 && (
        <React.Fragment>
          <div className="v-pp-section">{g.t('collections')}</div>
          <div className="v-coll-list">
            {g.collections.map(({ collection: c, userCollection: uc }) => {
              const n = c.productIds.length;
              const styledN = c.productIds.filter((id) => g.favorites.includes(id)).length;
              const ownedN = c.productIds.filter((id) => g.purchased.includes(id)).length;
              const styledDone = styledN >= n;
              const ownedDone = ownedN >= n;
              const tierRow = (
                label: string, count: number, done: boolean,
                claimed: boolean, tier: 'styled' | 'owned',
              ) => (
                <div className="v-coll-tier">
                  <span className="v-coll-tier-lbl">{label}</span>
                  <span className="v-mono v-coll-tier-prog">{Math.min(count, n)}/{n}</span>
                  <button
                    className={'v-quest-claim' + (done && !claimed ? ' is-on' : '')}
                    disabled={!done || claimed}
                    onClick={() => g.claimCollection(c.key, tier)}
                  >
                    {claimed ? g.t('claimed') : g.t('claim')}
                  </button>
                </div>
              );
              return (
                <div key={c.key} className="v-coll">
                  <div className="v-coll-title">{VEYRA.tx(c.title, g.lang)}</div>
                  {tierRow(g.t('styled'), styledN, styledDone, !!uc?.styledClaimed, 'styled')}
                  {tierRow(g.t('owned'), ownedN, ownedDone, !!uc?.ownedClaimed, 'owned')}
                </div>
              );
            })}
          </div>
        </React.Fragment>
      )}

      {refCode && (
        <React.Fragment>
          <div className="v-pp-section">{g.t('inviteFriends')}</div>
          <div className="v-invite">
            <div className="v-invite-sub">{g.t('inviteHint')}</div>
            <div className="v-invite-code v-mono">{refLink || refCode}</div>
            <div className="v-invite-actions">
              <button className="v-quest-claim is-on" onClick={shareInvite}>
                {copied ? g.t('copied') : g.t('share')}
              </button>
              <a className="v-invite-link" href={refLink || ('/u/' + refCode)} target="_blank" rel="noopener noreferrer">{g.t('myCard')}</a>
            </div>
            <div className="v-mono v-invite-count">{g.t('invited')}: {g.referral?.count ?? 0}</div>
          </div>
        </React.Fragment>
      )}
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
