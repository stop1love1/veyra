import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Avatar, Glass, Btn, Loader } from '../../components/ui';
import { HudTop, HudDock } from '../../components/hud';
import { GateTicket } from '../gate/GateTicket';
import { createVeyraWorld } from '../../lib/three/worldHanoi';
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
  } | null>(null);
  const [near, setNear] = React.useState<Proximity | null>(null);
  const [gateNear, setGateNear] = React.useState<GateNear | null>(null);
  const [ready, setReady] = React.useState(false);
  const [weather, setWeather] = React.useState<Weather | null>(null);
  const authed = !!g.auth.user;

  React.useEffect(() => {
    let cancelled = false;
    if (!ref.current || worldApi.current) return;
    const shops = VEYRA.SHOPS.map((s) => ({ id: s.id, hue: s.hue, name: VEYRA.tx(s.name, g.lang) }));
    worldApi.current = createVeyraWorld(ref.current, {
      playerHue: g.player.hue, lite: false,
      shops,
      // Whether the player starts INSIDE the fence (signed in) or outside (guest).
      authed: !!g.auth.user,
      onProximity: (s: Proximity | null) => setNear(s),
      // Guest reached a perimeter gate guard → present the ticket (or cleared it).
      onGate: (gate: GateNear | null) => setGateNear(gate),
      onWeather: (w: Weather) => { if (!cancelled) setWeather(w); },
      onReady: () => { if (!cancelled) setReady(true); },
    });
    return () => {
      cancelled = true;
      if (worldApi.current) { worldApi.current.dispose(); worldApi.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!worldApi.current?.setLang) return;
    const names: Record<string, string> = {};
    for (const s of VEYRA.SHOPS) names[s.id] = VEYRA.tx(s.name, g.lang);
    worldApi.current.setLang(names);
  }, [g.lang]);

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
