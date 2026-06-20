// Game state contract shared by every screen.
import type { Lang } from '../../data/types';
import type { PublicUser } from '../api/client';

export type ScreenName =
  | 'gate' | 'splash' | 'create' | 'world'
  | 'store' | 'cart' | 'checkout' | 'success' | 'quests' | 'seller'
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

  /** Favorited product ids (persisted). */
  favorites: string[];
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;

  /** Quest ids already claimed (persisted). */
  claimedQuests: string[];
  claimQuest: (id: string, reward: number) => void;

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
