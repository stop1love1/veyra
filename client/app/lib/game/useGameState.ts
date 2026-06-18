// Encapsulates all Veyra runtime state and exposes it as the `g` context.
import React from 'react';
import { VEYRA } from '../../data';
import { THEME_DEFAULTS } from '../theme/tokens';
import type {
  Game, Player, CartLine, ScreenName, ScreenParams, WorldPanel,
} from './types';
import type { Lang } from '../../data/types';

interface PersistedState {
  lang?: Lang;
  player?: Player;
  screen?: ScreenName;
  params?: ScreenParams;
  cart?: CartLine[];
  coins?: number;
}

function loadState(): PersistedState {
  try {
    return JSON.parse(localStorage.getItem('veyra_state') || '') || {};
  } catch {
    return {};
  }
}

export interface GameState {
  g: Game;
  /** Current transient toast message, rendered by the app shell. */
  flash: string | null;
}

export function useGameState(): GameState {
  const saved = React.useRef<PersistedState>(loadState()).current;

  const [lang, setLang] = React.useState<Lang>(saved.lang || 'vi');
  const [player, setPlayer] = React.useState<Player>(saved.player || { name: 'Veyra', hue: 184 });
  const [screen, setScreen] = React.useState<ScreenName>(saved.screen || 'gate');
  const [params, setParams] = React.useState<ScreenParams>(saved.params || {});
  const [hist, setHist] = React.useState<{ screen: ScreenName; params: ScreenParams }[]>([]);
  const [cart, setCart] = React.useState<CartLine[]>(saved.cart || []);
  const [coins, setCoins] = React.useState<number>(saved.coins != null ? saved.coins : 1280);
  const [npcOpen, setNpc] = React.useState<string | null>(null);
  const [prodOpen, setProd] = React.useState<string | null>(null);
  const [worldPanel, setWorldPanel] = React.useState<WorldPanel | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // persist
  React.useEffect(() => {
    localStorage.setItem('veyra_state', JSON.stringify({ lang, player, screen, params, cart, coins }));
  }, [lang, player, screen, params, cart, coins]);

  const flashMsg = (m: string) => {
    setFlash(m);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  };

  const go = (s: ScreenName, p: ScreenParams = {}) => {
    setHist((h) => [...h, { screen, params }]);
    setScreen(s);
    setParams(p);
    setNpc(null);
    setProd(null);
    setWorldPanel(null);
    document.querySelector('.v-stage-scroll')?.scrollTo(0, 0);
  };

  const back = () => {
    setHist((h) => {
      if (!h.length) {
        setScreen('world');
        setParams({});
        return h;
      }
      const prev = h[h.length - 1];
      setScreen(prev.screen);
      setParams(prev.params);
      return h.slice(0, -1);
    });
  };

  const addToCart = (line: CartLine) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === line.id && x.size === line.size && x.color === line.color);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i], qty: n[i].qty + line.qty };
        return n;
      }
      return [...c, line];
    });
    flashMsg(lang === 'vi' ? 'Đã thêm vào giỏ' : 'Added to cart');
  };

  const setQty = (i: number, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((_, j) => j !== i) : c.map((x, j) => (j === i ? { ...x, qty: q } : x))));
  const removeItem = (i: number) => setCart((c) => c.filter((_, j) => j !== i));
  const clearCart = () => setCart([]);

  const cartCount = cart.reduce((a, x) => a + x.qty, 0);
  const cartTotal = cart.reduce((a, x) => a + (VEYRA.productById(x.id)?.price ?? 0) * x.qty, 0);

  const addCoins = (n: number) => {
    setCoins((c) => c + n);
    flashMsg('+' + n + (lang === 'vi' ? ' xu' : ' coins'));
  };

  const g: Game = {
    lang, setLang, t: (k) => VEYRA.t(k, lang),
    player, setPlayer,
    screen, params, go, back,
    cart, addToCart, setQty, removeItem, clearCart, cartCount, cartTotal,
    coins, addCoins,
    npcOpen, openNPC: setNpc, closeNPC: () => setNpc(null),
    productOpen: prodOpen, openProduct: setProd, closeProduct: () => setProd(null),
    worldPanel, openWorldPanel: setWorldPanel, closeWorldPanel: () => setWorldPanel(null),
    lite: THEME_DEFAULTS.lite,
    flash: flashMsg,
  };

  return { g, flash };
}
