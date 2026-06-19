// Encapsulates all Veyra runtime state and exposes it as the `g` context.
import React from 'react';
import { VEYRA } from '../../data';
import { detectLite } from '../theme/detect';
import i18n from '../i18n';
import { api, setToken } from '../api/client';
import type { PublicUser } from '../api/client';
import type {
  Game, Player, CartLine, ScreenName, ScreenParams, WorldPanel, NavSignal, NavDir, AuthState,
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
  favorites?: string[];
  claimedQuests?: string[];
  usedVoucher?: string | null;
}

/** Coins required per level — level rises every COINS_PER_LEVEL coins. */
const COINS_PER_LEVEL = 500;
function deriveLevel(coins: number): { level: number; progress: number } {
  const safe = Math.max(0, coins);
  const level = Math.floor(safe / COINS_PER_LEVEL) + 1;
  const progress = (safe % COINS_PER_LEVEL) / COINS_PER_LEVEL;
  return { level, progress };
}

// Auth lives in its own localStorage keys so the token lifecycle is independent
// of the main veyra_state blob. veyra_token is owned by client.ts (setToken).
const USER_KEY = 'veyra_user';

/** Read the cached auth user (offline-safe seller affordances). */
function readUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u && typeof u === 'object' ? (u as PublicUser) : null;
  } catch {
    return null;
  }
}

/** Persist (or clear) the cached auth user. */
function persistUser(u: PublicUser | null): void {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* quota / private mode — ignore */
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem('veyra_token');
  } catch {
    return null;
  }
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
  /** Spatial-transition signal — kept out of `g` so navigation doesn't recreate
   *  the game context and re-render every screen (incl. the 3D ones). */
  nav: NavSignal;
}

