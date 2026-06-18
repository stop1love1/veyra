// Encapsulates all Veyra runtime state and exposes it as the `g` context.
import React from 'react';
import { VEYRA } from '../../data';
import { detectLite } from '../theme/detect';
import i18n from '../i18n';
import type {
  Game, Player, CartLine, ScreenName, ScreenParams, WorldPanel,
} from './types';
import type { Lang } from '../../data/types';

const STORAGE_KEY = 'veyra_state';
const STATE_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 500;
const COIN_BATCH_MS = 350;

interface PersistedState {
  lang?: Lang;
  player?: Player;
  screen?: ScreenName;
  params?: ScreenParams;
  cart?: CartLine[];
  coins?: number;
}

/** Versioned load with a migration guard — old/foreign shapes are dropped. */
function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== STATE_VERSION || typeof parsed.state !== 'object') return {};
    return parsed.state as PersistedState;
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
  const [, setHist] = React.useState<{ screen: ScreenName; params: ScreenParams }[]>([]);
  const [cart, setCart] = React.useState<CartLine[]>(saved.cart || []);
  const [coins, setCoins] = React.useState<number>(saved.coins != null ? saved.coins : 1280);
  const [npcOpen, setNpc] = React.useState<string | null>(null);
  const [prodOpen, setProd] = React.useState<string | null>(null);
  const [worldPanel, setWorldPanel] = React.useState<WorldPanel | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [lite] = React.useState<boolean>(() => detectLite());

  // Refs let the action callbacks stay referentially stable (empty deps) while
  // still reading the latest values — this is what stops the render storm.
  // Keep the i18next global language in sync (for any useTranslation consumers).
  React.useEffect(() => { i18n.changeLanguage(lang); }, [lang]);

  const langRef = React.useRef(lang); langRef.current = lang;
  const screenRef = React.useRef(screen); screenRef.current = screen;
  const paramsRef = React.useRef(params); paramsRef.current = params;

  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const coinTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingCoins = React.useRef(0);

  // Debounced persist — coins update rapidly from the 3D world, so don't write
  // the full JSON on every change.
  React.useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          v: STATE_VERSION,
          state: { lang, player, screen, params, cart, coins },
        }));
      } catch { /* quota / private mode — ignore */ }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [lang, player, screen, params, cart, coins]);

  const flashMsg = React.useCallback((m: string) => {
    setFlash(m);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }, []);

  const t = React.useCallback((k: string) => VEYRA.t(k, langRef.current), []);

  const go = React.useCallback((s: ScreenName, p: ScreenParams = {}) => {
    setHist((h) => [...h, { screen: screenRef.current, params: paramsRef.current }]);
    setScreen(s);
    setParams(p);
    setNpc(null);
    setProd(null);
    setWorldPanel(null);
    document.querySelector('.v-stage-scroll')?.scrollTo(0, 0);
  }, []);

  const back = React.useCallback(() => {
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
  }, []);

  const addToCart = React.useCallback((line: CartLine) => {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === line.id && x.size === line.size && x.color === line.color);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i], qty: n[i].qty + line.qty };
        return n;
      }
      return [...c, line];
    });
    flashMsg(langRef.current === 'vi' ? 'Đã thêm vào giỏ' : 'Added to cart');
  }, [flashMsg]);

  const setQty = React.useCallback((i: number, q: number) =>
    setCart((c) => (q <= 0 ? c.filter((_, j) => j !== i) : c.map((x, j) => (j === i ? { ...x, qty: q } : x)))), []);
  const removeItem = React.useCallback((i: number) => setCart((c) => c.filter((_, j) => j !== i)), []);
  const clearCart = React.useCallback(() => setCart([]), []);

  // Coins arrive one-by-one from the 3D world; batch them into a single state
  // update + single toast instead of one per pickup.
  const addCoins = React.useCallback((n: number) => {
    pendingCoins.current += n;
    if (coinTimer.current) return;
    coinTimer.current = setTimeout(() => {
      const total = pendingCoins.current;
      pendingCoins.current = 0;
      coinTimer.current = undefined;
      setCoins((c) => c + total);
      flashMsg('+' + total + (langRef.current === 'vi' ? ' xu' : ' coins'));
    }, COIN_BATCH_MS);
  }, [flashMsg]);

  const openNPC = React.useCallback((id: string) => setNpc(id), []);
  const closeNPC = React.useCallback(() => setNpc(null), []);
  const openProduct = React.useCallback((id: string) => setProd(id), []);
  const closeProduct = React.useCallback(() => setProd(null), []);
  const openWorldPanel = React.useCallback((p: WorldPanel) => setWorldPanel(p), []);
  const closeWorldPanel = React.useCallback(() => setWorldPanel(null), []);

  React.useEffect(() => () => {
    clearTimeout(flashTimer.current);
    clearTimeout(coinTimer.current);
  }, []);

  const cartCount = React.useMemo(() => cart.reduce((a, x) => a + x.qty, 0), [cart]);
  const cartTotal = React.useMemo(
    () => cart.reduce((a, x) => a + (VEYRA.productById(x.id)?.price ?? 0) * x.qty, 0),
    [cart],
  );

  const g = React.useMemo<Game>(() => ({
    lang, setLang, t,
    player, setPlayer,
    screen, params, go, back,
    cart, addToCart, setQty, removeItem, clearCart, cartCount, cartTotal,
    coins, addCoins,
    npcOpen, openNPC, closeNPC,
    productOpen: prodOpen, openProduct, closeProduct,
    worldPanel, openWorldPanel, closeWorldPanel,
    lite, flash: flashMsg,
  }), [
    lang, player, screen, params, cart, coins, npcOpen, prodOpen, worldPanel, lite,
    cartCount, cartTotal,
    t, go, back, addToCart, setQty, removeItem, clearCart, addCoins,
    openNPC, closeNPC, openProduct, closeProduct, openWorldPanel, closeWorldPanel, flashMsg,
  ]);

  return { g, flash };
}
