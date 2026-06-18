import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Avatar, Glass, Btn } from '../../components/ui';
import { HudTop, HudDock } from '../../components/hud';
import { createVeyraWorld } from '../../lib/three/world';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

interface Proximity {
  id: string;
  type?: string;
  name?: string;
}

interface EnterPrompt {
  sub: string;
  title: string;
  cta: string;
  act: () => void;
}

export function WorldScreen({ g }: { g: Game }) {
  return g.lite ? <WorldLite g={g} /> : <World3D g={g} />;
}

function World3D({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const api = React.useRef<{ dispose: () => void } | null>(null);
  const [near, setNear] = React.useState<Proximity | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    function start() {
      if (cancelled || !ref.current || api.current) return;
      setReady(true);
      api.current = createVeyraWorld(ref.current, {
        playerHue: g.player.hue, lite: false,
        shops: VEYRA.SHOPS.map((s) => ({ id: s.id, hue: s.hue, name: VEYRA.tx(s.name, g.lang) })),
        onProximity: (s: Proximity | null) => setNear(s),
        onCoin: (n: number) => g.addCoins(n),
      });
    }
    start();
    return () => { cancelled = true; if (api.current) { api.current.dispose(); api.current = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const vi = g.lang === 'vi';
  let prompt: EnterPrompt | null = null;
  if (near) {
    if (near.type === 'quests') prompt = { sub: vi ? 'Bảng nhiệm vụ' : 'Quest board', title: g.t('quests'), cta: vi ? 'Mở' : 'Open', act: () => g.openWorldPanel('quests') };
    else if (near.type === 'cart') prompt = { sub: vi ? 'Quầy giao dịch' : 'Trade counter', title: g.t('cart') + (g.cartCount ? ' · ' + g.cartCount : ''), cta: vi ? 'Mở' : 'Open', act: () => g.openWorldPanel('cart') };
    else prompt = { sub: g.t('tapShop'), title: near.name || '', cta: g.t('enterShop'), act: () => g.go('store', { shop: near.id }) };
  }

  return (
    <div className="v-screen v-world3d">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading v-mono">loading world…</div>}
      <HudTop g={g} />
      {prompt && (
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
      <HudDock g={g} active="map" onQuest={() => g.openWorldPanel('quests')} onCart={() => g.openWorldPanel('cart')} />
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
            <button className="v-iconbtn" onClick={() => setSel(null)}><Ic name="close" size={18} /></button>
          </div>
          <Btn variant="primary" size="lg" full icon="chevR"
               onClick={() => g.go('store', { shop: shop.id })}>{g.t('enterShop')}</Btn>
        </div>
      )}

      <HudDock g={g} active="map" />
    </div>
  );
}
