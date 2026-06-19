// Login / Register glass sheet. Rendered globally when g.authOpen is true
// (App.tsx mounts it — feat-dashboard wires that line; this component is
// exported via the overlays barrel by base-client). Offline-safe: a failed
// login/register simply shows an inline message and the app keeps running.
import React from 'react';
import { Ic, Btn } from '../ui';
import type { Game } from '../../lib/game/types';

type Tab = 'login' | 'register';

export function AuthModal({ g }: { g: Game }) {
  const [tab, setTab] = React.useState<Tab>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [asSeller, setAsSeller] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const ok =
        tab === 'login'
          ? await g.auth.login(email.trim(), password)
          : await g.auth.register(email.trim(), password, name.trim() || email.trim(), asSeller);
      if (ok) g.closeAuth();
      else setErr(g.t('authFailed'));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy && email.trim().length > 0 && password.length > 0 &&
    (tab === 'login' || name.trim().length > 0);

  return (
    <div className="v-overlay" onClick={g.closeAuth}>
      <div className="v-sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90%' }}>
        <div className="v-sheet-grab" />
        <button className="v-sheet-close v-iconbtn" onClick={g.closeAuth} aria-label={g.t('aClose')}>
          <Ic name="close" size={18} />
        </button>

        <div className="v-tabs" style={{ paddingTop: 8 }}>
          <button className={'v-tab' + (tab === 'login' ? ' is-on' : '')} onClick={() => { setTab('login'); setErr(null); }}>
            {g.t('signIn')}
          </button>
          <button className={'v-tab' + (tab === 'register' ? ' is-on' : '')} onClick={() => { setTab('register'); setErr(null); }}>
            {g.t('signUp')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 20px 24px' }}>
          {tab === 'register' && (
            <div className="v-field">
              <span className="v-field-label">{g.t('yourName')}</span>
              <input className="v-input" value={name} autoFocus
                     onChange={(e) => setName(e.target.value)} />
            </div>
          )}

          <div className="v-field">
            <span className="v-field-label">{g.t('email')}</span>
            <input className="v-input" type="email" autoComplete="email" value={email}
                   autoFocus={tab === 'login'}
                   onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="v-field">
            <span className="v-field-label">{g.t('password')}</span>
            <input className="v-input" type="password" autoComplete="current-password" value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) submit(); }} />
          </div>

          {tab === 'register' && (
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              <input type="checkbox" checked={asSeller} onChange={(e) => setAsSeller(e.target.checked)} />
              {g.t('registerSeller')}
            </label>
          )}

          {err && (
            <p style={{ color: 'var(--danger, #e2554f)', fontSize: 14, fontWeight: 600, margin: 0 }}>{err}</p>
          )}

          <Btn variant="primary" size="lg" full
               onClick={canSubmit ? submit : undefined}
               style={!canSubmit ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
            {tab === 'login' ? g.t('signIn') : g.t('signUp')}
          </Btn>
        </div>
      </div>
    </div>
  );
}
