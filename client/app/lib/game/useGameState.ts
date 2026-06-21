// Encapsulates all Veyra runtime state and exposes it as the `g` context.
import React from 'react';
import { VEYRA } from '../../data';
import { detectLite } from '../theme/detect';
import i18n from '../i18n';
import { api, setToken } from '../api/client';
import type { PublicUser, ApiQuestEntry, ApiVoucher, ApiCheckinResult, ApiLeaderboard, ApiReferral, ApiCollectionEntry } from '../api/client';
import type {
  Game, Player, CartLine, ScreenName, ScreenParams, WorldPanel, NavSignal, NavDir, AuthState,
} from './types';
import type { Lang } from '../../data/types';
import { deriveRank, type RenownSource } from './renown';

const STORAGE_KEY = 'veyra_state';
const STATE_VERSION = 2;
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
  purchased?: string[];
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

// Pending referral code captured from a share link (?ref=CODE), held until the
// visitor registers. Persisted so it survives the gate/create flow.
const REF_KEY = 'veyra_ref';
function captureRefFromUrl(): void {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (code) localStorage.setItem(REF_KEY, code.trim().toUpperCase());
  } catch { /* ignore */ }
}
function readPendingRef(): string | undefined {
  try {
    return localStorage.getItem(REF_KEY) || undefined;
  } catch {
    return undefined;
  }
}
function clearPendingRef(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch { /* ignore */ }
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
  const [player, setPlayer] = React.useState<Player>(saved.player || { name: 'Veyra', hue: 184, age: 24 });
  // Default landing is the world itself: unauthenticated players spawn OUTSIDE the
  // perimeter fence (see worldHanoi) and must pass a gate's ticket check to enter.
  const [screen, setScreen] = React.useState<ScreenName>(saved.screen || 'world');
  const [params, setParams] = React.useState<ScreenParams>(saved.params || {});
  // Navigation history lives in a ref (it's never rendered) so back() can read
  // the stack synchronously and keep all setState calls out of any updater.
  const histRef = React.useRef<{ screen: ScreenName; params: ScreenParams }[]>([]);
  const [cart, setCart] = React.useState<CartLine[]>(saved.cart || []);
  // Coins are ACCOUNT-driven: when signed in, the HUD reflects the account's
  // server balance (seeded here from the cached user, refreshed from /auth/me on
  // mount, and adopted on explicit login/register). Guests fall back to the
  // locally-saved balance, else a starter default. (Coins earned in-session are
  // not yet written back to the server — there is no coins write endpoint — so
  // they reset to the account balance on reload.)
  const [coins, setCoins] = React.useState<number>(() => {
    const cached = readUser();
    if (cached && typeof cached.coins === 'number') return cached.coins;
    return saved.coins != null ? saved.coins : 1280;
  });
  const [favorites, setFavorites] = React.useState<string[]>(saved.favorites || []);
  const [claimedQuests, setClaimedQuests] = React.useState<string[]>(saved.claimedQuests || []);
  const [usedVoucher, setUsedVoucher] = React.useState<string | null>(saved.usedVoucher ?? null);
  // Progression is SERVER-OWNED. Renown is seeded from the cached account and
  // refreshed from the API; quests + earned vouchers are fetched per session.
  const [renown, setRenown] = React.useState<number>(() => {
    const cached = readUser();
    return cached && typeof cached.renown === 'number' ? cached.renown : 0;
  });
  const [streak, setStreak] = React.useState<number>(() => readUser()?.streakCount ?? 0);
  const [streakBest, setStreakBest] = React.useState<number>(() => readUser()?.streakBest ?? 0);
  const [quests, setQuests] = React.useState<ApiQuestEntry[]>([]);
  const [earnedVouchers, setEarnedVouchers] = React.useState<ApiVoucher[]>([]);
  const [streakReward, setStreakReward] = React.useState<ApiCheckinResult | null>(null);
  const [leaderboard, setLeaderboard] = React.useState<ApiLeaderboard | null>(null);
  const [referral, setReferral] = React.useState<ApiReferral | null>(null);
  const [collections, setCollections] = React.useState<ApiCollectionEntry[]>([]);
  const [purchased, setPurchased] = React.useState<string[]>(saved.purchased || []);
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
  const earnedRef = React.useRef(earnedVouchers); earnedRef.current = earnedVouchers;
  // Seeded from the token so child-screen effects on the very first mount see
  // the correct auth state (parent effects run after child effects in React).
  const authedRef = React.useRef(!!readToken());

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
          state: { lang, player, screen, params, cart, coins, favorites, claimedQuests, usedVoucher, purchased },
        }));
      } catch { /* quota / private mode — ignore */ }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [lang, player, screen, params, cart, coins, favorites, claimedQuests, usedVoucher, purchased]);

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

  // ── Progression (server-owned: renown / quests / earned vouchers) ────────
  // Pull the caller's renown, quests and vouchers from the API. Wrapped so an
  // offline / guest state simply leaves the bundled defaults in place.
  const refreshProgress = React.useCallback(async () => {
    if (!readToken()) return;            // guests have no server progression
    try {
      const [qs, vs] = await Promise.all([api.getMyQuests(), api.getMyVouchers()]);
      setQuests(qs);
      setEarnedVouchers(vs);
    } catch { /* offline — keep whatever we have */ }
  }, []);

  // Daily check-in: advances the server-side streak + grants the escalating
  // reward. Idempotent within a day (server returns alreadyToday). No-op guest.
  const checkin = React.useCallback(() => {
    if (!authedRef.current) return;
    api.checkin()
      .then((r) => {
        setStreak(r.streak);
        setStreakBest(r.best);
        setRenown(r.renown);
        if (!r.alreadyToday && (r.reward.coins > 0 || r.reward.renown > 0)) {
          if (r.reward.coins > 0) setCoins((c) => c + r.reward.coins);
          setStreakReward(r);
          void refreshProgress();   // pick up the milestone voucher / quest bump
        }
      })
      .catch(() => {});
  }, [refreshProgress]);
  const dismissStreakReward = React.useCallback(() => setStreakReward(null), []);

  const refreshLeaderboard = React.useCallback(() => {
    if (!readToken()) return;
    api.getLeaderboard(20).then(setLeaderboard).catch(() => {});
  }, []);

  const refreshReferral = React.useCallback(() => {
    if (!readToken()) return;
    api.getReferral().then(setReferral).catch(() => {});
  }, []);

  // Local purchase history (the checkout is a mock — no server order yet). Used
  // to detect the "owned" tier of look collections.
  const recordPurchase = React.useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setPurchased((p) => Array.from(new Set([...p, ...ids])));
  }, []);

  const refreshCollections = React.useCallback(() => {
    if (!readToken()) return;
    api.getMyCollections().then(setCollections).catch(() => {});
  }, []);

  const claimCollection = React.useCallback((key: string, tier: 'styled' | 'owned') => {
    if (!authedRef.current) return;
    api.claimCollection(key, tier)
      .then(async () => {
        flashMsg(t('flashRewardGot'));
        try {
          const u = await api.me();
          if (typeof u.coins === 'number') setCoins(u.coins);
          if (typeof u.renown === 'number') setRenown(u.renown);
        } catch { /* offline */ }
        refreshCollections();
        void refreshProgress();
      })
      .catch(() => flashMsg(t('saveFailed')));
  }, [flashMsg, t, refreshCollections, refreshProgress]);

  const toggleFavorite = React.useCallback((id: string) => {
    const adding = !favRef.current.includes(id);
    setFavorites((f) => (adding ? [...f, id] : f.filter((x) => x !== id)));
    // Curating taste is a progress event — the server applies the daily cap and
    // advances the matching quests; we adopt the returned renown.
    if (adding && authedRef.current) {
      api.recordProgress('curate').then((r) => setRenown(r.renown)).catch(() => {});
    }
  }, []);
  const isFavorite = React.useCallback((id: string) => favRef.current.includes(id), []);

  // The single funnel for all Renown gains. The SERVER owns caps + quest
  // advancement; future O2O sources (qr-scan, checkin, event) call the same
  // endpoint after verification — no client change needed. No-op for guests.
  const recordRenown = React.useCallback((source: RenownSource) => {
    if (!authedRef.current) return;
    api.recordProgress(source)
      .then((r) => { setRenown(r.renown); if (r.gained > 0) void refreshProgress(); })
      .catch(() => {});
  }, [refreshProgress]);

  const hasReward = React.useCallback(
    (code: string) => earnedRef.current.some((v) => v.code === code), []);

  // Claim a completed quest by its id. The server grants coins + renown +
  // voucher atomically; we then re-sync account + progression from the API.
  const claimQuest = React.useCallback((questId: string) => {
    if (!authedRef.current) return;
    api.claimMyQuest(questId)
      .then(async () => {
        flashMsg(t('flashRewardGot'));
        try {
          const u = await api.me();
          if (typeof u.coins === 'number') setCoins(u.coins);
          if (typeof u.renown === 'number') setRenown(u.renown);
        } catch { /* offline */ }
        void refreshProgress();
      })
      .catch(() => flashMsg(t('saveFailed')));
  }, [flashMsg, t, refreshProgress]);

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
      if (u && typeof u.coins === 'number') setCoins(u.coins);  // adopt account balance
      if (u && typeof u.renown === 'number') setRenown(u.renown);
      if (u && typeof u.streakCount === 'number') setStreak(u.streakCount);
      if (u && typeof u.streakBest === 'number') setStreakBest(u.streakBest);
      authedRef.current = true;
      void refreshProgress();
      flashMsg(t('authWelcome'));
      return true;
    } catch {
      flashMsg(t('authFailed'));
      return false;
    }
  }, [flashMsg, t, refreshProgress]);

  const register = React.useCallback(
    async (email: string, password: string, name: string, asSeller?: boolean): Promise<boolean> => {
      try {
        const r = await api.register({
          email, password, name,
          role: asSeller ? 'seller' : 'user',
          referralCode: readPendingRef(),
        });
        clearPendingRef();
        const u = r.user ?? null;
        setAuthUser(u);
        setAuthToken(readToken());
        persistUser(u);
        if (u && typeof u.coins === 'number') setCoins(u.coins);  // adopt account balance
        if (u && typeof u.renown === 'number') setRenown(u.renown);
        if (u && typeof u.streakCount === 'number') setStreak(u.streakCount);
        if (u && typeof u.streakBest === 'number') setStreakBest(u.streakBest);
        authedRef.current = true;
        void refreshProgress();
        flashMsg(t('authWelcome'));
        return true;
      } catch {
        flashMsg(t('authFailed'));
        return false;
      }
    },
    [flashMsg, t, refreshProgress],
  );

  const logout = React.useCallback(() => {
    setToken(null);
    persistUser(null);
    setAuthUser(null);
    setAuthToken(null);
    // Drop server-owned progression back to guest defaults.
    authedRef.current = false;
    setRenown(0);
    setStreak(0);
    setStreakBest(0);
    setQuests([]);
    setEarnedVouchers([]);
    setLeaderboard(null);
    setReferral(null);
    setCollections([]);
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
    authedRef.current = true;
    try {
      const u = await api.me();
      setAuthUser(u);
      setAuthToken(readToken());
      persistUser(u);
      if (u && typeof u.coins === 'number') setCoins(u.coins);  // account balance is source of truth
      if (u && typeof u.renown === 'number') setRenown(u.renown);
      if (u && typeof u.streakCount === 'number') setStreak(u.streakCount);
      if (u && typeof u.streakBest === 'number') setStreakBest(u.streakBest);
    } catch {
      /* offline — keep the cached user so seller affordances survive */
    }
    void refreshProgress();
    refreshReferral();
    refreshCollections();
  }, [refreshProgress, refreshReferral, refreshCollections]);

  // Capture a referral code from the share link (?ref=CODE) on first load.
  React.useEffect(() => { captureRefFromUrl(); }, []);

  // Re-hydrate the auth user once on mount when a token is present.
  React.useEffect(() => { void refresh(); }, [refresh]);

  React.useEffect(() => () => {
    clearTimeout(flashTimer.current);
    clearTimeout(coinTimer.current);
  }, []);

  const { level, progress: levelProgress } = React.useMemo(() => deriveLevel(coins), [coins]);
  const rank = React.useMemo(() => deriveRank(renown), [renown]);
  const earnedRewards = React.useMemo(() => earnedVouchers.map((v) => v.code), [earnedVouchers]);

  // Fire a one-shot rank-up celebration when the derived rank crosses upward.
  // The first effect run only seeds the baseline (prevRank null), so a
  // returning player never gets a spurious popup on mount.
  const [rankUp, setRankUp] = React.useState<number | null>(null);
  const prevRankRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const idx = deriveRank(renown).index;
    if (prevRankRef.current != null && idx > prevRankRef.current) setRankUp(idx);
    prevRankRef.current = idx;
  }, [renown]);
  const dismissRankUp = React.useCallback(() => setRankUp(null), []);
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
    renown, rank, recordRenown,
    rankUp, dismissRankUp,
    streak, streakBest, checkin, streakReward, dismissStreakReward,
    leaderboard, refreshLeaderboard,
    referral, refreshReferral,
    collections, refreshCollections, claimCollection,
    purchased, recordPurchase,
    quests, refreshProgress,
    earnedRewards, earnedVouchers, hasReward,
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
    renown, rank, rankUp, dismissRankUp, quests, earnedRewards, earnedVouchers,
    streak, streakBest, streakReward, leaderboard, referral, collections, purchased,
    favorites, claimedQuests, usedVoucher,
    auth, authOpen, openAuth, closeAuth,
    t, go, back, addToCart, setQty, removeItem, clearCart, addCoins,
    recordRenown, refreshProgress, hasReward, checkin, dismissStreakReward, refreshLeaderboard, refreshReferral,
    refreshCollections, claimCollection, recordPurchase,
    isFavorite, toggleFavorite, claimQuest, useVoucher,
    openNPC, closeNPC, openProduct, closeProduct, openWorldPanel, closeWorldPanel, flashMsg,
  ]);

  return { g, flash, nav };
}
