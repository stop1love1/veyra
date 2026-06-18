// Domain types for Veyra content.

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
}

export interface Quest {
  id: string;
  reward: Localized;
  prog: number;
  goal: number;
  daily?: boolean;
  title: Localized;
}

export interface Voucher {
  id: string;
  /** Fraction (<=1) or absolute amount. */
  off: number;
  ship?: boolean;
  label: Localized;
  note: Localized;
}
