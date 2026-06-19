// The diegetic gate "ticket" (vé). The player fills it in at the gate and hands
// it to the guard, who checks it (login/register against the API). On a valid
// ticket the caller opens the gate. Inline panel — no overlay/popup. Offline-safe
// via g.auth.* (a failed check just shows the rejection line and stays put).
import React from 'react';
import { Ic, Btn } from '../../components/ui';
import type { Game } from '../../lib/game/types';

type Status = 'idle' | 'checking' | 'rejected';

export function GateTicket({ g, onValid, gate }: { g: Game; onValid: () => void; gate?: string }) {
  const t = g.t;
  const [tab, setTab] = React.useState<'login' | 'register'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [asSeller, setAsSeller] = React.useState(false);
  const [status, setStatus] = React.useState<Status>('idle');

  const canSubmit =
    status !== 'checking' && email.trim().length > 0 && password.length > 0 &&
    (tab === 'login' || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setStatus('checking');
    const ok =
      tab === 'login'
        ? await g.auth.login(email.trim(), password)
        : await g.auth.register(email.trim(), password, name.trim() || email.trim(), asSeller);
    if (ok) { setStatus('idle'); onValid(); }
    else setStatus('rejected');
  };

  const setTabSafe = (next: 'login' | 'register') => { setTab(next); setStatus('idle'); };

  return (
    <div className="v-ticket" role="dialog" aria-label={t('ticketTitle')}>
      {/* Perforated stub — reads as a real ticket, not a form card. */}
      <div className="v-ticket-stub">
        <Ic name="ticket" size={26} />
        <span className="v-mono v-ticket-stub-id">VEYRA</span>
        <span className="v-mono v-ticket-stub-sub">{t('ticketHolder')}</span>
      </div>

      <div className="v-ticket-main">
        <div className="v-ticket-guard">
          <Ic name="shield" size={15} />
          <span>{gate ? `${t('gate')} ${gate} — ${t('guardAskTicket')}` : t('guardAskTicket')}</span>
        </div>
        <div className="v-ticket-head">
          <span className="v-mono v-ticket-kicker">{t('ticketTitle')}</span>
          <div className="v-ticket-tabs">
            <button className={'v-ticket-tab' + (tab === 'login' ? ' is-on' : '')}
                    onClick={() => setTabSafe('login')}>{t('signIn')}</button>
            <button className={'v-ticket-tab' + (tab === 'register' ? ' is-on' : '')}
                    onClick={() => setTabSafe('register')}>{t('makeTicket')}</button>
          </div>
        </div>

        <label className="v-ticket-field">
          <span className="v-ticket-label">{t('email')}</span>
          <input className="v-input" type="email" autoComplete="email" value={email} autoFocus
                 onChange={(e) => setEmail(e.target.value)} />
        </label>

        {tab === 'register' && (
          <label className="v-ticket-field">
            <span className="v-ticket-label">{t('username')}</span>
            <input className="v-input" value={name} maxLength={24}
                   onChange={(e) => setName(e.target.value)} />
          </label>
        )}

        <label className="v-ticket-field">
          <span className="v-ticket-label">{t('password')}</span>
          <input className="v-input" type="password" value={password}
                 autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                 onChange={(e) => setPassword(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) submit(); }} />
        </label>

        {tab === 'register' && (
          <label className="v-ticket-seller">
            <input type="checkbox" checked={asSeller} onChange={(e) => setAsSeller(e.target.checked)} />
            {t('registerSeller')}
          </label>
        )}

        {status === 'rejected' && <p className="v-ticket-err">{t('ticketInvalid')}</p>}

        <Btn variant="primary" size="lg" full icon={status === 'checking' ? undefined : 'shield'}
             onClick={canSubmit ? submit : undefined}
             style={!canSubmit ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          {status === 'checking' ? t('ticketChecking') : t('giveTicket')}
        </Btn>
      </div>
    </div>
  );
}
