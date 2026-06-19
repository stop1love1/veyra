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
    // simply absent for guests / non-admins.
    ...(g.auth.isAdmin
      ? [{ id: 'admin', icon: 'map', on: () => g.go('admin-map'), dot: true } as DockTab]
      : []),
  ];
  const labels: Record<string, string> = {
    map: g.t('map'), quest: g.t('quests'), cart: g.t('cart'), seller: g.t('sellerDash'), admin: g.t('mapEditor'),
  };
  const aria: Record<string, string> = {
    map: g.t('aMap'), quest: g.t('aQuests'), cart: g.t('aCart'), seller: g.t('sellerDash'), admin: g.t('aAdminMap'),
  };
  return (
    <div className="v-dock">
      <Glass dark className="v-dock-glass">
        {tabs.map((tb) => (
          <button key={tb.id} className={'v-dock-btn' + (active === tb.id ? ' is-on' : '')} onClick={tb.on} aria-label={aria[tb.id]}>
            <span className="v-dock-ic" {...(tb.id === 'cart' ? { id: 'v-bag-target' } : {})}>
              <Ic name={tb.icon} size={22} />
              {tb.badge != null && tb.badge > 0 && <span className="v-dot">{tb.badge}</span>}
              {tb.dot && (tb.badge == null || tb.badge <= 0) && (
                <span className="v-dot" style={{ minWidth: 8, width: 8, height: 8, padding: 0 }} aria-hidden />
              )}
            </span>
            <span className="v-dock-lbl">{labels[tb.id]}</span>
          </button>
        ))}
      </Glass>
    </div>
  );
}
