import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Glass, Btn, Avatar, Stars, Eyebrow, ScenePlaceholder } from '../../components/ui';
import { HudDock } from '../../components/hud';
import { createVeyraStore } from '../../lib/three/store';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

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
  const api = React.useRef<{ dispose: () => void } | null>(null);
  const [near, setNear] = React.useState<StoreProximity | null>(null);
  const [ready, setReady] = React.useState(false);
  const shop = VEYRA.SHOPS.find((s) => s.id === (g.params.shop || 'aria'))!;
  const npc = VEYRA.NPCS[shop.npc];
  const productList = VEYRA.PRODUCTS.filter((p) => p.shop === shop.id);
  const items = productList.length ? productList : VEYRA.PRODUCTS.slice(0, 6);

  React.useEffect(() => {
    let cancelled = false;
    function start() {
      if (cancelled || !ref.current || api.current) return;
      setReady(true);
      api.current = createVeyraStore(ref.current, {
        shopHue: shop.hue, lang: g.lang,
        labels: { advisor: g.t('staff') },
        look: { hue: g.player.hue, skin: g.player.skin != null ? g.player.skin : 1, style: g.player.style || 'minimal' },
        npc: { name: npc.name, hue: npc.hue },
        products: items.map((p) => ({ id: p.id, name: VEYRA.tx(p.name, g.lang), price: VEYRA.money(p.price), color: p.colors[0] })),
        onProximity: (s: StoreProximity | null) => setNear(s),
      });
    }
    start();
    return () => { cancelled = true; if (api.current) { api.current.dispose(); api.current = null; } };
  }, [shop.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const vi = g.lang === 'vi';
  let prompt: EnterPrompt | null = null;
  if (near) {
    if (near.type === 'exit') prompt = { sub: vi ? 'Cửa ra' : 'Exit', title: vi ? 'Ra quảng trường' : 'Back to plaza', cta: vi ? 'Ra' : 'Leave', act: () => g.go('world') };
    else if (near.type === 'npc') prompt = { sub: VEYRA.tx(npc.role, g.lang), title: npc.name, cta: g.t('talkTo'), act: () => g.openNPC(shop.npc) };
    else { const p = near.id ? VEYRA.productById(near.id) : undefined; prompt = { sub: g.t('shelf'), title: p ? VEYRA.tx(p.name, g.lang) : '', cta: vi ? 'Xem' : 'View', act: () => near.id && g.openProduct(near.id) }; }
  }

  return (
    <div className="v-screen v-world3d">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading v-mono">loading…</div>}
      <div className="v-topbar">
        <button className="v-iconbtn-d" onClick={() => g.go('world')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        <button className="v-iconbtn-d" onClick={() => g.openWorldPanel('cart')}>
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
        <button className="v-iconbtn-d" onClick={() => g.go('world')}><Ic name="chevL" /></button>
        <div className="v-topbar-shop">
          <div className="v-topbar-title">{VEYRA.tx(shop.name, g.lang)}</div>
          <div className="v-mono v-topbar-sub">{VEYRA.tx(shop.cat, g.lang)}</div>
        </div>
        <button className="v-iconbtn-d" onClick={() => g.go('cart')}>
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
