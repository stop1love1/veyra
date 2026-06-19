import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Avatar, Glass, Btn, Loader } from '../../components/ui';
import { HudTop, HudDock } from '../../components/hud';
import { createVeyraWorld } from '../../lib/three/worldKit';
import { createVeyraWorldFromMap } from '../../lib/three/mapLoader';
import { api } from '../../lib/api/client';
import type { ApiMap, ApiMapInstance, ApiItemDef } from '../../lib/api/client';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

/** The map slug the client requests for the main world. */
const WORLD_MAP_SLUG = 'veyra-central';

/**
 * Fetch the published map + its placed instances from the API and shape them
 * for `createVeyraWorldFromMap`. Returns null if the server is offline or the
 * payload is unusable, so the caller can fall back to the bundled world.
 */
async function loadRemoteMap(
  signal: AbortSignal,
): Promise<{ map: ApiMap; instances: ApiMapInstance[]; items: Record<string, ApiItemDef> } | null> {
  try {
    const { map } = await api.getMap(WORLD_MAP_SLUG, { signal });
    if (!map) return null;
    // instances live in their own collection (keyed by map id); tolerate either
    // an _id or id on the map doc.
    const mapId = map._id || map.id || map.slug;
    const instances = await api.getMapInstances(mapId, { signal });
    // The item dictionary may be inlined on the map payload (DESIGN §5.4); if it
    // isn't, we still proceed (instances whose GLB is unknown are skipped).
    const items = map.items || {};
    if (!instances.length && !Object.keys(items).length) return null;
    return { map, instances, items };
  } catch {
    return null;
  }
}

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
  const worldApi = React.useRef<{ dispose: () => void; setLang?: (names: Record<string, string>) => void } | null>(null);
  const [near, setNear] = React.useState<Proximity | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    // Shared options for either builder — same player/controls/coins/proximity
    // contract regardless of which world we end up with.
    const shops = VEYRA.SHOPS.map((s) => ({ id: s.id, hue: s.hue, name: VEYRA.tx(s.name, g.lang) }));
    const common = {
      playerHue: g.player.hue, lite: false,
      shops,
      onProximity: (s: Proximity | null) => setNear(s),
      onCoin: (n: number) => g.addCoins(n),
      // Keep the branded loader up until the world has finished building.
      onReady: () => { if (!cancelled) setReady(true); },
    };

    async function start() {
      if (cancelled || !ref.current || worldApi.current) return;
      // 1) TRY the data-driven world from the published map.
      const remote = await loadRemoteMap(ac.signal);
      if (cancelled || !ref.current || worldApi.current) return;
      if (remote) {
        worldApi.current = createVeyraWorldFromMap(ref.current, {
          ...common, map: remote.map, instances: remote.instances, items: remote.items,
        });
        return;
      }
      // 2) FALL BACK to the bundled, hard-coded Kenney world (server offline).
      worldApi.current = createVeyraWorld(ref.current, common);
    }
    start();
    return () => {
      cancelled = true; ac.abort();
      if (worldApi.current) { worldApi.current.dispose(); worldApi.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Relabel the in-scene shop interactables when the UI language changes, so the
  // 3D world's proximity prompt stays in sync with the rest of the app (the lite
  // path already relabels reactively on render).
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
