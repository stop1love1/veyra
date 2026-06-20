import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Avatar, Glass, Btn, Loader } from '../../components/ui';
import { HudTop, HudDock } from '../../components/hud';
import { GateTicket } from '../gate/GateTicket';
import { createVeyraWorld } from '../../lib/three/worldHanoi';
import { createRealtime, type RealtimeClient, type LocalState } from '../../lib/net/realtime';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

interface Proximity {
  id: string;
  type?: string;
  name?: string;
}

interface GateNear {
  key: string;
  label: string;
}

interface Weather {
  tempC: number;
  label: string;
  labelEn?: string;
  icon: string;
  wind: number;
}

interface EnterPrompt {
  sub: string;
  title: string;
  cta: string;
  act: () => void;
}

export function WorldScreen({ g }: { g: Game }) {
  // Rebuild the 3D world when the player LOGS OUT, so they respawn outside the
  // fence as a guest. Login is handled imperatively at the gate (openGate), so we
  // deliberately do NOT remount on sign-in — that would skip the walk-in.
  const [epoch, setEpoch] = React.useState(0);
  const wasAuthed = React.useRef(!!g.auth.user);
  React.useEffect(() => {
    const now = !!g.auth.user;
    if (wasAuthed.current && !now) setEpoch((e) => e + 1);
    wasAuthed.current = now;
  }, [g.auth.user]);

  return g.lite ? <WorldLite g={g} /> : <World3D key={epoch} g={g} />;
}

