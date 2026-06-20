import React from 'react';
import { Ic, Btn, Avatar } from '../../components/ui';
import { GATE_HUES, GATE_STYLES } from '../gate/GuardDialogue';
import { createAvatarPreview } from '../../lib/three/avatarPreview';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

const HUES = GATE_HUES;
const AGE_MIN = 6;
const AGE_MAX = 70;

export function CreateScreen({ g }: { g: Game }) {
  const [name, setName] = React.useState(g.player.name);
  const [hue, setHue] = React.useState(g.player.hue);
  const [style, setStyle] = React.useState(g.player.style || 'minimal');
  const [age, setAge] = React.useState(g.player.age ?? 24);
  const [avatarUrl, setAvatarUrl] = React.useState(g.player.avatarUrl || '');
  const [creatorOpen, setCreatorOpen] = React.useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const RPM_SUB = (process.env.NEXT_PUBLIC_RPM_SUBDOMAIN as string) || 'demo';

  // Live 3D preview: mounted once, then nudged via setAge/setHue/setStyle as the
  // controls change (no rebuild). Freed on unmount.
  const stageRef = React.useRef<HTMLDivElement>(null);
  const previewRef = React.useRef<ReturnType<typeof createAvatarPreview> | null>(null);
  React.useEffect(() => {
    if (!stageRef.current) return;
    const p = createAvatarPreview(stageRef.current, { hue, style, age });
    previewRef.current = p;
    return () => { p.dispose(); previewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => { previewRef.current?.setHue(hue); }, [hue]);
  React.useEffect(() => { previewRef.current?.setStyle(style); }, [style]);
  React.useEffect(() => { previewRef.current?.setAge(age); }, [age]);
  React.useEffect(() => { previewRef.current?.setUrl?.(avatarUrl); }, [avatarUrl]);

  // Ready Player Me creator: subscribe on frame-ready, capture the exported .glb URL.
  React.useEffect(() => {
    if (!creatorOpen) return;
    const RPM_ORIGIN = `https://${RPM_SUB}.readyplayer.me`;
    const ALLOWED = new Set([RPM_ORIGIN, 'https://readyplayer.me']);
    const parse = (d: unknown) => { try { return typeof d === 'string' ? JSON.parse(d) : d; } catch { return null; } };
    const onMsg = (e: MessageEvent) => {
      if (!ALLOWED.has(e.origin)) return;   // exact-origin match — only trust the RPM frame
      const j = parse(e.data);
      if (!j || j.source !== 'readyplayerme') return;
      if (j.eventName === 'v1.frame.ready') {
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ target: 'readyplayerme', type: 'subscribe', eventName: 'v1.**' }), RPM_ORIGIN);
      }
      if (j.eventName === 'v1.avatar.exported' && j.data?.url) {
        setAvatarUrl(j.data.url);
        setCreatorOpen(false);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [creatorOpen]);

  const ageBand = age <= 12 ? (g.lang === 'vi' ? 'Trẻ em' : 'Child')
    : age <= 19 ? (g.lang === 'vi' ? 'Thiếu niên' : 'Teen')
    : age <= 49 ? (g.lang === 'vi' ? 'Trưởng thành' : 'Adult')
    : (g.lang === 'vi' ? 'Cao tuổi' : 'Senior');

  return (
    <div className="v-screen v-create">
      <div className="v-splash-sky" />
      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('splash')}><Ic name="chevL" /></button>
        <span className="v-topbar-title">{g.t('createChar')}</span>
        <span style={{ width: 40 }} />
      </div>

      <div className="v-create-stage">
        <div className="v-avatar-pedestal v-avatar-3d" ref={stageRef} />
        <div className="v-mono v-create-hint">{g.t('dropScene')}</div>
      </div>

      <div className="v-create-sheet">
        {g.auth.user && (
          <div className="v-create-acct">
            <Avatar hue={g.player.hue} size={38} />
            <div className="v-create-acct-id">
              <span className="v-create-acct-name">{g.auth.user.name || g.auth.user.email}</span>
              <span className="v-create-acct-mail">{g.auth.user.email}</span>
            </div>
            <Btn variant="soft" size="sm" icon="power"
                 onClick={() => { g.auth.logout(); g.flash(g.t('loggedOut')); }}>{g.t('signOut')}</Btn>
          </div>
        )}

        <label className="v-field">
          <span className="v-field-label">{g.t('yourName')}</span>
          <input className="v-input" value={name} maxLength={16}
                 onChange={(e) => setName(e.target.value)} placeholder="Mira, Khue, ..." />
        </label>

        <div className="v-field">
          <span className="v-field-label">
            {g.lang === 'vi' ? 'Tuổi' : 'Age'} · <span className="v-age-val">{age}</span> · {ageBand}
          </span>
          <input className="v-age-slider" type="range" min={AGE_MIN} max={AGE_MAX} value={age}
                 onChange={(e) => setAge(Number(e.target.value))} aria-label={g.lang === 'vi' ? 'Tuổi' : 'Age'} />
        </div>

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

        <Btn variant="soft" size="md" full icon="spark" onClick={() => setCreatorOpen(true)}>
          {avatarUrl
            ? (g.lang === 'en' ? 'Edit 3D character' : 'Sửa nhân vật 3D')
            : (g.lang === 'en' ? 'Create 3D character' : 'Tạo nhân vật 3D')}
        </Btn>

        <Btn variant="primary" size="lg" full icon="spark"
             onClick={() => { g.setPlayer({ ...g.player, name: name.trim() || 'Veyra', hue, age, style, avatarUrl }); g.go('world'); }}>
          {g.t('start')}
        </Btn>
      </div>

      {creatorOpen && (
        <div className="v-rpm-overlay" onClick={() => setCreatorOpen(false)}>
          <div className="v-rpm-frame" onClick={(e) => e.stopPropagation()}>
            <button className="v-rpm-close" aria-label="Close" onClick={() => setCreatorOpen(false)}>
              <Ic name="chevD" />
            </button>
            <iframe
              ref={iframeRef}
              title="Ready Player Me"
              className="v-rpm-iframe"
              allow="camera *; microphone *; clipboard-write"
              src={`https://${RPM_SUB}.readyplayer.me/avatar?frameApi&clearCache`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
