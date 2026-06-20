// Game state contract shared by every screen.
import type { Lang } from '../../data/types';
import type { PublicUser } from '../api/client';
import type { RankInfo, RenownSource } from './renown';
import type { ApiQuestEntry, ApiVoucher, ApiCheckinResult, ApiLeaderboard, ApiReferral } from '../api/client';

export type ScreenName =
  | 'gate' | 'splash' | 'create' | 'world'
  | 'store' | 'cart' | 'checkout' | 'success' | 'quests' | 'passport' | 'seller'
  | 'admin-map';

/** Authenticated seller state. Offline-safe: derives from cached veyra_user. */
export interface AuthState {
  user: PublicUser | null;
  token: string | null;
  role: string | null;            // 'user'|'seller'|'admin'|null
  isSeller: boolean;              // role==='seller' || role==='admin'
  isAdmin: boolean;               // role==='admin'
  login(email: string, password: string): Promise<boolean>;
  register(email: string, password: string, name: string, asSeller?: boolean): Promise<boolean>;
  logout(): void;
  refresh(): Promise<void>;       // re-hydrate user/role via api.me()
}

export type WorldPanel = 'quests' | 'cart';

export type NavDir = 'forward' | 'back';

/** Navigation signal driving the spatial screen transition. */
export interface NavSignal {
  /** Monotonic counter — changes on every navigation (use as a React key). */
  key: number;
  dir: NavDir;
  from: ScreenName | null;
  to: ScreenName;
}

export interface Player {
  name: string;
  hue: number;
  skin?: number;
  style?: string;
  /** Character age (6–70). Drives body proportions + face in the procedural avatar. */
  age?: number;
  /** Ready Player Me GLB URL. When set, the world renders this rigged avatar
   *  (procedural is the fallback). Synced to other players via presence. */
  avatarUrl?: string;
}

export interface CartLine {
  id: string;
  size: string;
  color: number;
  qty: number;
}

export interface ScreenParams {
  shop?: string;
}

/** The single context object passed to every screen as `g`. */
export interface Game {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;

  player: Player;
  setPlayer: (p: Player) => void;

  screen: ScreenName;
  params: ScreenParams;
  go: (s: ScreenName, p?: ScreenParams) => void;
  back: () => void;

  cart: CartLine[];
  addToCart: (line: CartLine) => void;
  setQty: (i: number, q: number) => void;
  removeItem: (i: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;

  coins: number;
  addCoins: (n: number) => void;
  /** Derived player level (from coins). */
  level: number;
  /** Progress (0..1) toward the next level. */
  levelProgress: number;

  /** Permanent reputation (never spent). Drives Rank — see lib/game/renown. */
  renown: number;
  /** Derived rank ladder position (1..5) + progress toward next rank. */
  rank: RankInfo;
  /** Single funnel for all Renown gains — posts a server progress event
   *  (the server owns daily caps + quest advancement). No-op for guests. */
  recordRenown: (source: RenownSource) => void;
  /** Rank index just reached (1..5), shown as a celebration; null when none. */
  rankUp: number | null;
  dismissRankUp: () => void;

  /** Current daily-streak length + best ever (server-owned). */
  streak: number;
  streakBest: number;
  /** Daily check-in — advances the streak + grants the reward (no-op guest). */
  checkin: () => void;
  /** Last check-in reward to celebrate; null when none/dismissed. */
  streakReward: ApiCheckinResult | null;
  dismissStreakReward: () => void;

  /** Cached Tastemaker leaderboard (top + the caller's position). */
  leaderboard: ApiLeaderboard | null;
  refreshLeaderboard: () => void;

  /** The caller's referral code + successful-invite count (null = guest). */
  referral: ApiReferral | null;
  refreshReferral: () => void;

  /** The caller's quests joined with their progress (from GET /me/quests). */
  quests: ApiQuestEntry[];
  /** Re-fetch quests + earned vouchers from the API. */
  refreshProgress: () => void;

  /** Voucher CODES the user owns (earned via milestones), from the API. */
  earnedRewards: string[];
  /** Full earned voucher docs (code/type/value) for display + discounts. */
  earnedVouchers: ApiVoucher[];
  hasReward: (code: string) => boolean;

  /** Favorited product ids (persisted). */
  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;

  /** Quest ids already claimed (legacy local mirror; kept for compatibility). */
  claimedQuests: string[];
  /** Claim a completed quest by its id — the server grants all rewards. */
  claimQuest: (questId: string) => void;

  /** Voucher id currently applied/flagged (persisted). */
  usedVoucher: string | null;
  useVoucher: (id: string) => void;

  npcOpen: string | null;
  openNPC: (id: string) => void;
  closeNPC: () => void;

  productOpen: string | null;
  openProduct: (id: string) => void;
  closeProduct: () => void;

  worldPanel: WorldPanel | null;
  openWorldPanel: (t: WorldPanel) => void;
  closeWorldPanel: () => void;

  /** Seller auth state + actions (offline-safe). */
  auth: AuthState;
  /** AuthModal visibility (login/register sheet). */
  authOpen: boolean;
  openAuth: () => void;
  closeAuth: () => void;

  lite: boolean;
  flash: (m: string) => void;
}

/** Props shared by all full-screen and embedded screen components. */
export interface ScreenProps {
  g: Game;
  embed?: boolean;
}