function World3D({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const worldApi = React.useRef<{
    dispose: () => void;
    setLang?: (names: Record<string, string>) => void;
    openGate?: (key: string) => void;
    setPlayerName?: (name: string) => void;
    sit?: () => void;
    stand?: () => void;
    emote?: (name: string) => void;
    setExpression?: (name: string) => void;
    say?: (text: string) => void;
    net?: {
      snapshot: (states: unknown[]) => void;
      playerLeft: (id: string) => void;
      seatGranted: (seatId: string) => void;
      seatDenied: (seatId: string) => void;
    };
  } | null>(null);
  const rtRef = React.useRef<RealtimeClient | null>(null);
  const [near, setNear] = React.useState<Proximity | null>(null);
  const [gateNear, setGateNear] = React.useState<GateNear | null>(null);
  const [ready, setReady] = React.useState(false);
  const [weather, setWeather] = React.useState<Weather | null>(null);
  const [sitInfo, setSitInfo] = React.useState<{ seated: boolean; canSit: boolean } | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [emoteOpen, setEmoteOpen] = React.useState(false);
  const chatInputRef = React.useRef<HTMLInputElement | null>(null);
  const authed = !!g.auth.user;

  // Send the chat field's text: optimistic local bubble + broadcast, then close.
  const sendChat = React.useCallback(() => {
    const el = chatInputRef.current;
    const text = (el?.value || '').trim();
    console.log('[chat] sendChat text=', JSON.stringify(text), 'worldApi?', !!worldApi.current, 'say?', typeof worldApi.current?.say, 'rt?', !!rtRef.current);
    if (text) { rtRef.current?.sendChat(text); worldApi.current?.say?.(text); }
    if (el) el.value = '';
    setChatOpen(false);
  }, []);

  // Desktop: Enter opens the chat field (when nothing else is focused); Esc closes.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.key === 'Enter' && !chatOpen && !typing) { setChatOpen(true); }
      else if (e.key === 'Escape' && chatOpen) { setChatOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen]);

  // Focus the field when it opens.
  React.useEffect(() => { if (chatOpen) chatInputRef.current?.focus(); }, [chatOpen]);
  // A not-signed-in visitor gets a stable temporary session id (user_XXXXXXXXX),
  // shown above their head until they register/sign in.
  const guestName = React.useState(() => {
    try {
      let id = localStorage.getItem('veyra_guest_id');
      if (!id) { id = 'user_' + Date.now(); localStorage.setItem('veyra_guest_id', id); }
      return id;
    } catch { return 'user_' + Date.now(); }
  })[0];
  // Last saved world position — restored on reload for both signed-in players
  // and guests. The saved blob carries an `entered` flag so a guest who already
  // cleared a gate resumes inside the city instead of back at the gate.
  const startPos = React.useState(() => {
    try {
      const raw = localStorage.getItem('veyra_world_pos');
      const p = raw ? JSON.parse(raw) : null;
      return (p && typeof p.x === 'number' && typeof p.z === 'number') ? p : null;
    } catch { return null; }
  })[0];

  React.useEffect(() => {
    let cancelled = false;
    if (!ref.current || worldApi.current) return;
    const shops = VEYRA.SHOPS.map((s) => ({ id: s.id, hue: s.hue, name: VEYRA.tx(s.name, g.lang) }));
    // Stable multiplayer identity: the auth user id when signed in, else the
    // guest id. Name/hue float above the avatar; both guests and signed-in
    // players share the world.
    const selfId = g.auth.user ? g.auth.user.id : guestName;
    const selfName = g.auth.user ? (g.auth.user.name || g.auth.user.email) : guestName;
    worldApi.current = createVeyraWorld(ref.current, {
      playerHue: g.player.hue, playerAge: g.player.age, playerAvatarUrl: g.player.avatarUrl || '', lite: false,
      shops,
      // Whether the player starts INSIDE the fence (signed in) or outside (guest).
      authed: !!g.auth.user,
      // Username floated above the player's head (empty for guests → no tag).
      playerName: selfName,
      // Localized NPC name-tag labels.
      labels: { security: g.t('roleSecurity'), checker: g.t('roleChecker'), visitor: g.t('npcVisitor') },
      // Resume at the saved position; persist position (+ entered flag) on move.
      startPos,
      onPos: (p: { x: number; z: number; entered?: boolean }) => { try { localStorage.setItem('veyra_world_pos', JSON.stringify(p)); } catch { /* ignore */ } },
      onProximity: (s: Proximity | null) => setNear(s),
      // Guest reached a perimeter gate guard → present the ticket (or cleared it).
      onGate: (gate: GateNear | null) => setGateNear(gate),
      onWeather: (w: Weather) => { if (!cancelled) setWeather(w); },
      onReady: () => { if (!cancelled) setReady(true); },
      // ── Multiplayer wiring ──
      selfId,
      onLocalState: (s: LocalState) => rtRef.current?.sendState(s),
      onSit: (info: { seated: boolean; canSit: boolean }) => { if (!cancelled) setSitInfo(info); },
      claimSeat: (seatId: string) => rtRef.current?.claimSeat(seatId),
      releaseSeat: () => rtRef.current?.releaseSeat(),
    });

    // Realtime connection (created after the world so net.* exists for handlers).
    rtRef.current = createRealtime(
      { id: selfId, name: selfName, hue: g.player.hue, style: 'minimal', age: g.player.age ?? 24, avatarUrl: g.player.avatarUrl || '', authed: !!g.auth.user },
      {
        onSnapshot: (states) => worldApi.current?.net?.snapshot(states),
        onLeave: (id) => worldApi.current?.net?.playerLeft(id),
        onSeatGranted: (seatId) => worldApi.current?.net?.seatGranted(seatId),
        onSeatDenied: (seatId) => worldApi.current?.net?.seatDenied(seatId),
      },
    );

    return () => {
      cancelled = true;
      if (rtRef.current) { rtRef.current.dispose(); rtRef.current = null; }
      if (worldApi.current) { worldApi.current.dispose(); worldApi.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!worldApi.current?.setLang) return;
    const names: Record<string, string> = {};
    for (const s of VEYRA.SHOPS) names[s.id] = VEYRA.tx(s.name, g.lang);
    worldApi.current.setLang(names);
  }, [g.lang]);

  // Keep the floating username in sync once the player signs in at a gate.
  React.useEffect(() => {
    worldApi.current?.setPlayerName?.(g.auth.user ? (g.auth.user.name || g.auth.user.email) : guestName);
  }, [g.auth.user, guestName]);

  let prompt: EnterPrompt | null = null;
  if (near) {
    if (near.type === 'quests') prompt = { sub: g.t('questBoard'), title: g.t('quests'), cta: g.t('open'), act: () => g.openWorldPanel('quests') };
    else if (near.type === 'cart') prompt = { sub: g.t('tradeCounter'), title: g.t('cart') + (g.cartCount ? ' · ' + g.cartCount : ''), cta: g.t('open'), act: () => g.openWorldPanel('cart') };
    else prompt = { sub: g.t('tapShop'), title: near.name || '', cta: g.t('enterShop'), act: () => g.go('store', { shop: near.id }) };
  }

  return (
    <div className="v-screen v-world3d">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading"><Loader label={g.t('loadingWorld')} /></div>}
      <HudTop g={g} />
      {weather && (
        <div className="v-weather-chip" aria-label={`${weather.tempC}° ${g.lang === 'vi' ? weather.label : (weather.labelEn || weather.label)}`}>
          <Ic name={weather.icon} size={15} />
          <b>{weather.tempC}°</b>
          <span>{g.lang === 'vi' ? weather.label : (weather.labelEn || weather.label)}</span>
        </div>
      )}

      {/* Guest, roaming outside the fence: nudge them toward a gate. */}
      {!authed && !gateNear && ready && (
        <div className="v-gatehint">
          <Ic name="shield" size={15} />
          <span>{g.t('gateHintTicket')}</span>
        </div>
      )}

      {/* At a gate guard: hand over the ticket. On accept, open that gate. */}
      {!authed && gateNear && (
        <GateTicket g={g} gate={gateNear.label}
                    onValid={() => { worldApi.current?.openGate?.(gateNear.key); setGateNear(null); }} />
      )}

      {/* Shop / kiosk enter-prompt — only meaningful once inside (signed in). */}
      {authed && prompt && (
        <div className="v-enter-prompt" key={near?.id}>
          <Glass dark className="v-enter-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="v-mono v-enter-sub">{prompt.sub}</div>
              <div className="v-enter-name">{prompt.title}</div>
            </div>
            <Btn variant="primary" size="md" icon="chevR" onClick={prompt.act}>{prompt.cta}</Btn>
          </Glass>
        </div>
      )}

      {/* Bench seating prompt: sit on a nearby free bench, or stand up. Hidden
          while a shop prompt is showing to avoid overlap. */}
      {sitInfo && (sitInfo.seated || (sitInfo.canSit && !prompt)) && (
        <div className="v-enter-prompt">
          <Glass dark className="v-enter-card">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="v-mono v-enter-sub">{g.lang === 'en' ? 'Bench' : 'Ghế đá'}</div>
              <div className="v-enter-name">
                {sitInfo.seated
                  ? (g.lang === 'en' ? 'Seated' : 'Đang ngồi')
                  : (g.lang === 'en' ? 'Free seat' : 'Còn chỗ trống')}
              </div>
            </div>
            <Btn
              variant="primary" size="md"
              icon={sitInfo.seated ? 'chevU' : 'chevD'}
              onClick={() => { if (sitInfo.seated) worldApi.current?.stand?.(); else worldApi.current?.sit?.(); }}
            >
              {sitInfo.seated
                ? (g.lang === 'en' ? 'Stand' : 'Đứng dậy')
                : (g.lang === 'en' ? 'Sit' : 'Ngồi')}
            </Btn>
          </Glass>
        </div>
      )}

      {/* Chat: a button to open the field; press Enter (desktop) also opens it.
          The bubble itself floats above the avatar (rendered in the 3D world). */}
      {ready && !chatOpen && (
        <button
          type="button"
          className="v-chat-fab"
          aria-label={g.lang === 'en' ? 'Chat' : 'Trò chuyện'}
          onClick={() => setChatOpen(true)}
        >
          <Ic name="chat" size={20} />
        </button>
      )}
      {chatOpen && (
        <div className="v-chat-bar">
          <input
            ref={chatInputRef}
            className="v-chat-input"
            type="text"
            maxLength={120}
            enterKeyHint="send"
            placeholder={g.lang === 'en' ? 'Say something…' : 'Nhập tin nhắn…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
              else if (e.key === 'Escape') { e.preventDefault(); setChatOpen(false); }
            }}
            onBlur={() => setChatOpen(false)}
          />
          {/* preventDefault on mousedown keeps the input focused so onBlur
              doesn't close the bar before the click fires. */}
          <span onMouseDown={(e) => e.preventDefault()} style={{ display: 'flex' }}>
            <Btn variant="primary" size="md" icon="chevR" onClick={sendChat}>
              {g.lang === 'en' ? 'Send' : 'Gửi'}
            </Btn>
          </span>
        </div>
      )}

      {/* Emote control: a FAB that pops two quick emotes (also bound to 1 / 2). */}
      {ready && !chatOpen && (
        <div className="v-emote-wrap">
          {emoteOpen && (
            <div className="v-emote-panel">
              <span className="v-emote-panel-lbl">{g.lang === 'en' ? 'Actions' : 'Hành động'}</span>
              <div className="v-emote-grid">
                {([['wave', '👋'], ['dance', '💃'], ['bow', '🙇'], ['clap', '👏'], ['point', '👉'], ['arms-crossed', '🙅'], ['think', '🤔']] as const).map(([name, emoji]) => (
                  <button key={name} className="v-emote-cell" title={name}
                          onClick={() => { worldApi.current?.emote?.(name); setEmoteOpen(false); }}>{emoji}</button>
                ))}
              </div>
              <span className="v-emote-panel-lbl">{g.lang === 'en' ? 'Expressions' : 'Biểu cảm'}</span>
              <div className="v-emote-grid">
                {([['neutral', '😐'], ['happy', '😊'], ['surprised', '😮'], ['sad', '😢'], ['angry', '😠']] as const).map(([name, emoji]) => (
                  <button key={name} className="v-emote-cell" title={name}
                          onClick={() => { worldApi.current?.setExpression?.(name); }}>{emoji}</button>
                ))}
              </div>
            </div>
          )}
          <button
            type="button"
            className={'v-emote-fab' + (emoteOpen ? ' is-on' : '')}
            aria-label={g.lang === 'en' ? 'Emotes' : 'Biểu cảm'}
            onClick={() => setEmoteOpen((v) => !v)}
          >
            <Ic name="spark" size={20} />
          </button>
        </div>
      )}

      {/* The navigation dock is for signed-in players inside the city. */}
      {authed && (
        <HudDock g={g} active="map" onQuest={() => g.openWorldPanel('quests')} onCart={() => g.openWorldPanel('cart')} />
      )}
    </div>
  );
}