export function useGameState(): GameState {
  const saved = React.useRef<PersistedState>(loadState()).current;

  const [lang, setLang] = React.useState<Lang>(saved.lang || 'vi');
  const [player, setPlayer] = React.useState<Player>(saved.player || { name: 'Veyra', hue: 184 });
  // Default landing is the world itself: unauthenticated players spawn OUTSIDE the
  // perimeter fence (see worldHanoi) and must pass a gate's ticket check to enter.
  const [screen, setScreen] = React.useState<ScreenName>(saved.screen || 'world');
  const [params, setParams] = React.useState<ScreenParams>(saved.params || {});
  // Navigation history lives in a ref (it's never rendered) so back() can read
  // the stack synchronously and keep all setState calls out of any updater.
  const histRef = React.useRef<{ screen: ScreenName; params: ScreenParams }[]>([]);
  const [cart, setCart] = React.useState<CartLine[]>(saved.cart || []);
  const [coins, setCoins] = React.useState<number>(saved.coins != null ? saved.coins : 1280);
  const [favorites, setFavorites] = React.useState<string[]>(saved.favorites || []);
  const [claimedQuests, setClaimedQuests] = React.useState<string[]>(saved.claimedQuests || []);
  const [usedVoucher, setUsedVoucher] = React.useState<string | null>(saved.usedVoucher ?? null);
  const [npcOpen, setNpc] = React.useState<string | null>(null);
  const [prodOpen, setProd] = React.useState<string | null>(null);
  const [worldPanel, setWorldPanel] = React.useState<WorldPanel | null>(null);
  const [nav, setNav] = React.useState<NavSignal>({ key: 0, dir: 'forward', from: null, to: saved.screen || 'world' });
  const [flash, setFlash] = React.useState<string | null>(null);
  const [lite] = React.useState<boolean>(() => detectLite());

  // Auth state — kept separate from the persisted veyra_state blob.
  const [authUser, setAuthUser] = React.useState<PublicUser | null>(() => readUser());
  const [authToken, setAuthToken] = React.useState<string | null>(() => readToken());
  const [authOpen, setAuthOpen] = React.useState<boolean>(false);

  // Refs let the action callbacks stay referentially stable (empty deps) while
  // still reading the latest values — this is what stops the render storm.
  // Keep the i18next global language in sync (for any useTranslation consumers).
  React.useEffect(() => { i18n.changeLanguage(lang); }, [lang]);

  const langRef = React.useRef(lang); langRef.current = lang;
  const screenRef = React.useRef(screen); screenRef.current = screen;
  const paramsRef = React.useRef(params); paramsRef.current = params;
  const favRef = React.useRef(favorites); favRef.current = favorites;
  const claimedRef = React.useRef(claimedQuests); claimedRef.current = claimedQuests;

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
          state: { lang, player, screen, params, cart, coins, favorites, claimedQuests, usedVoucher },
        }));
      } catch { /* quota / private mode — ignore */ }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [lang, player, screen, params, cart, coins, favorites, claimedQuests, usedVoucher]);

  const flashMsg = React.useCallback((m: string) => {
    setFlash(m);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  }, []);

  const t = React.useCallback((k: string) => VEYRA.t(k, langRef.current), []);

  // Single place that records a navigation so <ScreenTransition> can animate it.
  const navKey = React.useRef(0);
  const signalNav = React.useCallback((from: ScreenName | null, to: ScreenName, dir: NavDir) => {
    navKey.current += 1;
    setNav({ key: navKey.current, dir, from, to });
  }, []);

  const go = React.useCallback((s: ScreenName, p: ScreenParams = {}) => {
    const sameScreen = s === screenRef.current;
    // Only a real screen change pushes history + plays a spatial transition.
    // Same-screen nav (e.g. world→world shop switch) just updates params.
    if (!sameScreen) {
      histRef.current = [...histRef.current, { screen: screenRef.current, params: paramsRef.current }];
      signalNav(screenRef.current, s, 'forward');
    }
    setScreen(s);
    setParams(p);
    setNpc(null);
    setProd(null);
    setWorldPanel(null);
    document.querySelector('.v-stage-scroll')?.scrollTo(0, 0);
  }, [signalNav]);

  const back = React.useCallback(() => {
    // Resolve the target outside any updater (StrictMode-safe).
    const h = histRef.current;
    const prev = h.length ? h[h.length - 1] : null;
    const target: ScreenName = prev ? prev.screen : 'world';
    const targetParams: ScreenParams = prev ? prev.params : {};
    // Guard the same-screen fallback (e.g. back while already on 'world') so we
    // don't re-key ScreenTransition and remount the WebGL world. Bail before
    // mutating history.
    if (target === screenRef.current) return;
    if (prev) histRef.current = h.slice(0, -1);
    signalNav(screenRef.current, target, 'back');
    setScreen(target);
    setParams(targetParams);
    setNpc(null);
    setProd(null);
    setWorldPanel(null);
  }, [signalNav]);

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
    flashMsg(t('flashAddedCart'));
  }, [flashMsg, t]);

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
      flashMsg('+' + total + ' ' + t('coinUnit'));
    }, COIN_BATCH_MS);
  }, [flashMsg, t]);

  const toggleFavorite = React.useCallback((id: string) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }, []);
  const isFavorite = React.useCallback((id: string) => favRef.current.includes(id), []);

  // Claim a quest once: award its coin reward (if any) and mark it claimed.
  // Guarded via a ref so side effects fire exactly once (StrictMode-safe).
  const claimQuest = React.useCallback((id: string, reward: number) => {
    if (claimedRef.current.includes(id)) return;
    claimedRef.current = [...claimedRef.current, id];
    setClaimedQuests(claimedRef.current);
    if (reward > 0) {
      setCoins((v) => v + reward);
      flashMsg('+' + reward + ' ' + t('coinUnit'));
    } else {
      flashMsg(t('flashRewardGot'));
    }
  }, [flashMsg, t]);

  const voucherRef = React.useRef(usedVoucher); voucherRef.current = usedVoucher;
  const useVoucher = React.useCallback((id: string) => {
    const next = voucherRef.current === id ? null : id;
    voucherRef.current = next;
    setUsedVoucher(next);
    flashMsg(t(next ? 'voucherApplied' : 'voucherRemoved'));
  }, [flashMsg, t]);

  const openNPC = React.useCallback((id: string) => setNpc(id), []);
  const closeNPC = React.useCallback(() => setNpc(null), []);
  const openProduct = React.useCallback((id: string) => setProd(id), []);
  const closeProduct = React.useCallback(() => setProd(null), []);
  const openWorldPanel = React.useCallback((p: WorldPanel) => setWorldPanel(p), []);
  const closeWorldPanel = React.useCallback(() => setWorldPanel(null), []);

  // ── Auth (offline-safe; every api.* call is wrapped) ─────────────────────
  const openAuth = React.useCallback(() => setAuthOpen(true), []);
  const closeAuth = React.useCallback(() => setAuthOpen(false), []);

  const login = React.useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const r = await api.login({ email, password });   // persists token
      const u = r.user ?? null;
      setAuthUser(u);
      setAuthToken(readToken());
      persistUser(u);
      flashMsg(t('authWelcome'));
      return true;
    } catch {
      flashMsg(t('authFailed'));
      return false;
    }
  }, [flashMsg, t]);

  const register = React.useCallback(
    async (email: string, password: string, name: string, asSeller?: boolean): Promise<boolean> => {
      try {
        const r = await api.register({ email, password, name, role: asSeller ? 'seller' : 'user' });
        const u = r.user ?? null;
        setAuthUser(u);
        setAuthToken(readToken());
        persistUser(u);
        flashMsg(t('authWelcome'));
        return true;
      } catch {
        flashMsg(t('authFailed'));
        return false;
      }
    },
    [flashMsg, t],
  );

  const logout = React.useCallback(() => {
    setToken(null);
    persistUser(null);
    setAuthUser(null);
    setAuthToken(null);
    // Drop the player back into the world as a guest — they respawn OUTSIDE the
    // perimeter fence (WorldScreen rebuilds the scene on logout) and must pass a
    // gate's ticket check again to re-enter.
    histRef.current = [];
    signalNav(screenRef.current, 'world', 'back');
    setScreen('world');
    setParams({});
    setNpc(null);
    setProd(null);
    setWorldPanel(null);
  }, [signalNav]);

  const refresh = React.useCallback(async () => {
    if (!readToken()) return;
    try {
      const u = await api.me();
      setAuthUser(u);
      setAuthToken(readToken());
      persistUser(u);
    } catch {
      /* offline — keep the cached user so seller affordances survive */
    }
  }, []);

  // Re-hydrate the auth user once on mount when a token is present.
  React.useEffect(() => { void refresh(); }, [refresh]);

  React.useEffect(() => () => {
    clearTimeout(flashTimer.current);
    clearTimeout(coinTimer.current);
  }, []);

  const { level, progress: levelProgress } = React.useMemo(() => deriveLevel(coins), [coins]);
  const cartCount = React.useMemo(() => cart.reduce((a, x) => a + x.qty, 0), [cart]);
  const cartTotal = React.useMemo(
    () => cart.reduce((a, x) => a + (VEYRA.productById(x.id)?.price ?? 0) * x.qty, 0),
    [cart],
  );

  const role = authUser?.role ?? null;
  const isSeller = role === 'seller' || role === 'admin';
  const isAdmin = role === 'admin';
  const auth = React.useMemo<AuthState>(() => ({
    user: authUser,
    token: authToken,
    role,
    isSeller,
    isAdmin,
    login, register, logout, refresh,
  }), [authUser, authToken, role, isSeller, isAdmin, login, register, logout, refresh]);

  const g = React.useMemo<Game>(() => ({
    lang, setLang, t,
    player, setPlayer,
    screen, params, go, back,
    cart, addToCart, setQty, removeItem, clearCart, cartCount, cartTotal,
    coins, addCoins, level, levelProgress,
    favorites, isFavorite, toggleFavorite,
    claimedQuests, claimQuest,
    usedVoucher, useVoucher,
    npcOpen, openNPC, closeNPC,
    productOpen: prodOpen, openProduct, closeProduct,
    worldPanel, openWorldPanel, closeWorldPanel,
    auth, authOpen, openAuth, closeAuth,
    lite, flash: flashMsg,
  }), [
    lang, player, screen, params, cart, coins, npcOpen, prodOpen, worldPanel, lite,
    cartCount, cartTotal, level, levelProgress,
    favorites, claimedQuests, usedVoucher,
    auth, authOpen, openAuth, closeAuth,
    t, go, back, addToCart, setQty, removeItem, clearCart, addCoins,
    isFavorite, toggleFavorite, claimQuest, useVoucher,
    openNPC, closeNPC, openProduct, closeProduct, openWorldPanel, closeWorldPanel, flashMsg,
  ]);

  return { g, flash, nav };
}
