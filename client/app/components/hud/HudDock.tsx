import { useState } from 'react';
import { Glass, Ic } from '../ui';
import type { Game } from '../../lib/game/types';

export interface HudDockProps {
  g: Game;
  active: string;
  onMap?: () => void;
  onQuest?: () => void;
  onCart?: () => void;
  onSeller?: () => void;
}

interface DockTab {
  id: string;
  icon: string;
  on: () => void;
  badge?: number;
  /** Subtle role badge (no count) — used to mark the seller tab. */
  dot?: boolean;
}

export function HudDock({ g, active, onMap, onQuest, onCart, onSeller }: HudDockProps) {
  // The dock can be collapsed to a small floating button so it stays out of the
  // way of the 3D world, then expanded on demand.
  const [open, setOpen] = useState(true);

  const tabs: DockTab[] = [
    { id: 'map', icon: 'map', on: () => (onMap ? onMap() : g.go('world')) },
    { id: 'quest', icon: 'quest', on: () => (onQuest ? onQuest() : g.go('quests')) },
    { id: 'cart', icon: 'cart', on: () => (onCart ? onCart() : g.go('cart')), badge: g.cartCount },
    // Seller-only tab. Computed from the cached user, so it survives an API
    // outage and is simply absent for guests / non-sellers (offline-safe).
    ...(g.auth.isSeller
      ? [{ id: 'seller', icon: 'bag', on: () => (onSeller ? onSeller() : g.go('seller')), dot: true } as DockTab]
      : []),
    // Admin-only map-editor tab. Computed from the cached user (offline-safe);
    // simply absent for guests / non-admins. A shield (not the map icon) keeps
    // it visually distinct from the world/map tab.
    ...(g.auth.isAdmin
      ? [{ id: 'admin', icon: 'shield', on: () => g.go('admin-map'), dot: true } as DockTab]
      : []),
  ];
  // Dock labels stay short so they sit on one line — the longer screen titles
  // (sellerDash / mapEditor) live in their headers and the aria labels below.
  const labels: Record<string, string> = {
    map: g.t('map'), quest: g.t('quests'), cart: g.t('cart'), seller: g.t('shopTab'), admin: g.t('roleAdmin'),
  };
  const aria: Record<string, string> = {
    map: g.t('aMap'), quest: g.t('aQuests'), cart: g.t('aCart'), seller: g.t('sellerDash'), admin: g.t('aAdminMap'),
  };

  // Collapsed: a single round button (shows a badge if the cart has items).
  if (!open) {
    return (
      <div className="v-dock">
        <button className="v-dock-fab" onClick={() => setOpen(true)} aria-label={g.lang === 'vi' ? 'Mở menu' : 'Open menu'}>
          <Ic name="menu" size={20} />
          {g.cartCount > 0 && <span className="v-dot">{g.cartCount}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="v-dock">
      <Glass dark className="v-dock-glass">
        {tabs.map((tb) => (
          <button key={tb.id} className={'v-dock-btn' + (active === tb.id ? ' is-on' : '')} onClick={tb.on} aria-label={aria[tb.id]}>
            <span className="v-dock-ic" {...(tb.id === 'cart' ? { id: 'v-bag-target' } : {})}>
              <Ic name={tb.icon} size={21} />
              {tb.badge != null && tb.badge > 0 && <span className="v-dot">{tb.badge}</span>}
              {tb.dot && (tb.badge == null || tb.badge <= 0) && (
                <span className="v-dot" style={{ minWidth: 8, width: 8, height: 8, padding: 0 }} aria-hidden />
              )}
            </span>
            <span className="v-dock-lbl">{labels[tb.id]}</span>
          </button>
        ))}
        <button className="v-dock-toggle" onClick={() => setOpen(false)} aria-label={g.lang === 'vi' ? 'Thu gọn menu' : 'Collapse menu'}>
          <Ic name="chevD" size={18} />
        </button>
      </Glass>
    </div>
  );
}