function WorldLite({ g }: { g: Game }) {
  const [sel, setSel] = React.useState<string | null>(null);
  const shop = sel ? VEYRA.SHOPS.find((s) => s.id === sel) : null;

  return (
    <div className="v-screen v-world">
      <div className="v-world-sky" />
      <div className={'v-ground' + (g.lite ? ' is-lite' : '')}>
        <div className="v-ground-grid" />
      </div>

      <HudTop g={g} />

      <div className="v-world-scene">
        {VEYRA.SHOPS.map((s) => (
          <button key={s.id}
            className={'v-pod-node' + (sel === s.id ? ' is-sel' : '') + (s.featured ? ' is-feat' : '')}
            style={{ left: s.x + '%', top: s.y + '%', '--pod-hue': s.hue } as CSSVars}
            onClick={() => setSel(s.id)}>
            {s.featured && <span className="v-pod-pin"><Ic name="pin" size={18} /></span>}
            <span className="v-pod">
              <span className="v-pod-roof" /><span className="v-pod-body" /><span className="v-pod-door" />
            </span>
            <span className="v-pod-label v-mono">{VEYRA.tx(s.name, g.lang)}</span>
            <span className="v-pod-shadow" />
          </button>
        ))}
        <div className="v-world-player" style={{ left: '50%', top: '54%' }}>
          <Avatar hue={g.player.hue} size={52} label={g.player.name} />
        </div>
      </div>

      {!sel && <div className="v-world-hint v-mono"><Ic name="pin" size={15} /> {g.t('tapShop')}</div>}

      {shop && (
        <div className="v-shopcard" key={shop.id}>
          <div className="v-shopcard-row">
            <div className="v-shopcard-badge" style={{ '--pod-hue': shop.hue } as CSSVars}><Ic name="bag" size={22} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="v-shopcard-cat v-mono">{VEYRA.tx(shop.cat, g.lang)}</div>
              <div className="v-shopcard-name">{VEYRA.tx(shop.name, g.lang)}</div>
              <div className="v-shopcard-blurb">{VEYRA.tx(shop.blurb, g.lang)}</div>
            </div>
            <button className="v-iconbtn" onClick={() => setSel(null)} aria-label={g.t('aClose')}><Ic name="close" size={18} /></button>
          </div>
          <Btn variant="primary" size="lg" full icon="chevR"
               onClick={() => g.go('store', { shop: shop.id })}>{g.t('enterShop')}</Btn>
        </div>
      )}

      <HudDock g={g} active="map" />
    </div>
  );
}
