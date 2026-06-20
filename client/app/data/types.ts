// Domain types for Veyra content.
import type { RenownSource } from '../lib/game/renown';

export type Lang = 'vi' | 'en';

/** A bilingual string. */
export interface Localized {
  vi: string;
  en: string;
}

export interface NpcChip extends Localized {
  reply: Localized;
  picks: string[];
}

export interface Npc {
  name: string;
  hue: number;
  role: Localized;
  hello: Localized;
  chips: NpcChip[];
  picks?: string[];
}

export interface Shop {
  id: string;
  hue: number;
  x: number;
  y: number;
  featured?: boolean;
  name: Localized;
  cat: Localized;
  blurb: Localized;
  /** NPC id staffing this shop. */
  npc: string;
}

export interface Product {
  id: string;
  shop: string;
  price: number;
  rating: number;
  sold: number;
  name: Localized;
  tag?: Localized;
  desc: Localized;
  colors: string[];
  sizes: string[];
  /** Image URLs (mapped from server images[].url). Optional for static catalog. */
  images?: string[];
  /** External buy link (seller-supplied). */
  link?: string;
  /** Inventory count (server default 100). */
  stock?: number;
}

export interface Quest {
  id: string;
  reward: Localized;
  prog: number;            // baseline seed; live progress lives in game state
  goal: number;
  daily?: boolean;
  title: Localized;
  source: RenownSource;    // which Renown source this quest feeds
  renown: number;          // Renown awarded on claim
  chapter: number;         // 0 = daily/repeatable, 1..4 = story chapter
  repeatable?: boolean;
  rewardId?: string;       // voucher id granted into earnedRewards on claim
  locked?: boolean;        // coming-soon placeholder (e.g. real-world QR)
}

export interface Voucher {
  id: string;
  /** Fraction (<=1) or absolute amount. */
  off: number;
  ship?: boolean;
  label: Localized;
  note: Localized;
}
