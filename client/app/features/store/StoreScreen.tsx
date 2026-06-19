import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Glass, Btn, Avatar, Stars, Eyebrow, ScenePlaceholder, Loader } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { createVeyraStore } from '../../lib/three/store';
import { registerInspect } from '../../lib/three/inspectBridge';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

interface StoreApi {
  dispose: () => void;
  inspect: (id: string) => void;
  endInspect: () => void;
  setInspectColor: (hex: string) => void;
}

interface StoreProximity {
  id?: string;
  type?: string;
}

interface EnterPrompt {
  sub: string;
  title: string;
  cta: string;
  act: () => void;
}

export function StoreScreen({ g }: { g: Game }) {
  return g.lite ? <StoreLite g={g} /> : <Store3D g={g} />;
}

function Store3D({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const api = React.useRef<StoreApi | null>(null);
  const [near, setNear] = React.useState<StoreProximity | null>(null);
  const [ready, setReady] = React.useState(false);
  const shop = VEYRA.SHOPS.find((s) => s.id === (g.params.shop || 'aria'))!;
  const npc = VEYRA.NPCS[shop.npc];
  const productList = VEYRA.PRODUCTS.filter((p) => p.shop === shop.id);
  const items = productList.length ? productList : VEYRA.PRODUCTS.slice(0, 6);

  React.useEffect(() => {
    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    function start() {
      if (cancelled || !ref.current || api.current) return;
      api.current = createVeyraStore(ref.current, {
        shopHue: shop.hue, lang: g.lang,
        labels: { advisor: g.t('staff') },
        look: { hue: g.player.hue, skin: g.player.skin != null ? g.player.skin : 1, style: g.player.style || 'minimal' },
        npc: { name: npc.name, hue: npc.hue },
        products: items.map((p) => ({ id: p.id, name: VEYRA.tx(p.name, g.lang), price: VEYRA.money(p.price), color: p.colors[0] })),
        onProximity: (s: StoreProximity | null) => setNear(s),
      });
      // Register the inspect bridge for the whole 3D-store lifetime so the
      // globally-rendered ProductPanel knows (on its very first render) that it
      // is on the 3D path, and so colour swatches can retint the live garment.
      const a = api.current;
      registerInspect({
        setInspectColor: (hex: string) => a.setInspectColor(hex),
        endInspect: () => api.current?.endInspect(),
      });
      // Defer so the branded loader actually paints during shader compile.
      readyTimer = setTimeout(() => { if (!cancelled) setReady(true); }, 0);
    }
    start();
    return () => {
      cancelled = true; clearTimeout(readyTimer);
      registerInspect(null);
      if (api.current) { api.current.dispose(); api.current = null; }
    };
  }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive the tactile inspector from product open/close. Opening a product
  // dollies the store camera to its pedestal and lifts the garment onto a
  // turntable; closing tweens back to the follow camera. The colour-swatch
  // retint flows through the inspect bridge (registered here for ProductPanel).
  React.useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (g.productOpen) a.inspect(g.productOpen);
    else a.endInspect();
  }, [g.productOpen]);

  let prompt: EnterPrompt | null = null;
  if (near) {
    if (near.type === 'exit') prompt = { sub: g.t('exit'), title: g.t('backToPlaza'), cta: g.t('leave'), act: () => g.go('world') };
    else if (near.type === 'npc') prompt = { sub: VEYRA.tx(npc.role, g.lang), title: npc.name, cta: g.t('talkTo'), act: () => g.openNPC(shop.npc) };
    else { const p = near.id ? VEYRA.productById(near.id) : undefined; prompt = { sub: g.t('shelf'), title: p ? VEYRA.tx(p.name, g.lang) : '', cta: g.t('view'), act: () => near.id && g.openProduct(near.id) }; }
  }

  return (
    <div className="v-screen v-world3d">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading"><Loader label={g.t('loadingStore')} /></div>}
      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('world')} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        <button className="v-iconbtn-d" onClick={() => g.openWorldPanel('cart')} aria-label={g.t('aCart')}>
          <Ic name="cart" />{g.cartCount > 0 && <span className="v-dot">{g.cartCount}</span>}
        </button>
      </div>
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
      <HudDock g={g} active="map" onMap={() => g.go('world')} onQuest={() => g.openWorldPanel('quests')} onCart={() => g.openWorldPanel('cart')} />
    </div>
  );
}

function StoreLite({ g }: { g: Game }) {
  const shop = VEYRA.SHOPS.find((s) => s.id === (g.params.shop || 'aria'))!;
  const npc = VEYRA.NPCS[shop.npc];
  const products = VEYRA.PRODUCTS.filter((p) => p.shop === shop.id);
  const items = products.length ? products : VEYRA.PRODUCTS.slice(0, 4);

  return (
    <div className="v-screen v-store">
      <div className="v-store-bg" style={{ '--pod-hue': shop.hue } as CSSVars} />
      <div className="v-store-floor" />

      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('world')} aria-label={g.t('aBack')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        <button className="v-iconbtn-d" onClick={() => g.go('cart')} aria-label={g.t('aCart')}>
          <Ic name="cart" />{g.cartCount > 0 && <span className="v-dot">{g.cartCount}</span>}
        </button>
      </div>

      <div className="v-store-stage">
        <ScenePlaceholder label={g.t('dropScene')} hue={shop.hue} h={150} icon="bag" style={{ position: 'absolute', inset: 0, height: '100%', borderRadius: 0 }} />
        <div className="v-npc">
          <Avatar hue={npc.hue} size={92} ring />
          <Glass dark className="v-npc-bubble">
            <div className="v-npc-name">{npc.name} <span className="v-mono v-npc-role">{VEYRA.tx(npc.role, g.lang)}</span></div>
            <div className="v-npc-hello">{VEYRA.tx(npc.hello, g.lang)}</div>
            <Btn variant="primary" size="sm" icon="chat" onClick={() => g.openNPC(shop.npc)}>{g.t('talkTo')} {npc.name}</Btn>
          </Glass>
        </div>
      </div>

      <div className="v-shelf">
        <div className="v-shelf-head">
          <Eyebrow>{g.t('shelf')}</Eyebrow>
          <span className="v-muted v-sm">{items.length} {g.t('items')}</span>
        </div>
        <div className="v-shelf-row">
          {items.map((pp) => (
            <button key={pp.id} className="v-pcard" onClick={() => g.openProduct(pp.id)}>
              <div className="v-pcard-img">
                <ScenePlaceholder label={g.t('dropProduct')} hue={shop.hue} h={138} icon="hanger" style={{ borderRadius: 'calc(var(--radius) - 8px)' }} />
                {pp.tag && <span className="v-pcard-tag">{VEYRA.tx(pp.tag, g.lang)}</span>}
              </div>
              <div className="v-pcard-name">{VEYRA.tx(pp.name, g.lang)}</div>
              <div className="v-pcard-foot">
                <b className="v-price">{VEYRA.money(pp.price)}</b>
                <Stars value={pp.rating} lang={g.lang} />
              </div>
            </button>
          ))}
        </div>
      </div>

      <HudDock g={g} active="map" onMap={() => g.go('world')} />
    </div>
  );
}
